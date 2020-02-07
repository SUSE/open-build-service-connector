/**
 * Copyright (c) 2020 SUSE LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 * FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

"use strict";

import * as assert from "assert";
import * as keytar from "keytar";
import {
  Account,
  Arch,
  Connection,
  Distribution,
  fetchHostedDistributions,
  normalizeUrl,
  readAccountsFromOscrc
} from "obs-ts";
import { Logger } from "pino";
import { inspect } from "util";
import * as vscode from "vscode";
import { LoggingBase } from "./base-components";
import { logAndReportExceptions, setDifference } from "./util";
import { VscodeWindow } from "./vscode-dep";

/**
 * # Accounts management
 *
 * The accounts are stored by the user in their vscode configuration
 * (`settings.json`) with the schema defined in `package.json`.
 *
 * The main functionality is provided by the [[AccountManager]] class: it
 * ensures that the configuration stays sane and provides an event to which
 * other components can listen to for changes in the config.
 *
 * The configuration is exported via the [[ApiAccountMapping]] interface. It
 * provides a Map where each apiUrl is resolved to a [[AccountStorage]] and (if
 * the password is known) to a [[Connection]].
 *
 * The [[AccountManager]] provides the [[AccountManager.onConnectionChange]]
 * event, which fires every time that the `settings.json` change so that the
 * [[ApiAccountMapping]] requires to be recreated.
 *
 *
 * ## Credentials
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
 * VSCode's `settings.json` and the password in the keyring.
 *
 * The passwords are saved under the service name [[keytarServiceName]] and the
 * account name is the normalized URL (via [[normalizeUrl]]) to the API.
 */

/** Top level key for configuration options of this extension  */
export const configurationExtensionName = "vscode-obs";

/** Key under which the AccountStorage array is stored. */
export const configurationAccounts = "accounts";

/** Full key under which the AccountStorage array is stored */
export const configurationAccountsFullName = `${configurationExtensionName}.${configurationAccounts}`;

/**
 * Key under which the setting is stored whether the extension should check for
 * unimported Accounts on launch.
 */
export const configurationCheckUnimportedAccounts = "checkUnimportedAccounts";

/** Service name under which the passwords are stored in the OS' keyring */
const keytarServiceName = configurationAccountsFullName;

/** Type as which the URL to the API is stored */
export type ApiUrl = string;

/** Type to store Buildservice accounts in VSCode's settings.json */
export interface AccountStorage {
  /**
   * This is a human readable name for this account that will be displayed in
   * the UI. It is generated from the first alias or the apiUrl (if no aliases
   * are present).
   */
  accountName: string;
  username: string;
  readonly apiUrl: ApiUrl;
  realname?: string;
  email?: string;
  /** is this the "default" account to be used */
  isDefault?: boolean;
}

export interface ObsInstance {
  readonly account: AccountStorage;
  readonly connection?: Connection;
  readonly hostedDistributions?: readonly Distribution[];
  readonly supportedArchitectures?: readonly Arch[];
  readonly projectList?: readonly string[];
}

/**
 * This interface defines a container for storing the mapping between the API
 * URL and the respective accounts & the Connection used for this account.
 */
export interface ApiAccountMapping {
  /**
   * Mapping URL to the API <=> Account + Connection
   */
  mapping: Map<ApiUrl, ObsInstance>;

  /** The API that that will be used for searching via the menu. */
  defaultApi: ApiUrl | undefined;
}

export class AccountManager extends LoggingBase {
  /**
   * Check that the given accounts are a valid as a whole.
   *
   * @return An error message when an issue was detected or undefined otherwise.
   */
  private static verifyConfiguration(
    accounts: AccountStorage[]
  ): string | undefined {
    let defaultFound: boolean = false;

    for (const acc of accounts) {
      // check url
      try {
        normalizeUrl(acc.apiUrl);
      } catch (TypeError) {
        return `Got an invalid url: '${acc.apiUrl}'`;
      }
      // check only one default account is present
      if (acc.isDefault) {
        if (defaultFound) {
          return `More than one default account present.`;
        }
        defaultFound = true;
      }

      if (acc.username === "") {
        return "username must not be empty";
      }
    }
    return undefined;
  }

