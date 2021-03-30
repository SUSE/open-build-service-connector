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

/* eslint-disable @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/no-unsafe-call */

import { promises as fsPromises } from "fs";
import {
  fetchProject,
  pathExists,
  PathType,
  zip
} from "open-build-service-api";
import { join, resolve } from "path";
import { IChildLogger, IVSCodeExtLogger } from "@vscode-logging/logger";
import * as vscode from "vscode";
import { ActiveAccounts, promptUserForAccount } from "./accounts";
import { assert } from "./assert";
import { BasePackage } from "./base-components";
import { showComboBoxInput } from "./combo-box-input";
import { ignoreFocusOut } from "./constants";
import { VscodeWindow } from "./dependency-injection";
import { GET_INSTANCE_INFO_COMMAND, ObsInstance } from "./instance-info";

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

/** Returns the union of the sets `setA` and `setB` */
export function setUnion<T>(setA: Set<T>, setB: Set<T>): Set<T> {
  const union = new Set<T>();
  [...setA.values(), ...setB.values()].forEach((val) => union.add(val));
  return union;
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

export function deepCopyProperties(obj: undefined): undefined;
export function deepCopyProperties<T>(obj: T): T;

/** Create a deep copy of `obj` omitting **all** functions. */
export function deepCopyProperties<T>(obj?: T): T | undefined {
  return obj === undefined ? undefined : (JSON.parse(JSON.stringify(obj)) as T);
}

/**
 * Checks whether the objects `obj1` and `obj2` have the same keys and whether
 * all elements are equal.
 */
function objsEqual(obj1: any, obj2: any): boolean {
  const keysOf1 = Object.keys(obj1);
  const keysOf2 = Object.keys(obj2);

  if (!arraysEqual(keysOf1, keysOf2)) {
    return false;
  }
  for (const key of keysOf1) {
    if (!deepEqual(obj1[key], obj2[key])) {
      return false;
    }
  }
  return true;
}

function arraysEqual<T, U>(
  arr1: T[] | readonly T[],
  arr2: U[] | readonly U[]
): boolean {
  if (arr1.length !== arr2.length) {
    return false;
  }
  for (const [elem1, elem2] of zip(arr1, arr2)) {
    if (!deepEqual(elem1, elem2)) {
      return false;
    }
  }
  return true;
}

/**
 * Perform a check of two arbitrary objects for deep equality.
 *
 * This function recursively checks all elements or entries of `a` and `b` for
 * equality until either one of them does not match or if all are equal, then
 * `true` is returned.
 *
 * Objects are compared by checking each key for equality. Arrays are compared
 * element wise. All other types are compared using the equality operator `===`.
 */
export function deepEqual(a: any, b: any): boolean {
  if (a === b) {
    return true;
  }

  const typeOfA = typeof a;

  if (typeOfA !== typeof b) {
    return false;
  }

  if (
    typeOfA === "string" ||
    typeOfA === "boolean" ||
    typeOfA === "number" ||
    typeOfA === "bigint" ||
    typeOfA === "undefined" ||
    typeOfA === "function"
  ) {
    // FIXME: this will probably always return false as we checked whether a === b in the first line
    return a === b;
  } else if (typeOfA === "symbol") {
    // FIXME: don't know how to handle symbols
    return false;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    return arraysEqual(a, b);
  } else if (!Array.isArray(a) && !Array.isArray(b)) {
    return objsEqual(a, b);
  } else {
    return false;
  }
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
  const reportFunc = async (err: any): Promise<void> => {
    /* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment */
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
  logger: IVSCodeExtLogger | IChildLogger,
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

/**
 * Ask the user to supply the name of a project belonging to the server with the
 * supplied `apiUrl`.
 *
 * The user is presented with a
 * [`QuickPick`](https://code.visualstudio.com/api/references/vscode-api#QuickPick)
 * when a list of all projects from the OBS instance can be retrieved, where
 * they can select from all known projects or to enter the project name
 * manually.
 * If the list of projects cannot be retrieved or when the user selects to enter
 * the project name manually, then they get presented with an
 * [`InputBox`](https://code.visualstudio.com/api/references/vscode-api#InputBox)
 * as a free form field.
 *
 * @param prompt  This text is displayed under the `InputBox` or in the
 *     `QuickPick` as guidance for the user.
 * @param vscodeWindow  Optional dependency injection object for mocking the
 *     calls to the vscode API.
 *
 * @return The project name or `undefined` when the user let the prompt time out.
 */
export async function promptUserForProjectName(
  apiUrl: string,
  prompt?: string,
  vscodeWindow: VscodeWindow = vscode.window
): Promise<string | undefined> {
  const instanceInfo = await vscode.commands.executeCommand<ObsInstance>(
    GET_INSTANCE_INFO_COMMAND,
    apiUrl
  );
  const CUSTOM_NAME = "$(record-keys) Entered project: ";

  if (
    instanceInfo !== undefined &&
    instanceInfo.projectList !== undefined &&
    instanceInfo.projectList.length > 0
  ) {
    const projName = await showComboBoxInput(
      (instanceInfo.projectList as string[]).map((value) => ({
        label: value,
        alwaysShow: false,
        value
      })),
      (value: string) =>
        value === ""
          ? []
          : [
              {
                alwaysShow: true,
                label: `$(record-keys) Entered project: ${value}`,
                description: "Use this project directly",
                value
              }
            ],
      { placeHolder: prompt, ignoreFocusOut, insertBeforeIndex: 0 }
    );
    if (
      projName === undefined ||
      projName.label.slice(0, CUSTOM_NAME.length) !== CUSTOM_NAME
    ) {
      return projName?.label;
    } else {
      return projName.value;
    }
  }
  return await vscodeWindow.showInputBox({
    ignoreFocusOut,
    prompt,
    validateInput: (projName) =>
      /\s/.test(projName) || projName === ""
        ? "The project name must not contain any whitespace and must not be empty"
        : undefined
  });
}

export async function promptUserForPackage(
  activeAccounts: ActiveAccounts,
  vscodeWindow: VscodeWindow = vscode.window
): Promise<BasePackage | undefined> {
  const apiUrl = await promptUserForAccount(
    activeAccounts,
    "Select the account to which the package belongs",
    vscodeWindow
  );
  if (apiUrl === undefined) {
    return undefined;
  }
  const projectName = await promptUserForProjectName(
    apiUrl,
    "Provide the name of the project to which the package belongs",
    vscodeWindow
  );
  if (projectName === undefined) {
    return undefined;
  }

  const con = activeAccounts.getConfig(apiUrl)?.connection;
  assert(
    con !== undefined,
    "Connection must not be undefined as the user selected a valid account"
  );

  const proj = await fetchProject(con, projectName, { fetchPackageList: true });

  if (proj.packages.length === 0) {
    await vscodeWindow.showErrorMessage(
      `The project ${projectName} has no packages!`
    );
    return undefined;
  }

  const pkgName = await vscodeWindow.showQuickPick(
    proj.packages.map((pkg) => pkg.name),
    {
      canPickMany: false,
      placeHolder: "Select a package",
      ignoreFocusOut
    }
  );

  return pkgName === undefined
    ? undefined
    : new BasePackage(apiUrl, projectName, pkgName);
}

export function isUri(obj: any): obj is vscode.Uri {
  if (obj === undefined) {
    return false;
  }
  for (const prop of ["scheme", "authority", "path", "query", "fragment"]) {
    if (obj[prop] === undefined || typeof obj[prop] !== "string") {
      return false;
    }
  }
  return true;
}

export function dropUndefined<T>(arr: (T | undefined)[]): T[];
export function dropUndefined<T>(arr: readonly (T | undefined)[]): readonly T[];

/** Remove all elements from `arr` that are `undefined` */
export function dropUndefined<T>(
  arr: (T | undefined)[] | readonly (T | undefined)[]
): T[] | readonly T[] {
  return arr.filter((elem) => elem !== undefined) as T[];
}

/**
 * Returns a function that inserts a new array into `items` before the specified
 * index (or appends it if `insertBeforeIndex` is undefined).
 *
 * This function caches intermediate results and should be faster for large
 * arrays if `insertBeforeIndex` is defined and non-zero than a direct
 * implementation.
 */
export function createItemInserter<T>(
  items: T[] | readonly T[],
  insertBeforeIndex?: number
): (newItems: T[] | readonly T[]) => T[] | readonly T[] {
  if (insertBeforeIndex === undefined) {
    return (newItems): T[] => items.concat(newItems);
  } else if (insertBeforeIndex === 0) {
    return (newItems): T[] => newItems.concat(items);
  } else {
    const [firstPart, secondPart] = [
      items.slice(0, insertBeforeIndex),
      items.slice(insertBeforeIndex)
    ];
    return (newItems): T[] => firstPart.concat(newItems, secondPart);
  }
}

const MEDIA_DIR = resolve(__dirname, "..", "media");

export interface IconPath {
  readonly light: string;
  readonly dark: string;
}

/**
 * Creates a decoration object for a Source Control Resource from the provided
 * `fileName`. This should be a svg or png that is in the `media/{dark|light}`
 * subfolders
 */
export function makeThemedIconPath(
  fileName: string,
  themable: boolean & true
): vscode.SourceControlResourceDecorations;

/**
 * Creates a [[IconPath]] object from the provided icon in `fileName`. This
 * should be a svg or png that is in the `media/{dark|light}` subfolders.
 */
export function makeThemedIconPath(
  fileName: string,
  themable: boolean & false
): IconPath;

export function makeThemedIconPath(
  fileName: string,
  themable: boolean
): IconPath | vscode.SourceControlResourceDecorations {
  const light = join(MEDIA_DIR, "light", fileName);
  const dark = join(MEDIA_DIR, "dark", fileName);
  return themable
    ? { dark: { iconPath: dark }, light: { iconPath: light } }
    : { dark, light };
}

/** Remove path if it is defined and if it is a file, otherwise do nothing */
export async function safeUnlink(path?: string): Promise<void> {
  if (path === undefined) {
    return;
  }

  if ((await pathExists(path, PathType.File)) !== undefined) {
    return fsPromises.unlink(path);
  }
}

/**
 * Finds the first occurrence of `searchExpr` in `str` and calculates a position
 * of the match.
 *
 * @param eol  End of line used in `str`, otherwise a general RegExp matching LF
 *     and CLRF line ends is used.
 *
 * @return A [[vscode.Position]] if `searchExpr` was found in `str` or
 *     `undefined` otherwise.
 */
export function findRegexPositionInString(
  str: string,
  searchExpr: string | RegExp,
  eol?: string
): vscode.Position | undefined {
  const lineEnd = new RegExp(eol ?? "\r\n|\r|\n");
  const matchPos = str.search(searchExpr);
  if (matchPos === -1) {
    return undefined;
  }
  // this is an array of all lines (excluding newline symbols) until the first
  // match of searchExpr
  const newLineMatches = str.slice(0, matchPos).split(lineEnd);
  const linesBeforeApi = newLineMatches.length;
  const lastNewlineBeforeMatch = newLineMatches
    .slice(0, newLineMatches.length - 1)
    // the +1 is there to account for the newlines that are gone due to the split()
    .reduce((prev, cur) => prev + cur.length + 1, 0);

  return new vscode.Position(
    linesBeforeApi - 1,
    matchPos - lastNewlineBeforeMatch
  );
}

declare const __webpack_require__: typeof require;
declare const __non_webpack_require__: typeof require;

const getRequire = (): typeof require =>
  typeof __webpack_require__ === "function" ? __non_webpack_require__ : require;

/**
 * `require()` a node module from vscode's bundled dependencies.
 *
 * @return The loaded module or `undefined` if the module is not in vscode's
 *     bundle.
 */
// inspired by:
// https://code.visualstudio.com/api/advanced-topics/remote-extensions#persisting-secrets
export function getBundledNodeModule<T>(moduleName: string): T | undefined {
  const r = getRequire();

  try {
    return r(`${vscode.env.appRoot}/node_modules.asar/${moduleName}`) as T;
  } catch (err) {
    try {
      return r(`${vscode.env.appRoot}/node_modules/${moduleName}`) as T;
    } catch (err) {
      return undefined;
    }
  }
}

/**
 * `require()` a node module from either vscode's bundle or from node's search
 * path, preferring the vscode bundle.
 *
 * @throw Module not found error if the module is neither in vscode's bundle,
 *     nor in node's search path
 */
export function getNodeModule<T>(moduleName: string): T {
  const r = getRequire();
  return getBundledNodeModule<T>(moduleName) ?? (r(moduleName) as T);
}
