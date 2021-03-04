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

import { promises as fsPromises } from "fs";
import * as keytar from "keytar";
import {
  Account,
  certificateToPem,
  Connection,
  ConnectionState,
  normalizeUrl
} from "open-build-service-api";
import { withoutUndefinedMembers } from "open-build-service-api/lib/util";
import { basename } from "path";
import { Logger } from "pino";
import { URL } from "url";
import * as vscode from "vscode";
import { assert } from "./assert";
import { LoggingBase } from "./base-components";
import { ObsServerTreeElement } from "./bookmark-tree-view";
import { cmdPrefix, ignoreFocusOut } from "./constants";
import { logAndReportExceptions } from "./decorators";
import {
  DEFAULT_OBS_FETCHERS,
  ObsFetchers,
  VscodeWindow
} from "./dependency-injection";
import { findRegexPositionInString, setDifference } from "./util";

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
 * The configuration is exported via the [[ActiveAccounts]] interface. It stores
 * the currently valid accounts and provides API consumers with a way how they
 * can get a connection and information about a currently active account.
 *
 * Furthermore the [[AccountManager]] provides the
 * [[AccountManager.onAccountChange]] event, which fires every time that a
 * change in `settings.json` results in a change of the valid accounts. Note
 * that if an account is misconfigured, then it will not be added to the
 * internal storage (or it will be dropped entirely if it was known).
 *
 *
 * ## Credentials
 *
 * A user account for an OBS instance consist of the following required
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
export const CONFIGURATION_EXTENSION_NAME = "vscode-obs";

/** Key under which the AccountStorage array is stored. */
export const CONFIGURATION_ACCOUNTS = "accounts";

/** Key under which the setting whether https is enforced is stored */
export const CONFIGURATION_FORCE_HTTPS = "forceHttps";

/** Full key under which the AccountStorage array is stored */
export const CONFIGURATION_ACCOUNTS_FULL_NAME = `${CONFIGURATION_EXTENSION_NAME}.${CONFIGURATION_ACCOUNTS}`;

/**
 * Context set by the extension indicating whether any accounts are configured
 */
export const ACCOUNTS_PRESENT_CONTEXT = `${CONFIGURATION_EXTENSION_NAME}:accountsPresent`;

/**
 * Key under which the setting is stored whether the extension should check for
 * unimported Accounts on launch.
 */
export const CONFIGURATION_CHECK_UNIMPORTED_ACCOUNTS =
  "checkUnimportedAccounts";

/** Service name under which the passwords are stored in the OS' keyring */
export const KEYTAR_SERVICE_NAME = CONFIGURATION_ACCOUNTS_FULL_NAME;

const cmdId = "obsAccount";

export const IMPORT_ACCOUNTS_FROM_OSCRC_COMMAND = `${cmdPrefix}.${cmdId}.importAccountsFromOsrc`;

export const SET_ACCOUNT_PASSWORD_COMMAND = `${cmdPrefix}.${cmdId}.setAccountPassword`;

export const REMOVE_ACCOUNT_COMMAND = `${cmdPrefix}.${cmdId}.removeAccount`;

export const NEW_ACCOUNT_WIZARD_COMMAND = `${cmdPrefix}.${cmdId}.newAccountWizard`;

export const CHECK_CONNECTION_STATE_COMMAND = `${cmdPrefix}.${cmdId}.checkConnectionState`;

export const OPEN_SETTINGS_JSON_OF_ACCOUNT_COMMAND = `${cmdPrefix}.${cmdId}.openSettingsJsonOfAccount`;

/** Type as which the URL to the API is stored */
export type ApiUrl = string;

/** Type to store Buildservice accounts in VSCode's settings.json */
export interface AccountStorage {
  /**
   * This is a human readable name for this account that will be displayed in
   * the UI.
   *
   * It is generated from the first alias or the apiUrl (if no aliases are
   * present).
   */
  accountName: string;

  /** Username to access the API of the Buildservice instance */
  username: string;

  /** URL to the API of this Buildservice instance */
  readonly apiUrl: ApiUrl;

  /**
   * The user's real name.
   *
   * This value is only used for changelog entries.
   */
  realname?: string;

  /**
   * The user's email address.
   *
   * This value is only used for changelog entries.
   */
  email?: string;

  /**
   * Optional certificate file for connecting to the server, if it uses a custom
   * certificate.
   */
  serverCaCertificate?: string;
}

/** A well configured account available to other components. */
export interface ValidAccount {
  readonly account: AccountStorage;
  /** A connection that can be used to connect to the build service instance */
  readonly connection: Connection;
  /** State of this account */
  readonly state: ConnectionState;
}

/**
 * Converts a [[ConnectionState]] to a message that can be presented to the
 * user.
 *
 * @param state  The connection state to be converted into a string.
 * @param apiUrl  Url to the API to which this ConnectionState belongs. It is
 *     included in some messages.
 */
export function connectionStateToMessage(
  state: ConnectionState,
  apiUrl: string
): string {
  switch (state) {
    case ConnectionState.ApiBroken:
      return `${apiUrl} does not appear to be OBS`;
    case ConnectionState.AuthError:
      return "Could not authenticate with the supplied username & password";
    case ConnectionState.Unreachable:
      return `The host serving ${apiUrl} is unreachable`;
    case ConnectionState.SslError:
      return `Connecting to ${apiUrl} resulted in a SSL error`;
    case ConnectionState.Ok:
      return `${apiUrl} appears to be running fine`;
    default:
      /* eslint-disable-next-line @typescript-eslint/restrict-template-expressions */
      assert(false, `Got an invalid ConnectionState: ${state}`);
  }
}

export interface ActiveAccounts {
  /**
   * Gets the account configuration for the buildservice instance with the given
   * API URL or undefined if no instance with that url is known or valid.
   */
  getConfig(apiUrl: ApiUrl): ValidAccount | undefined;

  /**
   * Returns the list of all currently present Accounts.
   */
  getAllApis(): ApiUrl[];
}

/**
 * Map storing the Account & Connection for each defined Account keyed by their
 * API URL.
 */
type ApiAccountMapping = Map<ApiUrl, ValidAccount>;

