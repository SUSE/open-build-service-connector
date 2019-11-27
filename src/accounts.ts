"use strict";

import * as assert from "assert";
import * as keytar from "keytar";
import {
  Account,
  Connection,
  normalizeUrl,
  readAccountsFromOscrc
} from "obs-ts";
import * as path from "path";
import * as vscode from "vscode";
import { setDifference } from "./util";

/**
 * # The Accounts Tree View
 *
 * The Account Tree View displays all stored accounts in a Tree View, where each
 * property is a leaf child element, except for the aliases (the aliases
 * themselves are the leaves).
 *
 * ## Account storage
 *
 * Accounts are stored in an Array of Account objects. While we officially only
 * support one account per OBS instance, it does not really make sense to use a
 * hash table here, as the average number of accounts is going to be so low that
 * brute force searching is faster then hashing.
 *
 * ### Credentials
 *
 * A user account for a OBS instance consist of the following required
 * information:
 *
 * - URL to the API
 * - username
 * - password
 *
 * Unfortunately we cannot store all three fields in the OS' keychain via the
 * keytar module. Instead, we store everything **except** the password in
 * VSCode's globalState key-value store and the password in the keyring.
 */

/** Key under which the AccountStorage array is stored. */
const accountStorageKey: string = "vscodeObs.AccountTree.Accounts";

/** Service name under which the passwords are stored in the OS' keyring */
const keytarServiceName: string = "vscodeObs";

/** Type as which the URL to the API is stored */
export type ApiUrl = string;

/** properties or keys that are shared by OBS.Account and AccountStorage */
type AccountSharedKeys =
  | "aliases"
  | "username"
  | "realname"
  | "email"
  | "apiUrl";

/** Type to store Buildservice accounts in VSCode's key-value storage */
export interface AccountStorage {
  /**
   * This is a human readable name for this account that will be displayed in
   * the UI. It is generated from the first alias or the apiUrl (if no aliases
   * are present).
   */
  accountName: string;
  aliases: string[];
  username: string;
  readonly apiUrl: string;
  realname?: string;
  email?: string;
}

/**
 * This object defines how each key of the AccountStorage interface is displayed
 * in the UI
 */
const AccountStorageKeyUiNames = {
  accountName: "Account Name",
  aliases: "Aliases",
  apiUrl: "Url to the API",
  email: "email",
  password: "password",
  realname: "Real name",
  username: "username"
};

/**
 * Converts a Account as returned from obs-ts into an [[AccountStorage]].
 *
 * If the account has a password set, then this password is written to the
 * system keyring via keytar.
 */
async function accountStorageFromAccount(
  account: Account
): Promise<AccountStorage> {
  const res: AccountStorage = {
    accountName:
      account.aliases.length === 0 ? account.apiUrl : account.aliases[0],
    ...(({ password, ...others }) => ({ ...others }))(account)
  };

  if (account.password !== undefined) {
    await writePasswordToKeyring(res, account.password);
  }

  return res;
}

/** Removes the password of the selected account. */
async function removePasswordFromKeyring(
  account: AccountStorage
): Promise<void> {
  if (!(await keytar.deletePassword(keytarServiceName, account.apiUrl))) {
    throw new Error(
      `Cannot remove password for account ${account.accountName}`
    );
  }
}

async function writePasswordToKeyring(
  account: AccountStorage,
  password: string
): Promise<void> {
  await keytar.setPassword(keytarServiceName, account.apiUrl, password);
}

async function readPasswordFromKeyring(
  account: AccountStorage
): Promise<string | null> {
  return keytar.getPassword(keytarServiceName, account.apiUrl);
}

/**
 * This interface defines a container for storing the mapping between the API
 * URL and the respective accounts & the Connection used for this account.
 */
export interface ApiAccountMapping {
  /**
   * Mapping URL to the API <=> Account + Connection
   */
  mapping: Map<ApiUrl, [AccountStorage, Connection | undefined]>;

  /** The API that that will be used for searching via the menu. */
  defaultApi: ApiUrl | undefined;
}

/**
 * Creates a Connection object from the provided AccountStorage object by
 * reading the password from the OS keyring.
 *
 * @param account  An account for which the connection is created.
 * @return A new Connection object when a password is stored for the respective
 *     account, otherwise undefined.
 */