  /**
   * Event that fires every time an account change results in a change of the
   * Connection objects.
   */
  public readonly onConnectionChange: vscode.Event<ApiAccountMapping>;

  /**
   * The EventEmitter for changes in the accounts and thus resulting in changes
   * in any of the Connection objects.
   */
  private onConnectionChangeEmitter: vscode.EventEmitter<
    ApiAccountMapping
  > = new vscode.EventEmitter<ApiAccountMapping>();

  private apiAccountMap: ApiAccountMapping;
  private disposables: vscode.Disposable[];

  constructor(
    logger: Logger,
    private readonly vscodeWindow: VscodeWindow = vscode.window
  ) {
    super(logger);

    this.logger.debug("Constructing an AccountManager");
    this.apiAccountMap = { mapping: new Map(), defaultApi: undefined };
    this.onConnectionChange = this.onConnectionChangeEmitter.event;
    this.disposables = [this.onConnectionChangeEmitter];
  }

  public dispose(): void {
    this.logger.trace("Disposing of an AccountManager");
    this.disposables.forEach(disp => disp.dispose());
  }

  /**
   * Post construction initialization function.
   *
   * It reads the mapping between the API URL and the Accounts from the
   * configuration and constructs the appropriate connections when
   * available.
   * Upon completion, the [[onConnectionChange]] event is fired.
   */
  public async initializeMapping(): Promise<void> {
    // do nothing if the accounts have already been initialized
    if (this.apiAccountMap.mapping.size > 0) {
      this.logger.trace(
        "initializeMapping() has already been called, doing nothing"
      );
      return;
    }

    this.logger.trace("initializing the AccountManager");

    this.apiAccountMap = await this.getApiAccountMappingFromConfig(
      vscode.workspace.getConfiguration(configurationExtensionName),
      true
    );
    if (this.apiAccountMap.mapping.size === 1) {
      this.apiAccountMap.defaultApi = [...this.apiAccountMap.mapping.keys()][0];
    }

    this.onConnectionChangeEmitter.fire(this.apiAccountMap);

    const eventDisposable = vscode.workspace.onDidChangeConfiguration(
      this.configurationChangeListener,
      this
    );

    this.disposables.push(eventDisposable);
  }

  public async promptForNotPresentAccountPasswords(): Promise<void> {
    const accounts = await this.findAccountsWithoutPassword();

    if (accounts.length === 0) {
      return;
    }

    const msg =
      accounts.length === 1
        ? `The following account has no password set: ${accounts[0].accountName}. Would you like to set it now?`
        : `The following accounts have no password set: ${accounts
            .map(acc => acc.accountName)
            .join(", ")}. Would you like to set them now?`;
    const selected = await this.vscodeWindow.showInformationMessage(
      msg,
      "Yes",
      "No"
    );

    if (selected === undefined || selected === "No") {
      return;
    }

    accounts.forEach(async acc => {
      this.interactivelySetAccountPassword(acc.apiUrl);
    });
  }

  public async promptForUninmportedAccount(): Promise<void> {
    const config = vscode.workspace.getConfiguration(
      configurationExtensionName
    );

    if (!config.get<boolean>(configurationCheckUnimportedAccounts, true)) {
      return;
    }
    const unimportedAccounts = await this.unimportedAccountsPresent();

    if (unimportedAccounts !== undefined) {
      const importAccounts = "Import accounts now";
      const neverShowAgain = "Never show this message again";
      const selected = await this.vscodeWindow.showInformationMessage(
        "There are accounts in your oscrc configuration file, that have not been imported into Visual Studio Code. Would you like to import them?",
        importAccounts,
        neverShowAgain
      );
      if (selected !== undefined) {
        if (selected === importAccounts) {
          await this.importAccountsFromOsrc(unimportedAccounts);
        } else {
          assert(selected === neverShowAgain);

          await config.update(
            configurationCheckUnimportedAccounts,
            false,
            vscode.ConfigurationTarget.Global
          );
        }
      }
    }
  }