/** Dumb implementation of the ActiveAccounts interface using a Map. */
class ActiveAccountsImpl implements ActiveAccounts {
  constructor(public readonly apiAccountMapping: ApiAccountMapping) {}

  public getConfig(apiUrl: ApiUrl): ValidAccount | undefined {
    return this.apiAccountMapping.get(normalizeUrl(apiUrl));
  }

  public getAllApis(): ApiUrl[] {
    return [...this.apiAccountMapping.keys()];
  }
}

/** Verify that `potentialUrl` is a valid URL. */
const isValidUrl = (potentialUrl: string): boolean => {
  try {
    new URL(potentialUrl);
    return true;
  } catch (err) {
    return false;
  }
};

const getForceHttpsSetting = (): boolean | undefined =>
  vscode.workspace
    .getConfiguration(CONFIGURATION_EXTENSION_NAME)
    .get<boolean>(CONFIGURATION_FORCE_HTTPS);

/**
 * Ask the user to specify which account to use for an action with the given
 * description.
 *
 * This function checks how many accounts are present:
 * 0  => an exception is thrown
 * 1  => the API URL of this single account is returned
 * >1 => a QuickPick is opened that presents the user with all currently
 *       existing accounts to choose from.
 *
 * @return The API URL for the selected account or undefined if the user did not
 *     provide one.
 *
 * @throw An `Error` if no accounts are specified in the `activeAccounts`.
 *
 * @param apiAccountMap  The accounts to be considered for the selection.
 * @param actionDescription  A string that will be shown to the user in the
 *     presented QuickPick describing what they are choosing.
 * @param vscodeWindow  Interface containing the user facing functions.
 *     This parameter is only useful for dependency injection for testing.
 */
// FIXME: maybe don't throw when no accounts are defined?
export async function promptUserForAccount(
  activeAccounts: ActiveAccounts,
  actionDescription: string = "Pick which account to use",
  vscodeWindow: VscodeWindow = vscode.window
): Promise<ApiUrl | undefined> {
  const apiUrls = activeAccounts.getAllApis();
  if (apiUrls.length === 0) {
    throw new Error("No accounts are known to this extension");
  } else if (apiUrls.length === 1) {
    return apiUrls[0];
  } else {
    const apiUrlAccountNames: [ApiUrl, string][] = [];
    apiUrls.forEach((apiUrl) => {
      const accName = activeAccounts.getConfig(apiUrl)?.account.accountName;
      if (accName !== undefined) {
        apiUrlAccountNames.push([apiUrl, accName]);
      }
    });
    const accountName = await vscodeWindow.showQuickPick(
      apiUrlAccountNames.map(([, accName]): string => accName),
      {
        canPickMany: false,
        placeHolder: actionDescription
      }
    );
    if (accountName === undefined) {
      return;
    }

    return apiUrlAccountNames.find(
      ([, accName]) => accName === accountName
    )?.[0];
  }
}

/**
 * Return type of the
 * [[RuntimeAccountConfiguration.configurationChangeListener]] method.
 */
interface ConfigChangeResult {
  /** was the configuration modified (account added, removed or modified)? */
  configModified: boolean;

  /** list of added accounts that lack a password */
  newAccountsWithoutPassword: AccountStorage[];

  /**
   * list of error messages encountered while checking the new account config
   */
  errorMessages: string[];
}

const getEol = (eol: vscode.EndOfLine): string => {
  switch (eol) {
    case vscode.EndOfLine.LF:
      return "\n";
    case vscode.EndOfLine.CRLF:
      return "\r\n";
    default:
      /* eslint-disable-next-line @typescript-eslint/restrict-template-expressions */
      assert(false, `Got an invalid end of line: ${eol}`);
  }
};

/**
 * Class for managing the valid accounts at runtime.
 *
 * It is the single source of truth for the accounts and should be exclusively
 * used to add or remove accounts.
 */
class RuntimeAccountConfiguration extends LoggingBase {
  public readonly activeAccounts: ActiveAccounts;

  private readonly apiAccountMap: ApiAccountMapping = new Map<
    ApiUrl,
    ValidAccount
  >();

  constructor(
    logger: Logger,
    private readonly checkConnection: typeof DEFAULT_OBS_FETCHERS.checkConnection
  ) {
    super(logger);
    this.activeAccounts = new ActiveAccountsImpl(this.apiAccountMap);
  }

