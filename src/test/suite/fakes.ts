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

import * as vscode from "vscode";
import {
  AccountManager,
  ActiveAccounts,
  ApiUrl,
  ValidAccount
} from "../../accounts";
import { ActiveProject, ActiveProjectWatcher } from "../../workspace";

export interface FakeEvent<T> {
  listeners: ((e: T) => any)[];

  fire: (e: T) => Promise<void>;

  event: (listener: (e: T) => any) => vscode.Disposable;
}

export function makeFakeEvent<T>(): FakeEvent<T> {
  const listeners: ((e: T) => any)[] = [];

  const fire = async (e: T) => {
    listeners.map(async (listener) => {
      // const res = listener(e);
      // if (res.then !== undefined) {
      //   await res;
      // }
      await listener(e);
    });
  };

  const event = (listener: (e: T) => any) => {
    listeners.push(listener);
    return {
      dispose: () => {
        // do nothing on purpose
      }
    };
  };

  return { listeners, event, fire };
}

export type AccountMapInitializer =
  | Map<ApiUrl, ValidAccount>
  | [ApiUrl, ValidAccount][];

class FakeActiveAccounts implements ActiveAccounts {
  public onAccountChangeEmitter = makeFakeEvent<ApiUrl[]>();
  public onAccountChange: vscode.Event<ApiUrl[]> = this.onAccountChangeEmitter
    .event;

  public accountMap: Map<ApiUrl, ValidAccount>;

  constructor(initialAccountMap?: AccountMapInitializer) {
    if (initialAccountMap === undefined) {
      this.accountMap = new Map();
    } else if (Array.isArray(initialAccountMap)) {
      this.accountMap = new Map(initialAccountMap);
    } else {
      this.accountMap = initialAccountMap;
    }
  }

  public async addAccount(acc: ValidAccount) {
    this.accountMap.set(acc.account.apiUrl, acc);
    await this.onAccountChangeEmitter.fire(this.getAllApis());
  }

  public getConfig(apiUrl: ApiUrl) {
    return this.accountMap.get(apiUrl);
  }

  public getAllApis() {
    return [...this.accountMap.keys()];
  }
}

export class FakeAccountManager implements AccountManager {
  public activeAccounts: FakeActiveAccounts;
  public onAccountChange: vscode.Event<ApiUrl[]>;

  constructor(initialAccountMap?: AccountMapInitializer) {
    const fakeActAcc = new FakeActiveAccounts(initialAccountMap);
    this.activeAccounts = fakeActAcc;
    this.onAccountChange = fakeActAcc.onAccountChange;
  }

  // public setAccounts(accMap: AccountMapInitializer) {
  //   // const fakeActAcc = new FakeActiveAccounts(accMap);
  //   // this.activeAccounts = fakeActAcc
  // }

  public dispose() {
    // do nothin'
  }
}

/**
 * Class for mocking an ActiveProjectWatcher: it has the same public members but
 * allows you to set the currently active project yourself.
 */
export class FakeActiveProjectWatcher implements ActiveProjectWatcher {
  public activeProject: ActiveProject;

  public readonly onDidChangeActiveProjectEmitter = makeFakeEvent<
    ActiveProject
  >();

  public readonly onDidChangeActiveProject: vscode.Event<ActiveProject> = this
    .onDidChangeActiveProjectEmitter.event;

  constructor(initialActiveProject?: ActiveProject) {
    this.activeProject = initialActiveProject ?? { activeProject: undefined };
  }

  public dispose() {
    // nothing to get rid off
  }

  public getActiveProject(): ActiveProject {
    return this.activeProject;
  }

  public async setActiveProject(activeProject: ActiveProject): Promise<void> {
    this.activeProject = activeProject;
    await this.onDidChangeActiveProjectEmitter.fire(activeProject);
  }
}
