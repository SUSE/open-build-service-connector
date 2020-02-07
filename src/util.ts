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
import { join } from "path";
import { Logger } from "pino";
import * as vscode from "vscode";
import * as assert from "assert";

/**
 * Returns the difference `setA - setB` (all elements from A that are not in B).
 */
export function setDifference<T>(setA: Set<T>, setB: Set<T>): Set<T> {
  const difference: Set<T> = new Set();
  setA.forEach(val => {
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
  return new Map(memento.get<Array<[K, T]>>(storageKey, []));
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

/** Remove the directory `dir` recursively */
export async function rmRf(dir: string): Promise<void> {
  const dentries = await fsPromises.readdir(dir, { withFileTypes: true });

  await Promise.all(
    dentries.map(async dentry => {
      if (dentry.isFile()) {
        await fsPromises.unlink(join(dir, dentry.name));
      } else if (dentry.isDirectory()) {
        await rmRf(join(dir, dentry.name));
        await fsPromises.rmdir(join(dir, dentry.name));
      }
    })
  );
}

/** Create a deep copy of `obj` omitting **all** functions. */
export function deepCopyProperties<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export async function apiCallReportWrapper<RT>(
  apiCaller: () => Promise<RT>,
  logger: Logger,
  showErrorMessage: typeof vscode.window.showErrorMessage = vscode.window
    .showErrorMessage
): Promise<RT | undefined> {
  try {
    return apiCaller();
  } catch (err) {
    const errMsg = "Error performing an API call, got: ".concat(
      err.status !== undefined && err.status.summary !== undefined
        ? err.status.summary
        : err
    );

    logger.error(errMsg);
    await showErrorMessage(errMsg);
    return undefined;
  }
}

/**
 * General purpose decorator for **async** functions that throw an exception
 * that should be logged and optionally reported to the user.
 */
export function logAndReportExceptions(reportToUser: boolean = true) {
  const reportFunc = async (decoratedObj: any, err: any) => {
    const errMsg = "Error performing an API call, got: ".concat(
      err.status !== undefined && err.status.summary !== undefined
        ? err.status.summary
        : err
    );

    (decoratedObj as any).logger.error(errMsg);
    if (reportToUser) {
      await (decoratedObj as any).vscodeWindow.showErrorMessage(errMsg);
    }
  };
  return (
    target: object,
    key: string | symbol,
    descriptor: PropertyDescriptor | undefined
  ) => {
    // save a reference to the original method this way we keep the values
    // currently in the descriptor and don't overwrite what another decorator
    // might have done to the descriptor.
    if (descriptor === undefined) {
      descriptor = Object.getOwnPropertyDescriptor(target, key);
    }

    assert(
      descriptor !== undefined,
      `Cannot decorate the property ${String(
        key
      )} from the target ${target}: cannot get the descriptor`
    );
    const originalMethod = descriptor!.value;

    descriptor!.value = async function() {
      const args = [];

      for (let i = 0; i < arguments.length; i++) {
        args[i - 0] = arguments[i];
      }

      try {
        const res = originalMethod.apply(this, args);
        if (res.then !== undefined) {
          return await res;
        } else {
          return res;
        }
      } catch (err) {
        reportFunc(this, err);
        return undefined;
      }
    };

    return descriptor;
  };
}