  /**
   * Imports all not yet present accounts from the user's `oscrc` into VSCode's
   * settings.
   */
  public async importAccountsFromOsrc(
    oscrcAccounts?: Account[]
  ): Promise<void> {
    if (oscrcAccounts === undefined) {
      oscrcAccounts = await readAccountsFromOscrc();
    }

    let added: boolean = false;

    await Promise.all(
      oscrcAccounts.map(async acc => {
        const { apiUrl, ...rest } = acc;
        const fixedAcc = { apiUrl: normalizeUrl(apiUrl), ...rest };

        if (!this.apiAccountMap.mapping.has(fixedAcc.apiUrl)) {
          const accStorage = await accountStorageFromAccount(fixedAcc);
          this.apiAccountMap.mapping.set(
            fixedAcc.apiUrl,
            await this.obsInstanceFromAccountStorage(accStorage)
          );

          added = true;
        }
      })
    );
    // no point in calling update when nothing will be added...
    if (added) {
      this.updateAccountStorageConfig();
    }
  }

  /** Command to set the password of an account */
  @logAndReportExceptions(false)
  public async interactivelySetAccountPassword(apiUrl?: ApiUrl): Promise<void> {
    if (apiUrl === undefined) {
      const allAccountsAndCons = [...this.apiAccountMap.mapping.values()];
      const accName = await this.vscodeWindow.showQuickPick(
        allAccountsAndCons.map(instancInfo => instancInfo.account.accountName)
      );
      if (accName === undefined) {
        return;
      }

      // we *must* find a result here, as the user cannot set a name themselves
      apiUrl = allAccountsAndCons.find(
        instanceInfo => instanceInfo.account.accountName === accName
      )!.account.apiUrl;
    }

    const newPw = await this.vscodeWindow.showInputBox({
      password: true,
      prompt: `add a password for the account ${apiUrl}`,
      validateInput: val =>
        val === "" ? "Password must not be empty" : undefined
    });

    const instanceInfo = this.apiAccountMap.mapping.get(apiUrl);

    if (instanceInfo === undefined) {
      throw new Error(
        `Did not get a Account & Connection for '${apiUrl}', but it must exist`
      );
    }
    const account = instanceInfo.account;
    assert(
      account.apiUrl === normalizeUrl(account.apiUrl),
      `Account ${
        account.accountName
      } has an apiUrl that is not normalized: is: '${
        account.apiUrl
      }', should be: '${normalizeUrl(account.apiUrl)}'`
    );

    if (newPw !== undefined) {
      await writePasswordToKeyring(account, newPw);
      const con = new Connection(account.username, newPw, apiUrl);
      this.apiAccountMap.mapping.set(
        apiUrl,
        await this.obsInstanceFromAccountStorage(account, con)
      );

      this.onConnectionChangeEmitter.fire(this.apiAccountMap);
    }
  }

  /**
   * Delete the password of the account with the given API URL.
   */
  public async removeAccountPassword(apiUrl: ApiUrl): Promise<void> {
    const instanceInfo = this.apiAccountMap.mapping.get(normalizeUrl(apiUrl));

    if (instanceInfo === undefined) {
      this.logger.error(
        `removeAccountPassword got called with the apiUrl ${apiUrl}, but no account exists for that url`
      );
      return;
    }
    await removePasswordFromKeyring(instanceInfo.account);
  }

  public async findAccountsWithoutPassword(): Promise<AccountStorage[]> {
    const accountsWithoutPw: AccountStorage[] = [];
    await Promise.all(
      [...this.apiAccountMap.mapping.values()].map(async instanceInfo => {
        if (
          (await readPasswordFromKeyring(instanceInfo.account)) === undefined
        ) {
          accountsWithoutPw.push(instanceInfo.account);
        }
      })
    );
    return accountsWithoutPw;
  }