async function conFromAccount(
  account: AccountStorage
): Promise<Connection | undefined> {
  const password = await readPasswordFromKeyring(account);
  return password === null
    ? undefined
    : new Connection(account.username, password, account.apiUrl);
}

/**
 * Types of the nodes of the AccountTree
 */
type TreeElement =
  | AccountTreeElement
  | AccountPropertyTreeElement
  | AccountPropertyAliasChildElement;

/**
 * Type guard for AccountPropertyTreeElement
 */
function isAccountPropertyTreeElement(
  arg: TreeElement
): arg is AccountPropertyTreeElement {
  return (arg as AccountPropertyTreeElement).property !== undefined;
}

/**
 * Type guard for AccountTreeElement
 */
function isAccountTreeElement(arg: TreeElement): arg is AccountTreeElement {
  return (arg as AccountTreeElement).account !== undefined;
}

/**
 * Type guard for AccountPropertyAliasChildElement
 */
function isAccountPropertyAliasChildElement(
  arg: TreeElement
): arg is AccountPropertyAliasChildElement {
  return (arg as AccountPropertyAliasChildElement).alias !== undefined;
}

/**
 * The main implementation class of the Account Tree View.
 */
export class AccountTreeProvider
  implements vscode.TreeDataProvider<TreeElement> {
  /**
   * The EventEmitter for changes in the accounts and thus resulting in changes
   * of the Connection objects.
   */
  private onConnectionChangeEmitter: vscode.EventEmitter<
    ApiAccountMapping
  > = new vscode.EventEmitter<ApiAccountMapping>();

  /**
   * Event that fires every time an account change results in a change of the
   * Connection objects.
   */
  public readonly onConnectionChange: vscode.Event<ApiAccountMapping> = this
    .onConnectionChangeEmitter.event;

  private apiAccountMap: ApiAccountMapping;

  private onDidChangeTreeDataEmitter: vscode.EventEmitter<
    TreeElement | undefined
  > = new vscode.EventEmitter<TreeElement | undefined>();
  public readonly onDidChangeTreeData: vscode.Event<
    TreeElement | undefined
  > = this.onDidChangeTreeDataEmitter.event;

  public refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  /**
   * @param globalState The `vscode.ExtensionContext.globalState`, as passed to
   *     the [[activate]] function.
   */
  constructor(public globalState: vscode.Memento) {
    this.apiAccountMap = {
      defaultApi: undefined,
      mapping: new Map<ApiUrl, [AccountStorage, Connection | undefined]>()
    };
  }

  /**
   * Post construction initialization function.
   *
   * It reads the mapping between the API URL and the Accounts from the internal
   * storage and constructs the appropriate connections when available.
   */
  public async initAccounts(): Promise<void> {
    // do nothing if the accounts have already been initialized
    if (this.apiAccountMap.mapping.size > 0) {
      return;
    }
    this.apiAccountMap = await this.getApiAccountMapping();
    if (this.apiAccountMap.mapping.size === 1) {
      this.apiAccountMap.defaultApi = [...this.apiAccountMap.mapping.keys()][0];
    }

    this.onConnectionChangeEmitter.fire(this.apiAccountMap);
  }

  public getTreeItem(element: TreeElement): vscode.TreeItem {
    return element;
  }

  public getChildren(element?: TreeElement): Thenable<TreeElement[]> {
    // top level element => list of accounts
    if (element === undefined) {
      const accountElements: AccountTreeElement[] = [];
      this.apiAccountMap.mapping.forEach(([acc, _], __) => {
        accountElements.push(new AccountTreeElement(acc));
      });
      return Promise.resolve(accountElements);
    }

    // this should be unreachable, alias elements have no Children
    // but better save than sorry
    if (isAccountPropertyAliasChildElement(element)) {
      return Promise.resolve([]);
    }

    // property element => no children except for the alias element
    if (isAccountPropertyTreeElement(element)) {
      if (element.property === "aliases") {
        return Promise.resolve(
          element.parent.account.aliases.map(alias => {
            return new AccountPropertyAliasChildElement(element, alias);
          })
        );
      }
      return Promise.resolve([]);
    }

    assert(isAccountTreeElement(element));
    // element can now only be an AccountTreeElement
    // => create an array of AccountPropertyTreeElement containing the defined
    //    properties
    const keys: AccountSharedKeys[] = [
      "apiUrl",
      "username",
      "realname",
      "email"
    ];
    const properties: AccountPropertyTreeElement[] = [];
    keys.forEach(key => {
      if (element.account[key] !== undefined) {
        properties.push(new AccountPropertyTreeElement(key, element));
      }
    });
    if (element.account.aliases.length > 0) {
      properties.push(new AccountPropertyTreeElement("aliases", element));
    }
    properties.push(new AccountPropertyTreeElement("password", element));

    return Promise.resolve(properties);
  }

  /**
   * Check whether there are accounts in the user's oscrc, which have not been
   * imported into the extension's storage.
   *
   * @return True when there are accounts in `oscrc` which are not imported in
   *     this extension.
   */
  public async unimportedAccountsPresent(): Promise<boolean> {
    const oscrcAccountsApiUrls = (await readAccountsFromOscrc()).map(
      acc => acc.apiUrl
    );
    const storedAccountsApiUrls: string[] = [];
    for (const key of this.apiAccountMap.mapping.keys()) {
      storedAccountsApiUrls.push(key.toString());
    }

    const oscrcAccounts = new Set(oscrcAccountsApiUrls);
    for (const storedAccount of this.apiAccountMap.mapping.keys()) {
      oscrcAccounts.delete(storedAccount.toString());
    }
    return (
      setDifference(
        new Set(oscrcAccountsApiUrls),
        new Set(storedAccountsApiUrls)
      ).size > 0
    );
  }

  public async importAccountsFromOsrc(): Promise<void> {
    const oscrcAccounts = await readAccountsFromOscrc();

    let added: boolean = false;

    await Promise.all(
      oscrcAccounts.map(async acc => {
        const normalized = normalizeUrl(acc.apiUrl);
        if (!this.apiAccountMap.mapping.has(normalized)) {
          const accStorage = await accountStorageFromAccount(acc);
          const con = await conFromAccount(accStorage);
          this.apiAccountMap.mapping.set(normalized, [accStorage, con]);
          added = true;
        }
      })
    );
    // no point in calling update when nothing will be added...
    if (added) {
      await this.updateApiAccountMapping();
    }
  }

  public async modifyAccountProperty(
    accountProperty?: AccountPropertyTreeElement | AccountTreeElement
  ): Promise<void> {
    // do nothing in case this gets invoked via the global menu or on a alias element
    if (accountProperty === undefined) {
      return;
    }

    const property = isAccountPropertyTreeElement(accountProperty)
      ? accountProperty.property
      : "accountName";

    const actualAccount = isAccountPropertyTreeElement(accountProperty)
      ? accountProperty.parent.account
      : accountProperty.account;

    if (property === "aliases") {
      return;
    }

    const newProperty = await vscode.window.showInputBox({
      password: property === "password",
      prompt: `New value for ${AccountStorageKeyUiNames[property]}`,
      // FIXME: add a proper validator here
      validateInput: () => undefined,
      value: property === "password" ? undefined : actualAccount[property]
    });

    if (newProperty === undefined) {
      return;
    }

    if (this.apiAccountMap.mapping.size === 0) {
      await vscode.window.showErrorMessage("Error: no accounts are defined");
      return;
    }
    const matchingAccountMapping = this.apiAccountMap.mapping.get(
      normalizeUrl(actualAccount.apiUrl)
    );
    assert(matchingAccountMapping !== undefined);
    const matchingAccount = matchingAccountMapping![0];

    if (property === "password") {
      await writePasswordToKeyring(matchingAccount, newProperty);
      return;
    } else if (property === "apiUrl") {
      const newApiUrl = normalizeUrl(newProperty);

      // if we change the apiUrl, then we need to remove and add the password in
      // the keyring
      // FIXME: can we use removeAccount here?
      const pw = await readPasswordFromKeyring(matchingAccount);
      await removePasswordFromKeyring(matchingAccount);

      const newAccountStorage = {
        apiUrl: newApiUrl,
        ...(({ apiUrl, ...others }) => ({ ...others }))(matchingAccount)
      };
      let con: Connection | undefined;

      if (pw !== null) {
        await writePasswordToKeyring(newAccountStorage, pw);
        con = await conFromAccount(newAccountStorage);
        assert(con !== undefined);
      }

      this.apiAccountMap.mapping.set(newApiUrl, [newAccountStorage, con]);
      const deleteRes = this.apiAccountMap.mapping.delete(
        matchingAccount.apiUrl
      );
      assert(deleteRes);

      if (this.apiAccountMap.defaultApi === matchingAccount.apiUrl) {
        this.apiAccountMap.defaultApi = newApiUrl;
      }
    } else {
      matchingAccount[property] = newProperty;
      this.apiAccountMap.mapping.set(
        normalizeUrl(actualAccount.apiUrl),
        matchingAccountMapping!
      );
    }
    await this.updateApiAccountMapping();
  }

  /**
   * Removes the specified account from the internal storage and drops its
   * password.
   */
  public async removeAccount(
    accountElement: AccountTreeElement
  ): Promise<void> {
    const acc = this.apiAccountMap.mapping.get(
      normalizeUrl(accountElement.account.apiUrl)
    );
    if (acc === undefined) {
      // FIXME: log this
      return;
    }
    await removePasswordFromKeyring(acc[0]);
    const delRes = this.apiAccountMap.mapping.delete(
      normalizeUrl(accountElement.account.apiUrl)
    );
    assert(delRes);

    await this.updateApiAccountMapping();
  }

  public async findAccountsWithoutPassword(): Promise<AccountStorage[]> {
    const accountsWithoutPw: AccountStorage[] = [];
    await Promise.all(
      [...this.apiAccountMap.mapping.values()].map(async ([acc, _con]) => {
        if ((await readPasswordFromKeyring(acc)) === null) {
          accountsWithoutPw.push(acc);
        }
      })
    );
    return accountsWithoutPw;
  }

  /**
   * Reads the
   */
  private async getApiAccountMapping(): Promise<ApiAccountMapping> {
    const accounts = this.globalState.get<AccountStorage[]>(
      accountStorageKey,
      []
    );

    const res = {
      defaultApi: undefined,
      mapping: new Map<string, [AccountStorage, Connection | undefined]>()
    };

    await Promise.all(
      accounts.map(async acc => {
        const con = await conFromAccount(acc);
        res.mapping.set(normalizeUrl(acc.apiUrl), [acc, con]);
      })
    );

    return res;
  }

  private async updateApiAccountMapping(): Promise<void> {
    const accountsToStore: AccountStorage[] = [];
    this.apiAccountMap.mapping.forEach(([acc, _con], _key) => {
      accountsToStore.push(acc);
    });
    await this.globalState.update(accountStorageKey, accountsToStore);
    this.onConnectionChangeEmitter.fire(this.apiAccountMap);
    this.refresh();
  }
}

