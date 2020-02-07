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

import { should, use } from "chai";
import * as chaiAsPromised from "chai-as-promised";
import * as chaiThings from "chai-things";
import * as pino from "pino";
import { SinonSandbox } from "sinon";
import * as vscode from "vscode";

use(chaiThings);
use(chaiAsPromised);
should();

export const logger = pino(
  { level: "trace" },
  pino.destination("./logfile.json")
);

export interface FakeEvent<T> {
  listeners: Array<(e: T) => void>;

  fire: (e: T) => void;

  event: (listener: (e: T) => void) => vscode.Disposable;
}

export function makeFakeEvent<T>(): FakeEvent<T> {
  const listeners: Array<(e: T) => void> = [];

  const fire = (e: T) => {
    listeners.forEach(listener => listener(e));
  };

  const event = (listener: (e: T) => void) => {
    listeners.push(listener);
    return { dispose: () => {} };
  };

  return { listeners, event, fire };
}

export const createStubbedVscodeWindow = (sandbox: SinonSandbox) => ({
  showErrorMessage: sandbox.stub(),
  showInformationMessage: sandbox.stub(),
  showInputBox: sandbox.stub(),
  showQuickPick: sandbox.stub()
});

export async function waitForEvent<T>(
  event: vscode.Event<T>
): Promise<vscode.Disposable> {
  return new Promise(resolve => {
    const disposable = event(_ => {
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