  /**
   * Callback function that actually performs the checking of a new
   * configuration and reacts to the changes by adding & removing accounts.
   *
   * This function reads the current account configuration from VSCode's
   * configuration storage and performs the following actions:
   * - Check that all accounts are sane. On errors, append them to the returned
   *   [[ConfigChangeResult.errorMessages]] array.
   * - Remove all accounts that are no longer present.
   * - Append all new accounts to the returned
   *   [[ConfigChangeResult.newAccountsWithoutPassword]] if they lack a
   *   password.
   * - Modify existing accounts if e.g. the username changed.
   *
   * If the configuration changed, then the flag
   * [[ConfigChangeResult.configModified]] is set to true.
   *
   * @return A [[ConfigChangeResult]] with the values populated as described
   *     above.
   */
  public async configurationChangeListener(): Promise<ConfigChangeResult> {
    this.logger.debug("Configuration change affecting us detected");

    const wsConfig = vscode.workspace.getConfiguration(
      CONFIGURATION_EXTENSION_NAME
    );
    const newAccounts = wsConfig.get<AccountStorage[]>(
      CONFIGURATION_ACCOUNTS,
      []
    );
    const forceHttps = getForceHttpsSetting();

    const oldAccounts = [...this.apiAccountMap.values()].map(
      (inst) => inst.account
    );

    this.logger.debug(
      "new account settings from configuration: %s",
      newAccounts
        .map(
          (newAcc) =>
            `accountName: ${newAcc.accountName}, apiUrl: ${newAcc.apiUrl}`
        )
        .join("; ")
    );

    // to only fire the event once in case the config changes
    let configModified = false;

    // drop all accounts that got removed in the configuration change
    for (const oldAcc of oldAccounts) {
      if (
        newAccounts.find((newAcc) => newAcc.apiUrl === oldAcc.apiUrl) ===
        undefined
      ) {
        configModified = true;
        this.logger.trace(
          "Removing the following account: %s",
          oldAcc.accountName
        );
        await this.removeAccount(oldAcc.apiUrl);
      }
    }

    const newAccountsWithoutPassword: AccountStorage[] = [];
    const errorMessages: string[] = [];

    // add new accounts manually:
    // - This class cannot prompt the user for new credentials, so in case this
    //   is a completely new account we don't add it into the config, we just
    //   return it.
    // - In case we already know the account, then we also know that the
    //   password => need to query the password again though if any of the
    //   relevant settings of the Connection changed
    for (const newAcc of newAccounts) {
      // skip faulty accounts
      const errMsg = this.checkAccount(newAcc, forceHttps);
      if (errMsg !== undefined) {
        this.logger.error(
          "new account named '%s' has the following issue: %s",
          newAcc.accountName,
          errMsg
        );
        errorMessages.push(errMsg);
        continue;
      }

      if (
        oldAccounts.find((oldAcc) => oldAcc.apiUrl === newAcc.apiUrl) ===
        undefined
      ) {
        // this is a completely fresh account
        newAccountsWithoutPassword.push(newAcc);
      } else {
        // old account that got modified
        // verify that it actually exists in the map, although that would be very weird
        const existingValidAcc = this.apiAccountMap.get(newAcc.apiUrl);
        if (existingValidAcc !== undefined) {
          configModified = true;
          const { account, connection, state } = existingValidAcc;

          if (
            account.username !== newAcc.username ||
            account.serverCaCertificate !== newAcc.serverCaCertificate
          ) {
            const newCon = connection.clone({
              forceHttps,
              serverCaCertificate: newAcc.serverCaCertificate,
              username: newAcc.username
            });
            await this.insertAccountIntoMap(newAcc, newCon);
          } else {
            await this.insertAccountIntoMap(newAcc, connection, state);
          }
        } else {
          // This *really* shouldn't occur, but it is theoretically possible in
          // case there is a data race.
          // However, we do not want to assert() this, as this function is
          // called in-transparently to the user and the error could be swallowed.
          this.logger.error(
            "Expected the account '%s' to be present in the apiAccountMap, but it is absent.",
            newAcc.apiUrl
          );
        }
      }
    }

    return {
      configModified,
      errorMessages,
      newAccountsWithoutPassword
    };
  }

  /**
   * Add the provided account to the internal storage and create a
   * [[Connection]] for it from the provided `password`.
   *
   * If an account with the same API URL already exists, then it is overwritten.
   */
  public async addAccount(
    account: AccountStorage,
    password: string
  ): Promise<void> {
    const connection = new Connection(account.username, password, {
      forceHttps: getForceHttpsSetting(),
      serverCaCertificate: account.serverCaCertificate,
      url: account.apiUrl
    });

    // try to set the password first, if that fails, we'll get an exception and
    // won't leave the system in a dirty state
    const connectionStatusAndVoid = await Promise.all([
      this.checkConnection(connection),
      keytar.setPassword(KEYTAR_SERVICE_NAME, account.apiUrl, password)
    ]);

    await this.insertAccountIntoMap(
      account,
      connection,
      connectionStatusAndVoid[0].state
    );
  }

  /**
   * Remove the account with the specified API URL from the internal storage and
   * delete its password.
   *
   * @return Whether the account was actually removed (it wouldn't be removed if
   *     it does not exist).
   */
  public async removeAccount(apiUrl: ApiUrl): Promise<boolean> {
    try {
      if (!(await keytar.deletePassword(KEYTAR_SERVICE_NAME, apiUrl))) {
        this.logger.error(
          "Did not delete the password of the account %s",
          apiUrl
        );
      }
    } catch (err) {
      this.logger.error(
        "Did not delete the password of the account %s, got the error: %s",
        apiUrl,
        (err as Error).toString()
      );
    }

    if (this.apiAccountMap.size === 1) {
      await vscode.commands.executeCommand(
        "setContext",
        ACCOUNTS_PRESENT_CONTEXT,
        false
      );
    }
    return this.apiAccountMap.delete(apiUrl);
  }

  /** Save the currently valid accounts in VSCode's storage */
  public async saveToStorage(): Promise<void> {
    const conf = vscode.workspace.getConfiguration(
      CONFIGURATION_EXTENSION_NAME
    );
    await conf.update(
      CONFIGURATION_ACCOUNTS,
      [...this.apiAccountMap.values()].map(
        (validAccount) => validAccount.account
      ),
      vscode.ConfigurationTarget.Global
    );
  }

  /**
   * Checks the state of the connection belonging to `apiUrl`.
   *
   * @return
   *     - `undefined` if no connection exists for the specified `apiUrl`
   *     - `true` if the state changed or `false` otherwise
   */
  public async checkConnectionState(
    apiUrl: string
  ): Promise<boolean | undefined> {
    const acc = this.apiAccountMap.get(apiUrl);
    if (acc === undefined) {
      this.logger.error(
        "was prompted to check the account belonging to %s, but no account is known for this API",
        apiUrl
      );
      return undefined;
    }

    const state = (await this.checkConnection(acc.connection)).state;
    await this.insertAccountIntoMap(acc.account, acc.connection, state);
    return state !== acc.state;
  }

