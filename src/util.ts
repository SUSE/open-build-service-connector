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

import * as assert from "assert";
import { promises as fsPromises } from "fs";
import { join } from "path";
import * as vscode from "vscode";

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

/**
 * General purpose decorator for member functions that throw an exception that
 * should be logged and optionally reported to the user.
 *
 * This decorator can be used to wrap existing functions that report errors by
 * throwing exceptions. It replaces the call to the original function with one
 * that catches errors and logs them via the `this.logger.error()` method
 * (i.e. the wrapped method should e.g. inherit from [[LoggingBase]]) thereby
 * writing a full backtrace into the log. By default the error is also converted
 * into a human readable string and presented to the user via
 * `this.vscodeWindow.showErrorMessage`. This behavior can be turned off by
 * setting `reportToUser` to `false`.
 *
 * ## Caution
 *
 * 1. This decorator will implicitly convert non-async functions into async
 *    ones!
 *    This is unfortunately necessary, as showing errors to the user is an
 *    asynchronous operation.
 *
 * 2. If your method throws an exception, then the wrapped method will return
 *    undefined.
 *
 * ## Error reporting
 *
 * This decorator always logs any caught exceptions in their raw form, i.e. you
 * will get a full backtrace in the log.
 * The user is only presented with the stringified form of the error via
 * `.toString()` or with the `summary` entry if the error is a status_reply xml
 * element returned by OBS.
 */
export function logAndReportExceptions(reportToUser: boolean = true) {
  const reportFunc = async (decoratedObj: any, err: any) => {
    const errMsg =
      err.status !== undefined && err.status.summary !== undefined
        ? "Error performing API call: ".concat(err.status.summary)
        : err.toString();

    (decoratedObj as any).logger.error(err);
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
        await reportFunc(this, err);
        return undefined;
      }
    };

    return descriptor;
  };
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
) {
  const reportFunc = async (err: any) => {
    const errMsg =
      err.status !== undefined && err.status.summary !== undefined
        ? "Error performing API call: ".concat(err.status.summary)
        : err.toString();

    reportObj.logger.error(err);
    if (reportToUser) {
      await (reportObj as any).vscodeWindow!.showErrorMessage(errMsg);
    }
  };

  return async (): Promise<RT | undefined> => {
    try {
      return await func.apply(undefined, args);
    } catch (err) {
      await reportFunc(err);
      return undefined;
    }
  };
}