  private async configurationChangeListener(
    confChangeEvent: vscode.ConfigurationChangeEvent
  ): Promise<void> {
    if (!confChangeEvent.affectsConfiguration(configurationAccountsFullName)) {
      return;
    }

    this.logger.debug("Configuration change affecting us detected");

    const wsConfig = vscode.workspace.getConfiguration(
      configurationExtensionName
    );
    const newAccounts = wsConfig.get<AccountStorage[]>(
      configurationAccounts,
      []
    );

    this.logger.debug("new account settings from configuration: ", newAccounts);

    // if the config is invalid => display an error message and revert it
    const errMsg = AccountManager.verifyConfiguration(newAccounts);
    if (errMsg !== undefined) {
      this.logger.error("New configuration is faulty: %s", errMsg);

      await this.vscodeWindow.showErrorMessage(errMsg, { modal: true });
      await this.updateAccountStorageConfig();

      return;
    }

    // check differences and react to that
    const newApiAccountMap = await this.getApiAccountMappingFromConfig(
      wsConfig,
      false
    );
    const changedAccounts = await this.deleteRemovedAccounts(newApiAccountMap);
    this.apiAccountMap = newApiAccountMap;

    changedAccounts.forEach(async apiUrl => {
      await this.interactivelySetAccountPassword(apiUrl);
    });

    this.onConnectionChangeEmitter.fire(this.apiAccountMap);
  }

  /**
   * Check for Account differences between `newApiAccountMap` and the currently
   * active map. If there are accounts in the currently active mapping that are
   * no longer in `newApiAccountMap`, then their passwords are removed from the
   * systems keyring.
   *
   * @return The API URLs of the accounts which got changed.
   */
  private async deleteRemovedAccounts(
    newApiAccountMap: ApiAccountMapping
  ): Promise<ApiUrl[]> {
    // drop removed accounts
    const promises: Array<Promise<void>> = [];
    for (const apiUrl of this.apiAccountMap.mapping.keys()) {
      // the account is gone, drop its password
      if (!newApiAccountMap.mapping.has(apiUrl)) {
        promises.push(this.removeAccountPassword(apiUrl));
      }
    }
    await Promise.all(promises);

    const changedAccounts: ApiUrl[] = [];

    for (const [apiUrl, instanceInfo] of newApiAccountMap.mapping) {
      // account got added, prompt user for password
      if (!this.apiAccountMap.mapping.has(apiUrl)) {
        assert(
          normalizeUrl(apiUrl) === normalizeUrl(instanceInfo.account.apiUrl),
          "apiAccountMap is invalid, AccountStorage.apiUrl and apiUrl do not match!"
        );

        changedAccounts.push(apiUrl);
      } else {
        const oldInstanceInfo = this.apiAccountMap.mapping.get(apiUrl)!;
        newApiAccountMap.mapping.set(apiUrl, oldInstanceInfo);
      }
    }
    return changedAccounts;
  }

  /**
   * Check whether there are accounts in the user's `oscrc`, which have not been
   * imported into VSCode's settings.
   *
   * @return - undefined if no unimported accounts are present
   *     - an array of accounts that have not yet been imported into vscode's
   *       settings
   */
  private async unimportedAccountsPresent(): Promise<Account[] | undefined> {
    this.logger.debug("Checking for unimported accounts");

    const accounts = await readAccountsFromOscrc();
    const oscrcAccountsApiUrls = accounts.map(acc => acc.apiUrl);
    this.logger.trace("found the accounts in oscrc: %s", oscrcAccountsApiUrls);

    const storedAccountsApiUrls = [...this.apiAccountMap.mapping.keys()];
    this.logger.trace("have these accounts stored: %s", storedAccountsApiUrls);

    const oscrcAccounts = new Set(oscrcAccountsApiUrls);
    for (const storedAccount of this.apiAccountMap.mapping.keys()) {
      oscrcAccounts.delete(storedAccount.toString());
    }

    const setDiff = setDifference(
      new Set(oscrcAccountsApiUrls),
      new Set(storedAccountsApiUrls)
    );
    this.logger.debug("found %s unimported accounts", setDiff.size);

    if (setDiff.size > 0) {
      const apiUrls = [...setDiff.values()];
      const res = accounts.filter(
        acc => apiUrls.find(url => url === acc.apiUrl) !== undefined
      );
      assert(setDiff.size === res.length);
      return res;
    } else {
      return undefined;
    }
  }