  /**
   * Reads the AccountStorage from the workspace configuration and saves it in
   * the internal apiAccountMap.
   *
   * @throw Does not throw.
   *
   * @return
   *     - An array of accounts for which the password could not be retrieved
   *       from the OS keyring.
   *     - An array of error messages that indicate problems with the accounts
   *       in the configuration. Accounts that generate errors are not added.
   */
  public async loadFromStorage(): Promise<[AccountStorage[], string[]]> {
    const wsConfig = vscode.workspace.getConfiguration(
      CONFIGURATION_EXTENSION_NAME
    );
    const accounts = wsConfig.get<AccountStorage[]>(CONFIGURATION_ACCOUNTS, []);
    const forceHttps = getForceHttpsSetting();

    this.logger.trace(
      "Loading the following accounts from the storage: %s",
      accounts
        .map((acc) => `name: ${acc.accountName}, apiUrl: ${acc.apiUrl}`)
        .join("; ")
    );

    let addedAccounts = 0;
    const accountsWithoutPw: AccountStorage[] = [];
    const errorMessages: string[] = [];

    for (const account of accounts) {
      const errMsg = this.checkAccount(account, forceHttps);
      if (errMsg !== undefined) {
        this.logger.trace(
          "Account %s is misconfigured: %s",
          account.accountName,
          errMsg
        );
        errorMessages.push(errMsg);
        continue;
      }

      /* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition */
      assert(account.apiUrl !== "" && account.accountName !== undefined);
      const password = await keytar.getPassword(
        KEYTAR_SERVICE_NAME,
        account.apiUrl
      );
      assert(
        password === null || typeof password === "string",
        `got an invalid password from keytar, expected a string or null, but got '${typeof password}'`
      );
      if (password === null) {
        this.logger.trace(
          "Account %s is missing a password",
          account.accountName
        );
        accountsWithoutPw.push(account);
      } else {
        addedAccounts++;
        const connection = new Connection(account.username, password, {
          forceHttps,
          serverCaCertificate: account.serverCaCertificate,
          url: account.apiUrl
        });
        await this.insertAccountIntoMap(account, connection);
        this.logger.trace("Account %s was added", account.accountName);
      }
    }

    assert(
      accountsWithoutPw.length + errorMessages.length + addedAccounts ===
        accounts.length
    );

    return [accountsWithoutPw, errorMessages];
  }

  private async insertAccountIntoMap(
    account: AccountStorage,
    connection: Connection,
    state?: ConnectionState
  ): Promise<void> {
    if (this.apiAccountMap.size === 0) {
      await vscode.commands.executeCommand(
        "setContext",
        ACCOUNTS_PRESENT_CONTEXT,
        true
      );
    }
    this.apiAccountMap.set(account.apiUrl, {
      account,
      connection,
      state: state ?? (await this.checkConnection(connection)).state
    });
  }

  /**
   * Return an error message describing an issue with the provided `account` or
   * undefined if the account is ok.
   *
   * @param forceHttps  Boolean flag whether https connections are enforced
   *     (true). This value should be taken from the user's global config.
   *     This value is forwarded to the constructor of a [[Connection]].
   */
  private checkAccount(
    account: AccountStorage,
    forceHttps: boolean | undefined
  ): string | undefined {
    if (account.username === "") {
      return `Got an empty username for the account ${account.accountName}`;
    }
    try {
      // just create a connection for the side effect of a potential error being
      // thrown
      new Connection(account.username, "irrelevant", {
        forceHttps,
        serverCaCertificate: account.serverCaCertificate,
        url: account.apiUrl
      });
    } catch (err) {
      // the url error message looks like an internal error => remove the nasty
      // looking bits so that the user doesn't think they hit an application bug
      const msg: string = (err as Error)
        .toString()
        .replace("TypeError [ERR_INVALID_URL]: ", "");
      return `Got an invalid settings for the account ${account.accountName}: ${msg}`;
    }

    return undefined;
  }
}

export interface AccountManager extends vscode.Disposable {
  readonly onAccountChange: vscode.Event<ApiUrl[]>;

  /** Currently active accounts with a valid password */
  readonly activeAccounts: ActiveAccounts;
}

interface ConnectionConstructionOptions {
  password: string;
  serverCaCertificate?: string;
}

/**
 * Class providing the user facing commands for OBS account management and the
 * corresponding equivalents for API consumers.
 *
 * ## for API consumers
 *
 * The main variable of interest is the [[activeAccounts]] object: it holds the
 * information about all currently known and valid accounts (including the
 * corresponding [[Connection]] objects required to communicate with OBS).
 *
 * API consumers that need to be notified if the account configuration changes
 * should subscribe to the [[onAccountChange]] Event. It is fired every time
 * the account configuration changes.
 */
export class AccountManagerImpl extends LoggingBase {
  /**
   * Construct a fully initialized [[AccountManager]] that has all commands
   * already registered.
   */
  public static async createAccountManager(
    logger: Logger,
    vscodeWindow: VscodeWindow = vscode.window,
    vscodeCommands: typeof vscode.commands = vscode.commands,
    vscodeWorkspace: typeof vscode.workspace = vscode.workspace,
    obsFetchers: ObsFetchers = DEFAULT_OBS_FETCHERS
  ): Promise<AccountManagerImpl> {
    const mngr = new AccountManagerImpl(
      logger,
      vscodeWindow,
      vscodeWorkspace,
      obsFetchers
    );
    mngr.logger.trace("initializing the AccountManager");

    let errMsgs: string[];
    [
      mngr.accountsWithOutPw,
      errMsgs
    ] = await mngr.runtimeAccountConfig.loadFromStorage();

    mngr.onDidChangeConfigurationDisposable = vscodeWorkspace.onDidChangeConfiguration(
      mngr.configurationChangeListener,
      mngr
    );
    mngr.disposables.push(
      vscodeCommands.registerCommand(
        IMPORT_ACCOUNTS_FROM_OSCRC_COMMAND,
        mngr.importAccountsFromOsrc,
        mngr
      ),
      vscode.commands.registerCommand(
        SET_ACCOUNT_PASSWORD_COMMAND,
        mngr.setAccountPasswordInteractive,
        mngr
      ),
      vscode.commands.registerCommand(
        REMOVE_ACCOUNT_COMMAND,
        mngr.removeAccountInteractive,
        mngr
      ),
      vscode.commands.registerCommand(
        NEW_ACCOUNT_WIZARD_COMMAND,
        mngr.newAccountWizard,
        mngr
      ),
      vscode.commands.registerCommand(
        CHECK_CONNECTION_STATE_COMMAND,
        mngr.checkConnectionState,
        mngr
      ),
      vscode.commands.registerCommand(
        OPEN_SETTINGS_JSON_OF_ACCOUNT_COMMAND,
        mngr.openSettingsJsonAtApiUrl,
        mngr
      )
    );

    await mngr.displayConfigurationLoadingFailedError(errMsgs);

    await vscode.commands.executeCommand(
      "setContext",
      ACCOUNTS_PRESENT_CONTEXT,
      mngr.runtimeAccountConfig.activeAccounts.getAllApis().length > 0
    );

    return mngr;
  }

