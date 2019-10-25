"use strict";

import { assert } from "console";
import * as keytar from "keytar";
import * as path from "path";
import * as vscode from "vscode";

import { Account, Connection, readAccountsFromOscrc } from "obs-ts";

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
 */

/**
 * # Credential & user account storage
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

const accountStorageKey: string = "vscodeObs.AccountTree.Accounts";

const keytarServiceName: string = "vscodeObs";

type AccountSharedKeys =
  | "aliases"
  | "username"
  | "realname"
  | "email"
  | "apiUrl";

export interface AccountStorage {
  accountName: string;
  aliases: string[];
  username: string;
  apiUrl: string;
  realname?: string;
  email?: string;
}

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

//  async function havePassword(): Promise<boolean> {
//   return this.getPassword() !== null;
// }

async function readPasswordFromKeyring(
  account: AccountStorage
): Promise<string | null> {
  return keytar.getPassword(keytarServiceName, account.apiUrl);
}

/**
 * This is a container class which stores the currently present connections
 * mapped to each existing account.
 */
export interface CurrentConnections {
  /**
   * Map containing a connection for each present Account.
   */
  connections: Map<AccountStorage, Connection>;

  /**
   * The defaultConnection is the Connection that will be used for searching via
   * the menu.
   */
  defaultConnection: Connection | undefined;
}

async function conFromAccount(account: AccountStorage): Promise<Connection> {
  const password = await readPasswordFromKeyring(account);
  if (password === null) {
    throw new Error(`Cannot read password for account ${account.accountName}`);
  }
  return new Connection(account.username, password, account.apiUrl);
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
   *  of the Connection objects
   */
  private onConnectionChangeEmitter: vscode.EventEmitter<
    CurrentConnections
  > = new vscode.EventEmitter<CurrentConnections>();

  /**
   * Event that fires every time an account change results in a change of the
   * Connection objects.
   */
  public readonly onConnectionChange: vscode.Event<CurrentConnections> = this
    .onConnectionChangeEmitter.event;

  private currentConnections: CurrentConnections;

  private _onDidChangeTreeData: vscode.EventEmitter<
    TreeElement | undefined
  > = new vscode.EventEmitter<TreeElement | undefined>();
  public readonly onDidChangeTreeData: vscode.Event<
    TreeElement | undefined
  > = this._onDidChangeTreeData.event;

  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  constructor(public globalState: vscode.Memento) {
    this.currentConnections = {
      connections: new Map<AccountStorage, Connection>(),
      defaultConnection: undefined
    };
  }

  /**
   * Post construction initialization function.
   *
   * It reads the
   */
  public async initAccounts(): Promise<void> {
    // do nothing if the accounts have already been initialized
    if (this.currentConnections.connections.size > 0) {
      return;
    }
    const accounts = this.getStoredAccounts();
    await Promise.all(
      accounts.map(async acc => {
        this.currentConnections.connections.set(acc, await conFromAccount(acc));
      })
    );

    if (accounts.length === 1) {
      this.currentConnections.defaultConnection = this.currentConnections.connections.get(
        accounts[0]
      );
      assert(this.currentConnections.defaultConnection !== undefined);
    }
    this.onConnectionChangeEmitter.fire(this.currentConnections);
  }

  public getTreeItem(element: TreeElement): vscode.TreeItem {
    return element;
  }

  public getChildren(element?: TreeElement): Thenable<TreeElement[]> {
    // top level element => list of accounts
    if (element === undefined) {
      const accounts = this.getStoredAccounts();
      return Promise.resolve(
        accounts.map(acc => new AccountTreeElement(acc.accountName, acc))
      );
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
   * Checks whether there are accounts in the user's oscrc, which have not been
   * imported into the extension's storage.
   */
  public async unimportedAccountsPresent(): Promise<boolean> {
    const oscrcAccountsApiUrls = (await readAccountsFromOscrc()).map(
      acc => acc.apiUrl
    );
    const storedAccountsApiUrls = this.getStoredAccounts().map(
      acc => acc.apiUrl
    );

    const oscrcAccounts = new Set(oscrcAccountsApiUrls);
    for (const storedAccount of storedAccountsApiUrls) {
      oscrcAccounts.delete(storedAccount);
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
    const presentAccounts = this.getStoredAccounts();
    const toAdd: Account[] = [];
    oscrcAccounts.forEach(acc => {
      if (
        presentAccounts.find(presAcc => presAcc.apiUrl === acc.apiUrl) ===
        undefined
      ) {
        toAdd.push(acc);
      }
    });
    // no point in calling update when nothing will be added...
    if (toAdd.length > 0) {
      await this.updateStoredAccounts(
        presentAccounts.concat(
          await Promise.all(
            toAdd.map(async acc => {
              return accountStorageFromAccount(acc);
            })
          )
        )
      );
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
      value: property === "password" ? undefined : actualAccount[property],
      prompt: `New value for ${property}`,
      // FIXME: add a proper validator here
      validateInput: () => undefined
    });

    if (newProperty === undefined) {
      return;
    }

    const accounts = this.getStoredAccounts();

    if (accounts === undefined) {
      await vscode.window.showErrorMessage("Error: no accounts are defined");
      return;
    }
    const matchingAccount = accounts.find(
      acc => acc.apiUrl === actualAccount.apiUrl
    );
    assert(matchingAccount !== undefined);

    if (property === "password") {
      await writePasswordToKeyring(matchingAccount!, newProperty);
    } else {
      // FIXME: if we change the apiUrl, then we need to remove and add the password in the keyring
      matchingAccount![property] = newProperty;

      await this.updateStoredAccounts(accounts);
    }
  }

  /**
   * Removes the specified account from the internal storage and drops it's
   * password.
   */
  public async removeAccount(
    accountElement: AccountTreeElement
  ): Promise<void> {
    const accounts = this.getStoredAccounts();
    await removePasswordFromKeyring(
      accounts.find(acc => acc.apiUrl === accountElement.account.apiUrl)!
    );

    await this.updateStoredAccounts(
      accounts.filter(acc => acc.apiUrl !== accountElement.account.apiUrl)
    );
  }

  public async findAccountsWithoutPassword(): Promise<AccountStorage[]> {
    const accounts = this.getStoredAccounts();
    const accountsWithoutPw: AccountStorage[] = [];
    await Promise.all(
      accounts.map(async acc => {
        if ((await readPasswordFromKeyring(acc)) === null) {
          accountsWithoutPw.push(acc);
        }
      })
    );
    return accountsWithoutPw;
  }

  private getStoredAccounts(): AccountStorage[] {
    return this.globalState.get<AccountStorage[]>(accountStorageKey, []);
  }

  private async updateStoredAccounts(
    accounts: AccountStorage[]
  ): Promise<void> {
    await this.globalState.update(accountStorageKey, accounts);
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

  constructor(accountName: string, public account: AccountStorage) {
    super(accountName, vscode.TreeItemCollapsibleState.Collapsed);
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
        ? `${property}: ${parent.account[property]}`
        : property,
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