  /**
   * Writes the currently present Accounts from [[apiAccountMap]] to VSCode's
   * settings. It overwrites any present accounts and does not modify the stored
   * passwords in the system keychain.
   */
  private async updateAccountStorageConfig(): Promise<void> {
    const accounts: AccountStorage[] = [
      ...this.apiAccountMap.mapping.values()
    ].map(instanceInfo => instanceInfo.account);

    this.logger.debug(
      "saving the following accounts to the system settings: %s",
      inspect(accounts)
    );

    const conf = vscode.workspace.getConfiguration(configurationExtensionName);
    await conf.update(
      configurationAccounts,
      accounts,
      vscode.ConfigurationTarget.Global
    );
  }

  /**
   * Reads the AccountStorage from the provided workspace configuration and
   * converts it to a [[ApiAccountMapping]].
   *
   * @param workspaceConfig  A WorkspaceConfiguration obtained via
   *     [`vscode.workspace.getConfiguration`]
   *     (https://code.visualstudio.com/api/references/vscode-api#workspace.getConfiguration)
   *     with the `section` parameter set to the extensions configuration
   *     prefix.
   *
   * @param createConnections  Flag whether the [[Connection]] objects should be
   *     created for the returned [[ApiAccountMapping]] too. Note that this
   *     incurs a read of the OS keyring and is thus only desirable if
   *     absolutely necessary.
   *
   * @return
   */
  private async getApiAccountMappingFromConfig(
    workspaceConfig: vscode.WorkspaceConfiguration,
    createConnections: boolean
  ): Promise<ApiAccountMapping> {
    const accounts = workspaceConfig.get<AccountStorage[]>(
      configurationAccounts,
      []
    );

    const res = {
      defaultApi: undefined,
      mapping: new Map<ApiUrl, ObsInstance>()
    };

    await Promise.all(
      accounts.map(async acc => {
        res.mapping.set(
          normalizeUrl(acc.apiUrl),
          createConnections
            ? await this.obsInstanceFromAccountStorage(acc)
            : { account: acc }
        );
      })
    );

    return res;
  }

  private async obsInstanceFromAccountStorage(
    accStorage: AccountStorage,
    con?: Connection
  ): Promise<ObsInstance> {
    if (con === undefined) {
      con = await conFromAccount(accStorage);

      if (con === undefined) {
        return { account: accStorage };
      }
    }

    return {
      account: accStorage,
      connection: con
    };
  }

  private async populateObsInstanceInfo(
    instanceInfo: ObsInstance
  ): Promise<ObsInstance> {
    if (instanceInfo.connection === undefined) {
      throw new Error(
        `Cannot populate ObsInstance object for ${instanceInfo.account.apiUrl}: no connection present`
      );
    }
    return {
      ...instanceInfo,
      hostedDistributions: await fetchHostedDistributions(
        instanceInfo.connection
      )
    };
  }
}

/**
 * Converts a Account as returned from obs-ts into an [[AccountStorage]].
 *
 * If the account has a password set, then this password is written to the
 * system keyring via keytar.
 */
async function accountStorageFromAccount(
  account: Account
): Promise<AccountStorage> {
  const { password, aliases, ...others } = account;
  const res: AccountStorage = {
    accountName: aliases.length === 0 ? account.apiUrl : aliases[0],
    ...others
  };

  // FIXME: this shouldn't be done by this function...
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
): Promise<string | undefined> {
  const pw = await keytar.getPassword(keytarServiceName, account.apiUrl);
  return pw === null ? undefined : pw;
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
  return password === undefined
    ? undefined
    : new Connection(account.username, password, account.apiUrl);
}
