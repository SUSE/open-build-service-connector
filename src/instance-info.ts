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

import {
  Arch,
  Distribution,
  fetchConfiguration,
  fetchHostedDistributions
} from "obs-ts";
import { Logger } from "pino";
import * as vscode from "vscode";
import { AccountManager, ApiUrl } from "./accounts";
import { ConnectionListenerLoggerBase } from "./base-components";
import { cmdPrefix } from "./constants";
import { logAndReportExceptionsWrapper } from "./util";

/** Information about an instance of the Open Build Service. */
export interface ObsInstance {
  /** URL to the API, used for identification purposes. */
  readonly apiUrl: ApiUrl;

  /**
   * Linux distributions known to this instance that can be directly added via
   * the web UI.
   */
  readonly hostedDistributions?: readonly Distribution[];

  /**
   * Architectures for which this instance has runners or all known
   * architectures if the instance does not provide this information.
   */
  readonly supportedArchitectures?: readonly Arch[];

  /** List of all projects on this instance */
  readonly projectList?: readonly string[];
}

/**
 * Name of the command to retrieve the information about a specific OBS
 * instance.
 *
 * The command takes a single parameter: the API Url of the instance and returns
 * a [[ObsInstance]] object if it is known or `undefined` otherwise.
 */
export const GET_INSTANCE_INFO_COMMAND = `${cmdPrefix}.ObsServerInfo.getInfo`;

/**
 * Name of the command to force an update of all stored information about the
 * known instances.
 */
export const UPDATE_INSTANCE_INFO_COMMAND = `${cmdPrefix}.ObsServerInfo.updateInfo`;

/**
 * Class that stores and retrieves additional information about the known OBS
 * instances.
 *
 * It is primarily intended to be used via the command specified in the string
 * [[GET_INSTANCE_INFO_COMMAND]], which is bound to the method [[getInfo]].
 *
 * If necessary, other classes can force an update of the stored data via the
 * method [[updateAllInstanceInfos]] or via the command with the string stored
 * in the variable [[UPDATE_INSTANCE_INFO_COMMAND]]. Note that this function is
 * automatically invoked if an account change is detected.
 */
export class ObsServerInformation extends ConnectionListenerLoggerBase {
  /**
   * Promise that resolves once the initial ObsInstance data fetch is completed.
   */
  public readonly initialInstanceInfoRetrieved: Promise<void>;

  private instances: ObsInstance[] = [];

  constructor(accountManager: AccountManager, logger: Logger) {
    super(accountManager, logger);

    this.disposables.push(
      this.onAccountChange(
        async (apiUrls) => this.updateAllInstanceInfos(apiUrls),
        this
      ),
      vscode.commands.registerCommand(
        GET_INSTANCE_INFO_COMMAND,
        this.getInfo,
        this
      ),
      vscode.commands.registerCommand(
        UPDATE_INSTANCE_INFO_COMMAND,
        this.updateAllInstanceInfos,
        this
      )
    );

    // We shall be nasty here and don't await the Promise, because it can take
    // ages to resolve.
    // That is pretty hacky, but the called function *should* not throw any
    // exceptions and just log them.
    this.initialInstanceInfoRetrieved = this.updateAllInstanceInfos(
      accountManager.activeAccounts.getAllApis()
    );
  }

  /**
   * Get the [[ObsInstance]] belonging to the server with the provided `apiUrl`.
   *
   * This function is also available via the command
   * [[GET_INSTANCE_INFO_COMMAND]].
   *
   * @return
   *     - `undefined` if `apiUrl` is `undefined` or if no instance with the
   *       given apiUrl is known
   *     - the currently known information about the specified instance
   */
  public getInfo(apiUrl?: ApiUrl): ObsInstance | undefined {
    if (apiUrl === undefined) {
      this.logger.error(
        "ObsServerInformation.getInfo was invoked without a apiUrl"
      );
      return;
    }
    const account = this.activeAccounts.getConfig(apiUrl);
    if (account === undefined) {
      this.logger.error(
        "An unknown instance was requested with the API URL '%s'",
        apiUrl
      );
      return undefined;
    }
    const existingInfo = this.instances.find(
      (obsInstance) => obsInstance.apiUrl === apiUrl
    );
    return existingInfo;
  }

  /**
   * Updates the internally stored [[ObsInstance]] data structures for all known
   * instances and purges no longer known ones.
   *
   * Note: this function is automatically called on account changes and need
   * only be invoked if the stored data appear to be stale.
   */
  public async updateAllInstanceInfos(apiUrls?: ApiUrl[]): Promise<void> {
    if (apiUrls === undefined) {
      apiUrls = this.activeAccounts.getAllApis();
    }
    this.logger.trace(
      "Updating all instanceInfos for the API(s): %s",
      apiUrls.join(", ")
    );

    const instanceInfos = await Promise.all(
      apiUrls.map((apiUrl) => this.fetchInstanceInfoForApi(apiUrl))
    );

    this.instances = [];
    instanceInfos.forEach((instanceInfo) => {
      if (instanceInfo !== undefined) {
        this.instances.push(instanceInfo);
      }
    });
  }

  private async fetchInstanceInfoForApi(
    apiUrl: ApiUrl
  ): Promise<ObsInstance | undefined> {
    const connection = this.activeAccounts.getConfig(apiUrl)?.connection;

    if (connection === undefined) {
      return undefined;
    }

    const [conf, distros] = await Promise.all([
      logAndReportExceptionsWrapper(
        this,
        false,
        fetchConfiguration,
        connection
      )(),
      logAndReportExceptionsWrapper(
        this,
        false,
        fetchHostedDistributions,
        connection
      )()
    ]);

    return {
      apiUrl,
      hostedDistributions: distros,
      supportedArchitectures: conf?.schedulers
    };
  }
}
