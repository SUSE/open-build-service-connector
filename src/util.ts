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
import { Logger } from "pino";
import { VscodeWindow } from "./vscode-dep";
import { GET_INSTANCE_INFO_COMMAND, ObsInstance } from "./instance-info";
import { ignoreFocusOut } from "./constants";

/**
 * Returns the difference `setA - setB` (all elements from A that are not in B).
 */
export function setDifference<T>(setA: Set<T>, setB: Set<T>): Set<T> {
  const difference: Set<T> = new Set();
  setA.forEach((val) => {
    if (!setB.has(val)) {
      difference.add(val);
    }
  });

  return difference;
}

/**
 * Given a Map that was stored in the memento under the key `storageKey` as an
 * array of Tuples of the type `[K, T]`, this function constructs the Map and
 * returns it.
 *
 * This function is the inverse of [[saveMapToMemento]].
 *
 * @param memento  The
 *     [Memento](https://code.visualstudio.com/api/references/vscode-api#Memento)
 *     from which the Map should be constructed.
 *
 * @param storageKey  The key under which the Map's data have been saved.
 *
 * @return  The Map that has been saved by [[saveMapToMemento]].
 */
export function loadMapFromMemento<K, T>(
  memento: vscode.Memento,
  storageKey: string
): Map<K, T> {
  return new Map(memento.get<[K, T][]>(storageKey, []));
}

/**
 * Save the Map `map` to the given `memento` as an array of Tuples of type `[K, T]`.
 */
export async function saveMapToMemento<K, T>(
  memento: vscode.Memento,
  storageKey: string,
  map: Map<K, T>
): Promise<void> {
  await memento.update(storageKey, [...map.entries()]);
}

/** Create a deep copy of `obj` omitting **all** functions. */
export function deepCopyProperties<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Wrapper for free functions that can throw exceptions that should just be
 * logged and optionally reported to the user.
 *
 * @param reportObj  A object that has a `logger` property and optionally a
 *     `vscodeWindow` one if `reportToUser` is `true`.
 * @param reportToUser Flag whether any thrown exceptions should also be
 *     displayed as error messages to the user via
 *     `vscodeWindow.showErrorMessage`.
 * @param func  A free function that should be called.
 * @param args  Parameters that are passed to func.
 *
 * @return Either the return value of `func(args)` or `undefined` if an
 *     exception was thrown.
 */
export function logAndReportExceptionsWrapper<RT>(
  reportObj: any,
  reportToUser: boolean = true,
  func: (...args: any[]) => Promise<RT>,
  ...args: any[]
): () => Promise<RT | undefined> {
  const reportFunc = async (err: any) => {
    const errMsg =
      err.status !== undefined && err.status.summary !== undefined
        ? "Error performing API call: ".concat(err.status.summary)
        : err.toString();

    reportObj.logger.error(err);
    if (reportToUser) {
      await reportObj.vscodeWindow.showErrorMessage(errMsg);
    }
  };

  return async (): Promise<RT | undefined> => {
    try {
      return await func.apply(reportObj, args);
    } catch (err) {
      await reportFunc(err);
      return undefined;
    }
  };
}

export async function logException<RT>(
  logger: Logger,
  func: () => Promise<RT>,
  description: string = "Function"
): Promise<RT | undefined> {
  try {
    return await func();
  } catch (err) {
    logger.error("%s failed with %s", description, err.toString());
    return undefined;
  }
}

export async function promptUserForProjectName(
  apiUrl: string,
  prompt?: string,
  vscodeWindow: VscodeWindow = vscode.window
): Promise<string | undefined> {
  const instanceInfo = await vscode.commands.executeCommand<ObsInstance>(
    GET_INSTANCE_INFO_COMMAND,
    apiUrl
  );

  if (
    instanceInfo !== undefined &&
    instanceInfo.projectList !== undefined &&
    instanceInfo.projectList.length > 0
  ) {
    return await vscodeWindow.showQuickPick(
      instanceInfo.projectList as string[],
      {
        canPickMany: false,
        placeHolder: prompt,
        ignoreFocusOut
      }
    );
  } else {
    return await vscodeWindow.showInputBox({
      ignoreFocusOut,
      prompt,
      validateInput: (projName) =>
        /\s/.test(projName) || projName === ""
          ? "The project name must not contain any whitespace and must not be empty"
          : undefined
    });
  }
}
