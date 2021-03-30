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

import { getExtensionLogger } from "@vscode-logging/logger";
import { should, use } from "chai";
import * as chaiAsPromised from "chai-as-promised";
import * as chaiThings from "chai-things";
import { AsyncFunc, Context, Func } from "mocha";
import { SinonSandbox } from "sinon";
import * as sinonChai from "sinon-chai";
import * as vscode from "vscode";
import { DisposableBase } from "../../base-components";
import { EXTENSION_NAME } from "../../logging";
import { makeFakeEventEmitter } from "./fakes";
import { getTmpPrefix } from "./utilities";

use(chaiThings);
use(chaiAsPromised);
use(sinonChai);
should();

export const testLogger = getExtensionLogger({
  level: "trace",
  extName: `${EXTENSION_NAME}.Testing`,
  logPath: getTmpPrefix(),
  sourceLocationTracking: true
});

export const createStubbedVscodeWindow = (sandbox: SinonSandbox) => {
  const emiter = makeFakeEventEmitter<vscode.TextEditor | undefined>();

  return {
    showErrorMessage: sandbox.stub(),
    showInformationMessage: sandbox.stub(),
    showInputBox: sandbox.stub(),
    showOpenDialog: sandbox.stub(),
    showQuickPick: sandbox.stub(),
    withProgress: sandbox.stub(),
    onDidChangeActiveTextEditorEmiter: emiter,
    onDidChangeActiveTextEditor: emiter.event,
    activeTextEditor: undefined as vscode.TextEditor | undefined,
    visibleTextEditors: [] as vscode.TextEditor[]
  };
};

export const createStubbedObsFetchers = (sandbox: SinonSandbox) => ({
  branchPackage: sandbox.stub(),
  fetchFileContents: sandbox.stub(),
  fetchPackage: sandbox.stub(),
  fetchProject: sandbox.stub(),
  readInUnifiedPackage: sandbox.stub(),
  submitPackage: sandbox.stub(),
  checkConnection: sandbox.stub(),
  readAccountsFromOscrc: sandbox.stub(),
  fetchServerCaCertificate: sandbox.stub(),
  checkOutProject: sandbox.stub(),
  checkOutPackage: sandbox.stub()
});

export async function waitForEvent<T>(
  event: vscode.Event<T>
): Promise<vscode.Disposable> {
  return new Promise((resolve) => {
    const disposable = event((_) => {
      resolve(disposable);
    });
  });
}

export async function executeAndWaitForEvent<T, ET>(
  func: () => Thenable<T>,
  event: vscode.Event<ET>
): Promise<T> {
  const [res, disposable] = await Promise.all([func(), waitForEvent(event)]);
  disposable.dispose();
  return res;
}

/** Sleep for at least the given time in ms */
export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const castToFuncT = <FC, FT>(func: (this: FC) => void): FT =>
  (func as any) as FT;

export const castToAsyncFunc = <FC>(func: (this: FC) => void): AsyncFunc =>
  castToFuncT<FC, AsyncFunc>(func);

export const castToFunc = <FC>(func: (this: FC) => void): Func =>
  castToFuncT<FC, Func>(func);

export class LoggingFixture extends DisposableBase {
  constructor(ctx: Context) {
    super();
    testLogger.info("Starting test %s", ctx.currentTest?.titlePath());
  }

  public afterEach(ctx: Context) {
    testLogger.info("Finished test %s", ctx.currentTest?.titlePath());
  }
}