  /**
   * Event that fires every time an account change results in a change of the
   * Connection objects.
   *
   * The Event sends the current list of the available APIs.
   */
  public readonly onAccountChange: vscode.Event<ApiUrl[]>;

  /** Currently active accounts with a valid password */
  public readonly activeAccounts: ActiveAccounts;

  /**
   * The EventEmitter for changes in the accounts and thus resulting in changes
   * in any of the [[Connection]] objects.
   */
  private readonly onAccountChangeEmitter: vscode.EventEmitter<
    ApiUrl[]
  > = new vscode.EventEmitter<ApiUrl[]>();

  private runtimeAccountConfig: RuntimeAccountConfiguration = new RuntimeAccountConfiguration(
    this.logger,
    this.obsFetchers.checkConnection
  );

  private accountsWithOutPw: AccountStorage[] = [];
  private readonly disposables: vscode.Disposable[] = [];

  private onDidChangeConfigurationDisposable: vscode.Disposable | undefined;

  private constructor(
    logger: Logger,
    private readonly vscodeWindow: VscodeWindow,
    private readonly vscodeWorkspace: typeof vscode.workspace = vscode.workspace,
    private readonly obsFetchers: ObsFetchers = DEFAULT_OBS_FETCHERS
  ) {
    super(logger);

    this.activeAccounts = this.runtimeAccountConfig.activeAccounts;
    this.onAccountChange = this.onAccountChangeEmitter.event;
    this.disposables.push(this.onAccountChangeEmitter);
  }

  /** Cleanup all created Commands and EventEmitters */
  public dispose(): void {
    this.logger.trace("Disposing of an AccountManager");
    if (this.onDidChangeConfigurationDisposable !== undefined) {
      this.onDidChangeConfigurationDisposable.dispose();
    }
    for (const disp of this.disposables) {
      disp.dispose();
    }
  }

  /**
   *
   */
  public async promptForNotPresentAccountPasswords(): Promise<void> {
    this.logger.trace(
      "Prompting for passwords of accounts that don't have one, got %d accounts to query",
      this.accountsWithOutPw.length
    );

    if (this.accountsWithOutPw.length === 0) {
      return;
    }

    const msg =
      this.accountsWithOutPw.length === 1
        ? `The following account has no password set: ${this.accountsWithOutPw[0].accountName}. Would you like to set it now?`
        : `The following accounts have no password set: ${this.accountsWithOutPw
            .map((acc) => acc.accountName)
            .join(", ")}. Would you like to set them now?`;
    const selected = await this.vscodeWindow.showInformationMessage(
      msg,
      "Yes",
      "No"
    );

    if (selected === undefined || selected === "No") {
      return;
    }

    let accountChange = false;

    for (const acc of this.accountsWithOutPw) {
      const pw = await this.promptForAccountPassword(acc.apiUrl);
      if (pw !== undefined) {
        await this.runtimeAccountConfig.addAccount(acc, pw);
        accountChange = true;
      }
    }

    if (accountChange) {
      this.notifyOffAccountChange();
    }
  }

  /**
   * User facing command to remove an account from the internal storage.
   *
   * @param apiUrl  Optionally, callers can supply an account to be removed
   *     directly via its apiUrl. The user is otherwise asked to supply the
   *     account that they want to remove.
   */
  public async removeAccountInteractive(apiUrl?: ApiUrl): Promise<void> {
    if (this.activeAccounts.getAllApis().length === 0) {
      await this.vscodeWindow.showInformationMessage(
        "There are no accounts defined, cannot remove any"
      );
      return;
    }
    if (apiUrl === undefined) {
      const apiUrlCandidate = await promptUserForAccount(
        this.activeAccounts,
        "Choose which account should be deleted",
        this.vscodeWindow
      );
      if (apiUrlCandidate === undefined) {
        return;
      }
      apiUrl = apiUrlCandidate;
    }

    assert(
      /* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition */
      apiUrl !== undefined,
      "The parameter apiUrl must be defined at this point"
    );

    const confirmation = await this.vscodeWindow.showInformationMessage(
      `The account for the API ${apiUrl} will be deleted, are you sure?`,
      { modal: true },
      "Yes",
      "No"
    );
    if (confirmation === undefined || confirmation === "No") {
      return;
    }

    await this.runtimeAccountConfig.removeAccount(apiUrl);
    await this.saveAccountsToStorage();
  }

  /**
   * Command to open the user's settings.json and position the cursor at the
   * entry of the apiUrl belonging to the supplied `obsServerTreeElement` or to
   * the `apiUrl` that the user selected.
   */
  public async openSettingsJsonAtApiUrl(
    obsServerTreeElement?: ObsServerTreeElement
  ): Promise<void> {
    const accountApiUrl =
      obsServerTreeElement?.account.account.apiUrl ??
      (await promptUserForAccount(
        this.activeAccounts,
        "Please specify the account for which you'd like to change the settings",
        this.vscodeWindow
      ));
    if (accountApiUrl === undefined) {
      this.logger.error("Did not get a apiUrl from the user");
      return;
    }

    await vscode.commands.executeCommand("workbench.action.openSettingsJson");
    const settingsEditor = vscode.window.visibleTextEditors.find(
      (textEditor) => basename(textEditor.document.fileName) === "settings.json"
    );
    // hm, the settings editor did not open :-(
    if (settingsEditor === undefined) {
      this.logger.error("The settings editor did not open");
      return;
    }

    const contents = settingsEditor.document.getText();
    const settings: any = JSON.parse(contents);
    if (
      settings[CONFIGURATION_ACCOUNTS_FULL_NAME] === undefined ||
      !Array.isArray(settings[CONFIGURATION_ACCOUNTS_FULL_NAME]) ||
      settings[CONFIGURATION_ACCOUNTS_FULL_NAME].length === 0
    ) {
      this.logger.error(
        "Did not find the setting %s in the settings.json or it is not an arroy or it has no entries.",
        CONFIGURATION_ACCOUNTS_FULL_NAME
      );
      return;
    }

    const apiUrlPosition = findRegexPositionInString(
      contents,
      new RegExp(`"apiUrl":\\s*"${accountApiUrl}"`),
      getEol(settingsEditor.document.eol)
    );
    if (apiUrlPosition === undefined) {
      this.logger.error(
        "Could not get the position of %s in settings.json",
        accountApiUrl
      );
      return;
    }

    settingsEditor.selection = new vscode.Selection(
      apiUrlPosition,
      apiUrlPosition
    );
  }

