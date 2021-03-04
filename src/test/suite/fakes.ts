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

import { ModifiedPackage } from "open-build-service-api";
import { basename } from "path";
import { SinonSandbox, SinonSpy, SinonStub, spy } from "sinon";
import * as vscode from "vscode";
import {
  AccountManager,
  ActiveAccounts,
  ApiUrl,
  ValidAccount
} from "../../accounts";
import {
  CurrentPackage,
  CurrentPackageWatcher,
  EMPTY_CURRENT_PACKAGE
} from "../../current-package-watcher";

export interface FakeEventEmitter<T> {
  listeners: { callback: (e: T) => any; thisArg?: any }[];

  fire: (e: T) => Promise<void>;

  event: (listener: (e: T) => any, thisArg?: any) => vscode.Disposable;
}

export function makeFakeEventEmitter<T>(): FakeEventEmitter<T> {
  const listeners: { callback: (e: T) => any; thisArg?: any }[] = [];

  const fire = async (e: T): Promise<void> => {
    await Promise.all(
      listeners.map(async (listener) => {
        const res = listener.callback.call(listener.thisArg, e);
        if (res !== undefined && res.then !== undefined) {
          await res;
        }
      })
    );
  };

  const event = (listener: (e: T) => any, thisArg?: any) => {
    listeners.push({ callback: listener, thisArg });
    return {
      dispose: () => {
        const listenerInd = listeners.findIndex(
          (lst) => lst.callback === listener
        );
        if (listenerInd > -1) {
          listeners.splice(listenerInd, 1);
        }
      }
    };
  };

  return { listeners, event, fire };
}

type ExtraTextDocumentFields = Partial<
  Pick<
    vscode.TextDocument,
    | "isDirty"
    | "isClosed"
    | "isUntitled"
    | "languageId"
    | "version"
    | "lineCount"
    | "eol"
  >
>;

export function createStubbedTextDocument(
  sandbox: SinonSandbox,
  uri: vscode.Uri,
  extraTextDocumentFields: ExtraTextDocumentFields = {}
): vscode.TextDocument {
  const {
    isDirty,
    isClosed,
    isUntitled,
    languageId,
    version,
    lineCount,
    eol
  } = extraTextDocumentFields;

  return {
    uri,
    isUntitled: isUntitled ?? false,
    isDirty: isDirty ?? false,
    isClosed: isClosed ?? false,
    languageId: languageId ?? "",
    version: version ?? 0,
    lineCount: lineCount ?? 0,
    fileName: basename(uri.fsPath),
    eol: eol ?? vscode.EndOfLine.LF,
    save: sandbox.stub(),
    lineAt: sandbox.stub<any, vscode.TextLine>(),
    offsetAt: sandbox.stub(),
    positionAt: sandbox.stub(),
    getText: sandbox.stub(),
    getWordRangeAtPosition: sandbox.stub(),
    validateRange: sandbox.stub(),
    validatePosition: sandbox.stub()
  };
}

type ExtraTextEditorFields = Partial<
  Pick<
    vscode.TextEditor,
    "options" | "viewColumn" | "selections" | "visibleRanges"
  >
>;

export function createStubbedTextEditor(
  sandbox: SinonSandbox,
  textDocument: vscode.TextDocument
): vscode.TextEditor;

export function createStubbedTextEditor(
  sandbox: SinonSandbox,
  uri: vscode.Uri,
  extraTextEditorFields?: ExtraTextEditorFields,
  extraTextDocumentFields?: ExtraTextDocumentFields
): vscode.TextEditor;

export function createStubbedTextEditor(
  sandbox: SinonSandbox,
  uriOrTextDocument: vscode.Uri | vscode.TextDocument,
  extraTextEditorFields: ExtraTextEditorFields = {},
  extraTextDocumentFields: ExtraTextDocumentFields = {}
): vscode.TextEditor {
  const {
    options,
    viewColumn,
    selections: optSelections,
    visibleRanges: optVisibleRanges
  } = extraTextEditorFields;

  const selections = optSelections ?? [new vscode.Selection(0, 0, 0, 0)];

  return {
    options: options ?? {},
    viewColumn: viewColumn,
    selections,
    selection: selections[0],
    visibleRanges: optVisibleRanges ?? [new vscode.Range(0, 0, 0, 0)],
    document:
      uriOrTextDocument instanceof vscode.Uri
        ? createStubbedTextDocument(
            sandbox,
            uriOrTextDocument,
            extraTextDocumentFields
          )
        : uriOrTextDocument,
    edit: sandbox.stub(),
    insertSnippet: sandbox.stub(),
    setDecorations: sandbox.stub(),
    revealRange: sandbox.stub(),
    show: sandbox.stub(),
    hide: sandbox.stub()
  };
}

type WorkspaceFolderOptions = Partial<
  Pick<vscode.WorkspaceFolder, "name" | "index">
>;

export function createFakeWorkspaceFolder(
  uri: vscode.Uri,
  workspaceFolderOptions: WorkspaceFolderOptions = {}
): vscode.WorkspaceFolder {
  return {
    uri,
    name: workspaceFolderOptions?.name ?? "",
    index: workspaceFolderOptions?.index ?? 0
  };
}