/**
 * This element represents an account that is shown in the Account Tree View.
 */
export class AccountTreeElement extends vscode.TreeItem {
  public iconPath = path.join(
    __filename,
    "..",
    "..",
    "media",
    "User_font_awesome.svg"
  );

  public contextValue = "account";

  /** */
  constructor(public account: AccountStorage) {
    super(account.accountName, vscode.TreeItemCollapsibleState.Collapsed);
  }
}

/**
 * This class represents a property of a stored account in the Account Tree View.
 */
export class AccountPropertyTreeElement extends vscode.TreeItem {
  constructor(
    public property: AccountSharedKeys | "password",
    public parent: AccountTreeElement
  ) {
    super(
      property !== "password" && property !== "aliases"
        ? `${AccountStorageKeyUiNames[property]}: ${parent.account[property]}`
        : AccountStorageKeyUiNames[property],
      property === "aliases"
        ? vscode.TreeItemCollapsibleState.Collapsed
        : undefined
    );

    this.contextValue =
      property === "aliases"
        ? "immutableAccountPropertyElement"
        : "accountPropertyElement";
  }
}

export class AccountPropertyAliasChildElement extends vscode.TreeItem {
  public contextValue = "accountAliasElement";

  constructor(public parent: AccountPropertyTreeElement, public alias: string) {
    super(`${alias}`);
  }
}