  public async checkConnectionState(
    treeElement?: ObsServerTreeElement
  ): Promise<void> {
    if (this.activeAccounts.getAllApis().length === 0) {
      this.logger.debug(
        "checkConnectionState called with no accounts being defined"
      );
      return;
    }
    const apiUrl =
      treeElement?.account.account.apiUrl ??
      (await promptUserForAccount(
        this.activeAccounts,
        "Select the account which should be rechecked",
        this.vscodeWindow
      ));
    if (apiUrl === undefined) {
      this.logger.error("Failed to get a apiUrl from the user");
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        cancellable: false,
        title: `Checking the connection to ${apiUrl}`
      },
      async () => {
        const changed = await this.runtimeAccountConfig.checkConnectionState(
          apiUrl
        );
        if (changed !== undefined && changed) {
          this.notifyOffAccountChange();
        }
      }
    );
  }

  /**
   * Interactive wizard to add a new account to the extension.
   */
  @logAndReportExceptions()
  public async newAccountWizard(): Promise<void> {
    const OBS = "build.opensuse.org (OBS)";
    const CUSTOM = "other (custom)";
    const serverChoice = await this.vscodeWindow.showQuickPick([OBS, CUSTOM], {
      canPickMany: false,
      placeHolder: "Specify the server of your account."
    });
    if (serverChoice === undefined) {
      return;
    }

    let apiUrl: ApiUrl;

    if (serverChoice === CUSTOM) {
      const apiUrlCandidate = await this.vscodeWindow.showInputBox({
        ignoreFocusOut,
        placeHolder: "https://api.my-instance.org",
        prompt: "Enter the URL to the API of your OBS instance.",
        validateInput: (value: string) =>
          !isValidUrl(value) ? `Invalid URL '${value}' entered` : undefined
      });
      if (apiUrlCandidate === undefined) {
        return;
      }
      apiUrl = apiUrlCandidate;
      const proto = new URL(apiUrl).protocol;
      if (proto === "http:" && getForceHttpsSetting()) {
        const changeForceHttpsSetting = await this.vscodeWindow.showQuickPick(
          ["Yes", "No"],
          {
            canPickMany: false,
            placeHolder:
              "The specified URL uses the http, which is currently forbidden. Do you want to allow non-https urls?"
          }
        );
        if (
          changeForceHttpsSetting === undefined ||
          changeForceHttpsSetting === "No"
        ) {
          return;
        }
        assert(changeForceHttpsSetting === "Yes");
        await this.vscodeWorkspace
          .getConfiguration(CONFIGURATION_EXTENSION_NAME)
          .update(
            CONFIGURATION_FORCE_HTTPS,
            false,
            vscode.ConfigurationTarget.Global
          );
      }
    } else {
      assert(
        serverChoice === OBS,
        `Got an invalid value for choice: '${serverChoice}', expected ${OBS}`
      );
      apiUrl = "https://api.opensuse.org";
    }

    const username = await this.vscodeWindow.showInputBox({
      ignoreFocusOut,
      prompt: "Enter your username.",
      validateInput: (value: string) =>
        value === "" ? "username must not be empty" : undefined
    });
    if (username === undefined) {
      return;
    }

    const conInfo = await this.passwordAndSslCertWizard(apiUrl, username);
    if (conInfo === undefined) {
      return;
    }
    const { password, serverCaCertificate } = conInfo;

    const accountName = await this.vscodeWindow.showInputBox({
      ignoreFocusOut,
      prompt: "Enter the name of this account.",
      validateInput: (value: string) =>
        value === "" ? "Account name must not be empty" : undefined,
      value: serverChoice === OBS ? "OBS" : undefined
    });
    if (accountName === undefined) {
      return;
    }

    let realname = await this.vscodeWindow.showInputBox({
      ignoreFocusOut,
      prompt: "Optional: Enter your real name"
    });
    if (realname === "") {
      realname = undefined;
    }

    let email = await this.vscodeWindow.showInputBox({
      ignoreFocusOut,
      prompt: "Optional: Enter your email address"
    });
    if (email === "") {
      email = undefined;
    }

    /* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition */
    assert(apiUrl !== undefined);
    apiUrl = normalizeUrl(apiUrl);

    const accountStorage = withoutUndefinedMembers({
      accountName,
      apiUrl,
      email,
      realname,
      serverCaCertificate,
      username
    });

    await this.runtimeAccountConfig.addAccount(accountStorage, password);
    await this.saveAccountsToStorage();
  }

  /**
   * Prompt the user for accounts in their .oscrc that are unknown to
   * vscode-obs.
   *
   * This function checks whether the configuration option if it should check
   * for unimported accounts. If it should, it finds all unimported accounts in
   * the user's `oscrc` and prompts the user whether they want to import
   * them. Otherwise it turns this check off.
   */
  public async promptForUninmportedAccountsInOscrc(): Promise<void> {
    const config = vscode.workspace.getConfiguration(
      CONFIGURATION_EXTENSION_NAME
    );

    if (!config.get<boolean>(CONFIGURATION_CHECK_UNIMPORTED_ACCOUNTS, true)) {
      return;
    }
    const unimportedAccounts = await this.unimportedAccountsInOscrc();

    if (unimportedAccounts.length > 0) {
      const importAccounts = "Import accounts now";
      const notNow = "Not now";
      const neverShowAgain = "Never show this message again";
      const selected = await this.vscodeWindow.showInformationMessage(
        "There are accounts in your oscrc configuration file, that have not been imported into Visual Studio Code. Would you like to import them?",
        importAccounts,
        notNow,
        neverShowAgain
      );
      if (selected === undefined) {
        return;
      }

      if (selected === importAccounts) {
        await this.importAccountsFromOsrc(unimportedAccounts);
      } else if (selected === neverShowAgain) {
        await config.update(
          CONFIGURATION_CHECK_UNIMPORTED_ACCOUNTS,
          false,
          vscode.ConfigurationTarget.Global
        );
      } else {
        assert(
          selected === notNow,
          `selected button should have been '${notNow}', but got '${selected}' instead`
        );
      }
    }
  }

  /**
   * Imports all not yet present accounts from the user's `oscrc` into VSCode's
   * settings.
   */
  @logAndReportExceptions()
  public async importAccountsFromOsrc(
    oscrcAccounts?: Account[]
  ): Promise<void> {
    if (oscrcAccounts === undefined) {
      oscrcAccounts = await this.readAccountsFromOscConfigs();
    }

    let added: boolean = false;

    for (const acc of oscrcAccounts) {
      const { apiUrl, password, aliases, ...rest } = acc;
      const fixedApiUrl = normalizeUrl(apiUrl);
      const accStorage: AccountStorage = {
        accountName: aliases.length === 0 ? fixedApiUrl : aliases[0],
        apiUrl: fixedApiUrl,
        ...rest
      };

      // account is not known => ask for the password
      if (this.activeAccounts.getConfig(accStorage.apiUrl) === undefined) {
        const pw =
          password ?? (await this.promptForAccountPassword(accStorage.apiUrl));
        if (pw !== undefined) {
          await this.runtimeAccountConfig.addAccount(accStorage, pw);
          added = true;
        }
      }
    }
    // no point in calling update when nothing will be added...
    if (added) {
      await this.saveAccountsToStorage();
    }
  }

  /**
   * Command to set the password of an account.
   *
   * This command prompts the user for the account which password should be
   * changed if the parameter `apiUrl` is undefined. If the user specifies a new
   * password, then the account is modified and all subscribers to the
   * [[onAccountChange]] Event are notified of the change.
   *
   * @param apiUrl  URL to the API, the user is prompted for this parameter if
   *     omitted.
   */
  @logAndReportExceptions(true)
  public async setAccountPasswordInteractive(apiUrl?: ApiUrl): Promise<void> {
    if (apiUrl === undefined) {
      apiUrl = await promptUserForAccount(
        this.activeAccounts,
        "Select the account for which you want to add a password",
        this.vscodeWindow
      );

      // user canceled the prompt
      if (apiUrl === undefined) {
        return;
      }
    }

    const activeAccount = this.activeAccounts.getConfig(apiUrl);

    if (activeAccount === undefined) {
      this.logger.error(
        "Did not get a Account & Connection for the API URL '%s'",
        apiUrl
      );
      return;
    }

    // user could have canceled the prompt, do nothing then
    const newPw = await this.promptForAccountPassword(apiUrl);
    if (newPw === undefined) {
      return;
    }

    const account = activeAccount.account;
    assert(
      account.apiUrl === normalizeUrl(account.apiUrl),
      `Account ${
        account.accountName
      } has an apiUrl that is not normalized: got: '${
        account.apiUrl
      }', should be: '${normalizeUrl(account.apiUrl)}'`
    );

    await this.runtimeAccountConfig.addAccount(account, newPw);
    this.notifyOffAccountChange();
  }

  /**
   * Check the supplied [[Connection]] `con` whether the API behind it is
   * healthy.
   * If the API is (somehow) broken and `askUser` is `true`, then the user will
   * be prompted whether they are fine with adding a broken API. If the API is
   * broken and `askUser` is `false`, then `false` is returned.
   */
  private async canUseThisConnection(
    con: Connection,
    askUser: boolean = true
  ): Promise<boolean> {
    const conState = await this.obsFetchers.checkConnection(con);
    if (conState.state === ConnectionState.Ok) {
      return true;
    }
    if (!askUser) {
      return false;
    }

    const msg = connectionStateToMessage(conState.state, con.url.href);
    const useAnyway = await this.vscodeWindow.showErrorMessage(
      msg.concat(". Would you like to add this account anyway?"),
      "Yes",
      "No"
    );

    return useAnyway === "Yes";
  }

  /**
   * Interactive wizard that prompts the user for their password, checks the
   * connection status to the API with the supplied `apiUrl` and if there is a
   * SSL issue, it provides the user with the option to either let the extension
   * fetch the SSL CA certificate or upload their own.
   *
   * @return An object that has the property `password` and optionally the
   *     `serverCaCertificate` as well (if the user supplied one). Or
   *     `undefined` is returned, if the user canceled the input or decided that
   *     they do not want to proceed.
   */
  private async passwordAndSslCertWizard(
    apiUrl: string,
    username: string
  ): Promise<ConnectionConstructionOptions | undefined> {
    const password = await this.promptForAccountPassword(apiUrl);
    if (password === undefined) {
      return;
    }
    assert(password !== "", "password must not be empty");

    let testCon = new Connection(username, password, {
      url: apiUrl,
      forceHttps: getForceHttpsSetting()
    });

    const conState = await this.obsFetchers.checkConnection(testCon);
    if (conState.state === ConnectionState.Ok) {
      return { password };
    }

    if (conState.state === ConnectionState.SslError) {
      const msg = `Tried to connect to ${apiUrl} but got a SSL error`.concat(
        conState.err !== undefined ? `: ${conState.err.toString()}` : "",
        ". Would you like to add a custom CA certificate?"
      );

      const addCert = await this.vscodeWindow.showErrorMessage(
        msg,
        "Yes",
        "No"
      );

      if (addCert === undefined) {
        return undefined;
      } else if (addCert === "No") {
        return { password };
      }

      let serverCaCertificate: string | undefined;

      const fromFile = "From the file system";
      const autoFetch = "Fetch automatically";
      const provideServerCertSource = await this.vscodeWindow.showQuickPick(
        [fromFile, autoFetch],
        {
          canPickMany: false,
          ignoreFocusOut,
          placeHolder: "How do you want to provide the CA certificate?"
        }
      );

      if (provideServerCertSource === undefined) {
        return undefined;
      } else if (provideServerCertSource === fromFile) {
        const serverCertFileUri = await this.vscodeWindow.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          filters: { Certificates: ["pem", "crt"] }
        });
        if (serverCertFileUri !== undefined) {
          assert(serverCertFileUri.length === 1);
          const certPath = serverCertFileUri[0].fsPath;
          try {
            serverCaCertificate = (
              await fsPromises.readFile(certPath)
            ).toString("ascii");
          } catch (err) {
            const errMsg = `Could not read the server certificate from the file '${certPath}', got the following error: ${(err as Error).toString()}`;
            this.logger.error(errMsg);
            await this.vscodeWindow.showErrorMessage(
              errMsg.concat(". This is not a fatal error.")
            );
          }
        }
      } else {
        const cert = await this.obsFetchers.fetchServerCaCertificate(testCon);
        const useThisCert = await this.vscodeWindow.showInformationMessage(
          `Got the CA certificate for ${apiUrl}: Issuer common name: ${cert.issuer.CN}, Issuer organization: ${cert.issuer.O}, sha256 fingerprint: ${cert.fingerprint256}. Add this certificate?`,
          "Yes",
          "No"
        );
        if (useThisCert === "No") {
          return { password };
        } else if (useThisCert === undefined) {
          return undefined;
        } else {
          assert(useThisCert === "Yes");
          serverCaCertificate = certificateToPem(cert);
        }
      }

      testCon = new Connection(username, password, {
        url: apiUrl,
        forceHttps: getForceHttpsSetting(),
        serverCaCertificate
      });

      return (await this.canUseThisConnection(testCon, true))
        ? withoutUndefinedMembers({ password, serverCaCertificate })
        : undefined;
    }

    const msg = connectionStateToMessage(conState.state, apiUrl);
    const useAnyway = await this.vscodeWindow.showErrorMessage(
      msg.concat(". Would you like to add this account anyway?"),
      "Yes",
      "No"
    );
    return useAnyway === undefined || useAnyway === "No"
      ? undefined
      : { password };
  }

  private async readAccountsFromOscConfigs(): Promise<Account[]> {
    const defaultAccounts = await this.obsFetchers.readAccountsFromOscrc();

    const res =
      defaultAccounts.length === 0
        ? await this.obsFetchers.readAccountsFromOscrc("~/.oscrc")
        : defaultAccounts;
    this.logger.trace(
      "Read the following accounts from osc's config file: %o",
      res.map((acc) => {
        // ensure that the password does not end up in the log
        const { password: _ignoreMe, ...rest } = acc;
        return rest;
      })
    );
    return res;
  }

  /**
   * Save the current account configuration to VSCode's storage without
   * triggering our [[configurationChangeListener]].
   */
  private async saveAccountsToStorage(): Promise<void> {
    this.onDidChangeConfigurationDisposable?.dispose();

    await this.runtimeAccountConfig.saveToStorage();
    this.notifyOffAccountChange();
    this.onDidChangeConfigurationDisposable = this.vscodeWorkspace.onDidChangeConfiguration(
      this.configurationChangeListener,
      this
    );
  }

  /**
   * Callback function that subscribes to the
   * [onDidChangeConfiguration](https://code.visualstudio.com/api/references/vscode-api#workspace.onDidChangeConfiguration)
   * Event and verifies that the new configuration is valid. If it is it prompts
   * the user for new passwords and fires the [[onAccountChange]] event.
   */
  private async configurationChangeListener(
    confChangeEvent: vscode.ConfigurationChangeEvent
  ): Promise<void> {
    if (
      !confChangeEvent.affectsConfiguration(CONFIGURATION_ACCOUNTS_FULL_NAME)
    ) {
      return undefined;
    }

    const {
      configModified,
      newAccountsWithoutPassword,
      errorMessages
    } = await this.runtimeAccountConfig.configurationChangeListener();

    await this.displayConfigurationLoadingFailedError(errorMessages);

    let shouldNotify = configModified;

    for (const account of newAccountsWithoutPassword) {
      const pw = await this.promptForAccountPassword(account.apiUrl);
      if (pw !== undefined) {
        await this.runtimeAccountConfig.addAccount(account, pw);
        shouldNotify = true;
      }
    }
    if (shouldNotify) {
      this.notifyOffAccountChange();
    }
  }

  /**
   * Check whether there are accounts in the user's `oscrc`, which have not been
   * imported into VSCode's settings.
   *
   * @return an array of accounts that have not yet been imported into VSCode's
   *       settings (it is empty if no accounts are unimported)
   */
  private async unimportedAccountsInOscrc(): Promise<Account[]> {
    this.logger.trace("Checking for unimported accounts");

    const accounts = await this.readAccountsFromOscConfigs();
    const oscrcAccountsApiUrls = accounts.map((acc) => acc.apiUrl);
    this.logger.trace("found the accounts in oscrc: %s", oscrcAccountsApiUrls);

    const storedAccountsApiUrls = this.activeAccounts.getAllApis();

    const oscrcAccounts = new Set(oscrcAccountsApiUrls);
    for (const storedAccount of this.activeAccounts.getAllApis()) {
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
        (acc) => apiUrls.find((url) => url === acc.apiUrl) !== undefined
      );
      assert(setDiff.size === res.length);
      return res;
    } else {
      return [];
    }
  }

  /**
   * Ask the user to supply an account password for the buildservice account
   * with the given API URL.
   */
  private async promptForAccountPassword(
    apiUrl: string
  ): Promise<string | undefined> {
    return this.vscodeWindow.showInputBox({
      ignoreFocusOut,
      password: true,
      prompt: `set the password for the account ${apiUrl}`,
      validateInput: (val) =>
        val === "" ? "Password must not be empty" : undefined
    });
  }

  /**
   * Show a pretty formatted error message that notifies the user off multiple
   * errors that were found when loading their account configuration.
   */
  private async displayConfigurationLoadingFailedError(
    errMsgs: string[]
  ): Promise<void> {
    if (errMsgs.length !== 0) {
      await this.vscodeWindow.showErrorMessage(
        `Got the following error${
          errMsgs.length === 1 ? "" : "s"
        } when loading your configuration: ${errMsgs.join("\n")}`,
        {}
      );
    }
  }

  /** Fire the [[onAccountChange]] event. */
  private notifyOffAccountChange(): void {
    this.onAccountChangeEmitter.fire(this.activeAccounts.getAllApis());
  }
}