export type AccountMapInitializer =
  | Map<ApiUrl, ValidAccount>
  | [ApiUrl, ValidAccount][];

class FakeActiveAccounts implements ActiveAccounts {
  public onAccountChangeEmitter = makeFakeEventEmitter<ApiUrl[]>();
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

  public async addAccount(acc: ValidAccount): Promise<void> {
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
export class FakeCurrentPackageWatcher implements CurrentPackageWatcher {
  public currentPackage: CurrentPackage;

  private _allLocalPackages = new Map<
    vscode.WorkspaceFolder,
    ModifiedPackage[]
  >();

  public set allLocalPackages(
    pkgs:
      | Map<vscode.WorkspaceFolder, ModifiedPackage[]>
      | [vscode.WorkspaceFolder, ModifiedPackage[]][]
  ) {
    this._allLocalPackages = Array.isArray(pkgs) ? new Map(pkgs) : pkgs;
  }

  public readonly onDidChangeCurrentPackageEmitter = makeFakeEventEmitter<CurrentPackage>();

  public reloadCurrentPackage(): Promise<void> {
    return this.onDidChangeCurrentPackageEmitter.fire(this.currentPackage);
  }

  public getAllLocalPackages(): Map<vscode.WorkspaceFolder, ModifiedPackage[]> {
    // FIXME:
    return this._allLocalPackages;
  }

  public readonly onDidChangeCurrentPackage: vscode.Event<CurrentPackage> = this
    .onDidChangeCurrentPackageEmitter.event;

  constructor(initialCurrentPackage?: CurrentPackage) {
    this.currentPackage = initialCurrentPackage ?? EMPTY_CURRENT_PACKAGE;
  }

  public dispose() {
    // nothing to get rid off
  }

  public setCurrentPackage(currentPackage: CurrentPackage): Promise<void> {
    this.currentPackage = currentPackage;
    return this.onDidChangeCurrentPackageEmitter.fire(currentPackage);
  }
}

const createWatcher = (
  sandbox: SinonSandbox,
  ignoreCreateEvents?: boolean,
  ignoreChangeEvents?: boolean,
  ignoreDeleteEvents?: boolean
) => {
  const onDidCreateEmitter = makeFakeEventEmitter<vscode.Uri>();
  const onDidChangeEmitter = makeFakeEventEmitter<vscode.Uri>();
  const onDidDeleteEmitter = makeFakeEventEmitter<vscode.Uri>();

  const stubOrEvent = (
    ignoreEvent: boolean | undefined,
    eventEmitter: FakeEventEmitter<vscode.Uri>
  ) =>
    ignoreEvent !== undefined && ignoreEvent
      ? sandbox.stub()
      : eventEmitter.event;

  return {
    onDidCreateEmitter,
    onDidChangeEmitter,
    onDidDeleteEmitter,
    onDidCreate: stubOrEvent(ignoreCreateEvents, onDidCreateEmitter),
    onDidChange: stubOrEvent(ignoreChangeEvents, onDidChangeEmitter),
    onDidDelete: stubOrEvent(ignoreDeleteEvents, onDidDeleteEmitter),
    ignoreCreateEvents,
    ignoreChangeEvents,
    ignoreDeleteEvents
  };
};

export type FakeWatcherType = ReturnType<typeof createWatcher> & {
  dispose: any;
  disposeSpy: SinonSpy;
  globPattern: vscode.GlobPattern;
} & Pick<
    vscode.FileSystemWatcher,
    "ignoreChangeEvents" | "ignoreCreateEvents" | "ignoreDeleteEvents"
  >;

export class FakeVscodeWorkspace {
  public getWorkspaceFolder: SinonStub;
  public createFileSystemWatcher: (
    ...a: Parameters<typeof vscode.workspace.createFileSystemWatcher>
  ) => FakeWatcherType;

  public fakeWatchers: FakeWatcherType[] = [];

  public createFileSystemWatcherSpy: SinonSpy;

  constructor(
    sandbox: SinonSandbox,
    public textDocuments: vscode.TextDocument[] = []
  ) {
    this.getWorkspaceFolder = sandbox.stub();
    const createFileSystemWatcher = function (
      this: FakeVscodeWorkspace,
      globPattern: vscode.GlobPattern,
      ignoreCreateEvents?: boolean,
      ignoreChangeEvents?: boolean,
      ignoreDeleteEvents?: boolean
    ): FakeWatcherType {
      const watcher = {
        ...createWatcher(
          sandbox,
          ignoreDeleteEvents,
          ignoreChangeEvents,
          ignoreCreateEvents
        ),
        globPattern
      };
      const watchers = this.fakeWatchers;
      watchers.push(watcher as FakeWatcherType);

      (watcher as FakeWatcherType).dispose = function () {
        const thisWatcherIndex = watchers.findIndex((w) => w === watcher);
        if (thisWatcherIndex !== -1) {
          watchers.splice(thisWatcherIndex, 1);
        }
      };
      (watcher as FakeWatcherType).disposeSpy = spy(
        watcher as FakeWatcherType,
        "dispose"
      );
      return watcher as FakeWatcherType;
    };

    this.createFileSystemWatcher = createFileSystemWatcher;
    this.createFileSystemWatcherSpy = spy(this, "createFileSystemWatcher");
  }
}
