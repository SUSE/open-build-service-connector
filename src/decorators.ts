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
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/restrict-template-expressions */

import * as assert from "assert";

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
export function logAndReportExceptions(
  reportToUser: boolean = true
): (
  target: any,
  key: string | symbol,
  descriptor: PropertyDescriptor | undefined
) => PropertyDescriptor {
  const reportFunc = async (decoratedObj: any, err: any): Promise<void> => {
    const errMsg =
      err.status !== undefined && err.status.summary !== undefined
        ? "Error performing API call: ".concat(err.status.summary)
        : err.toString();

    decoratedObj.logger.error(err);
    if (reportToUser) {
      await decoratedObj.vscodeWindow.showErrorMessage(errMsg);
    }
  };
  return (
    target: any,
    key: string | symbol,
    descriptor: PropertyDescriptor | undefined
  ): PropertyDescriptor => {
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
    const originalMethod = descriptor.value;

    // cannot get the return type of the following function
    /* eslint-disable-next-line @typescript-eslint/explicit-function-return-type */
    descriptor.value = async function () {
      const args = [];

      for (let i = 0; i < arguments.length; i++) {
        args[i - 0] = arguments[i];
      }

      try {
        const res = originalMethod.apply(this, args);
        if (res.then !== undefined) {
          /* eslint-disable-next-line @typescript-eslint/no-unsafe-return */
          return await res;
        } else {
          /* eslint-disable-next-line @typescript-eslint/no-unsafe-return */
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

// stolen from: https://github.com/JohnstonCode/svn-scm/blob/master/src/decorators.ts
// published under the MIT license as well
/** Apply the `decorator` function to a member function of a class */
function decorate(
  decorator: (fn: (...args: any[]) => void, key: string) => void
): (_target: any, key: string, descriptor: any) => void {
  return (_target: any, key: string, descriptor: any): void => {
    let fnKey: string | null = null;
    let fn: ((...args: any[]) => void) | null = null;

    if (typeof descriptor.value === "function") {
      fnKey = "value";
      fn = descriptor.value;
    } else if (typeof descriptor.get === "function") {
      fnKey = "get";
      fn = descriptor.get;
    }

    if (!fn || !fnKey) {
      throw new Error("not supported");
    }

    // eslint is complaining here, that we call decorator or fn directly, but
    // that's actually what we want to do…
    /* eslint-disable-next-line @typescript-eslint/no-confusing-void-expression */
    descriptor[fnKey] = decorator(fn, key);
  };
}

/**
 * Decorator for class properties that ensures that the decorated method is
 * called with a delay of `delayMs`. Repeated calls during the delay reset the
 * timer.
 */
export function debounce(
  delayMs: number
): (_target: any, key: string, descriptor: any) => void {
  return decorate((fn, key) => {
    const timerKey = `$debounce$${key}`;

    return function (this: any, ...args: any[]): void {
      clearTimeout(this[timerKey]);
      this[timerKey] = setTimeout(() => fn.apply(this, args), delayMs);
    };
  });
}
