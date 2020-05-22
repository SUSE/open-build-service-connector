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
import {
  addAndDeleteFilesFromPackage,
  commit,
  fetchHistory,
  FileState,
  ModifiedPackage,
  Package,
  pathExists,
  readInModifiedPackageFromDir,
  Revision
} from "open-build-service-api";
import { basename, dirname, join, relative, sep } from "path";
import { Logger } from "pino";
import * as vscode from "vscode";
import { AccountManager } from "./accounts";
import { ConnectionListenerLoggerBase } from "./base-components";
import { cmdPrefix } from "./constants";
import { EmptyDocumentProvider } from "./empty-file-provider";
import { logAndReportExceptions } from "./util";

interface LineChange {
  readonly originalStartLineNumber: number;
  readonly originalEndLineNumber: number;
  readonly modifiedStartLineNumber: number;
  readonly modifiedEndLineNumber: number;
}

const cmdId = "obsScm";

export const REVERT_CHANGE_COMMAND = `${cmdPrefix}.${cmdId}.revertChange`;

export const COMMIT_CHANGES_COMMAND = `${cmdPrefix}.${cmdId}.commitChanges`;

export const ADD_FILE_COMMAND = `${cmdPrefix}.${cmdId}.addFile`;

export const REMOVE_FILE_COMMAND = `${cmdPrefix}.${cmdId}.removeFile`;

export const DISCARD_CHANGES_COMMAND = `${cmdPrefix}.${cmdId}.discardChanges`;

export const SHOW_DIFF_COMMAND = `${cmdPrefix}.${cmdId}.showDiff`;

export const SHOW_DIFF_FROM_URI_COMMAND = `${cmdPrefix}.${cmdId}.showDiffFromUri`;

export const SET_CURRENT_PKG_OF_HISTORY_TREE_COMMAND = `${cmdPrefix}.${cmdId}.setCurrentPackage`;

export const SET_CURRENT_PKG_OF_HISTORY_TREE_FROM_EDITOR_COMMAND = `${cmdPrefix}.${cmdId}.setCurrentPackageFromEditor`;

/**
 * URI scheme for to get the file contents at HEAD for files under version
 * control.
 */
export const OBS_FILE_AT_HEAD_SCHEME = "vscodeObsFileAtHead";

class PackageCache extends ConnectionListenerLoggerBase {
  public static async createPackageCache(
    accountManager: AccountManager,
    logger: Logger
  ): Promise<PackageCache> {
    const pkgCache = new PackageCache(accountManager, logger);

    await Promise.all(
      vscode.window.visibleTextEditors.map((editor) => {
        return pkgCache.registerTextEditor(editor);
      })
    );

    pkgCache.activePackage = pkgCache.getPkg(vscode.window.activeTextEditor);

    pkgCache.disposables.push(
      vscode.window.onDidChangeVisibleTextEditors(async function (
        this: PackageCache,
        editors
      ) {
        const presentEditorPaths = [...this.modifiedPackageMap.keys()];

        await Promise.all(
          editors.map(async function (this: PackageCache, editor) {
            const path = dirname(editor.document.uri.fsPath);
            if (!this.modifiedPackageMap.has(path)) {
              await this.registerTextEditor(editor);
            }

            const curPathIndex = presentEditorPaths.indexOf(path);
            if (curPathIndex !== -1) {
              presentEditorPaths.splice(curPathIndex, 1);
            }
          }, this)
        );

        // all paths left in this array are no longer used text editors and need
        // to me removed
        presentEditorPaths.forEach((presentPath) => {
          this.removePkgFromMap(presentPath);
        });
      },
      pkgCache),

      vscode.window.onDidChangeActiveTextEditor(async function (
        this: PackageCache,
        editor
      ) {
        let modPkgAndFsWatcher:
          | undefined
          | [ModifiedPackage, vscode.FileSystemWatcher];

        if (editor !== undefined) {
          const path = dirname(editor.document.uri.fsPath);
          if (this.modifiedPackageMap.has(path)) {
            modPkgAndFsWatcher = this.modifiedPackageMap.get(path);
          } else {
            await this.registerTextEditor(editor);
            modPkgAndFsWatcher = this.modifiedPackageMap.get(path);
            // editor doesn't have to belong to a osc package, so
            // modPkgAndFsWatcher can be undefined here
          }
        }
        modPkgAndFsWatcher !== undefined
          ? this.fireActivePackageEvent(modPkgAndFsWatcher[0])
          : this.fireActivePackageEvent(undefined);
      },
      pkgCache)
    );

    return pkgCache;
  }

  public onDidChangeActivePackage: vscode.Event<ModifiedPackage | undefined>;

  public activePackage: ModifiedPackage | undefined;

  private modifiedPackageMap: Map<
    string,
    [ModifiedPackage, vscode.FileSystemWatcher]
  > = new Map();

  private onDidChangeActivePackageEmitter: vscode.EventEmitter<
    ModifiedPackage | undefined
  > = new vscode.EventEmitter();

  private constructor(accountManager: AccountManager, logger: Logger) {
    super(accountManager, logger);
    this.onDidChangeActivePackage = this.onDidChangeActivePackageEmitter.event;
    this.disposables.push(this.onDidChangeActivePackageEmitter);
  }

  public dispose(): void {
    for (const pkgAndFsWatcher of this.modifiedPackageMap.values()) {
      pkgAndFsWatcher[1].dispose();
    }
    super.dispose();
  }

  public getPkg(
    editor: vscode.TextEditor | undefined
  ): ModifiedPackage | undefined {
    if (
      editor === undefined ||
      (editor.document.uri.scheme !== "file" &&
        editor.document.uri.scheme !== OBS_FILE_AT_HEAD_SCHEME)
    ) {
      return undefined;
    }
    // we want to also return a package if the user views the diff
    // const fsPath = editor.document.uri.scheme === "file" ? editor.document.uri.fsPath :
    const modPkgAndWatcher = this.modifiedPackageMap.get(
      dirname(editor.document.uri.fsPath)
    );
    return modPkgAndWatcher === undefined ? undefined : modPkgAndWatcher[0];
  }

  private fireActivePackageEvent(pkg: ModifiedPackage | undefined) {
    this.activePackage = pkg;
    this.onDidChangeActivePackageEmitter.fire(pkg);
  }

  private insertPkgIntoMap(pkg: ModifiedPackage): void {
    if (this.modifiedPackageMap.has(pkg.path)) {
      this.updatePkgInMap(pkg);
      return;
    }

    const wsFolder = vscode.workspace.getWorkspaceFolder(
      vscode.Uri.file(pkg.path)
    );
    if (wsFolder === undefined) {
      this.logger.error(
        "Cannot get workspace folder from package %s/%s in path: %s",
        pkg.projectName,
        pkg.name,
        pkg.path
      );
      return;
    }
    const relPath = relative(wsFolder.uri.fsPath, pkg.path);
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(wsFolder, `${relPath}/**`)
    );
    const pkgUpdate = async function (this: PackageCache, uri: vscode.Uri) {
      if (uri.scheme !== "file") {
        // shouldn't happen
        this.logger.error(
          "file system watcher received a non file uri: %s",
          uri.toString()
        );
        return;
      }
      const oldPkgAndWatcher = this.modifiedPackageMap.get(pkg.path);
      if (oldPkgAndWatcher !== undefined) {
        let newPkg: ModifiedPackage;
        try {
          newPkg = await readInModifiedPackageFromDir(pkg.path);
        } catch (err) {
          this.logger.error(
            "Failed to read in the package at '%s', got: %s",
            pkg.path,
            err.toString()
          );
          this.removePkgFromMap(pkg.path);
          return;
        }
        assert(newPkg !== undefined);
        this.updatePkgInMap(newPkg);
      }
    };
    watcher.onDidChange(pkgUpdate, this);
    watcher.onDidCreate(pkgUpdate, this);
    watcher.onDidDelete(pkgUpdate, this);

    this.modifiedPackageMap.set(pkg.path, [pkg, watcher]);
  }

  private removePkgFromMap(pkgOrPath: ModifiedPackage | string): void {
    const key = typeof pkgOrPath === "string" ? pkgOrPath : pkgOrPath.path;
    const pkgAndWatcher = this.modifiedPackageMap.get(key);
    const deleteRes = this.modifiedPackageMap.delete(key);
    if (pkgAndWatcher !== undefined) {
      pkgAndWatcher[1].dispose();
    }
    if (this.activePackage?.path === key) {
      this.fireActivePackageEvent(undefined);
    }
    assert(
      deleteRes === (pkgAndWatcher !== undefined),
      "Deletion of the package must succeed when we were able to retrieve it"
    );
  }

  private updatePkgInMap(pkg: ModifiedPackage): void {
    const pkgAndWatcher = this.modifiedPackageMap.get(pkg.path);
    if (pkgAndWatcher === undefined) {
      throw new Error(
        `cannot update package ${pkg.name} in the map, it is not present`
      );
    }
    this.modifiedPackageMap.set(pkg.path, [pkg, pkgAndWatcher[1]]);
    if (pkg.path === this.activePackage?.path) {
      this.fireActivePackageEvent(pkg);
    }
  }

  private async registerTextEditor(editor: vscode.TextEditor): Promise<void> {
    if (editor.document.uri.scheme !== "file") {
      return;
    }
    const dir = dirname(editor.document.uri.fsPath);
    if (!(await pathExists(join(dir, ".osc")))) {
      return;
    }
    try {
      const modPkg = await readInModifiedPackageFromDir(dir);
      this.insertPkgIntoMap(modPkg);
    } catch (err) {
      this.logger.trace(
        "Tried to read in a package from %s but got the error: %s",
        dir,
        err.toString()
      );
      return;
    }
  }
}

export class PackageScm extends ConnectionListenerLoggerBase
  implements vscode.QuickDiffProvider, vscode.TextDocumentContentProvider {
  public static async createPackageScm(
    accountManager: AccountManager,
    logger: Logger
  ): Promise<PackageScm> {
    const pkgScm = new PackageScm(accountManager, logger);

    pkgScm.pkgCache = await PackageCache.createPackageCache(
      accountManager,
      logger
    );

    pkgScm.disposables.push(
      pkgScm.pkgCache.onDidChangeActivePackage(function (
        this: PackageScm,
        _modPkg
      ) {
        this.updateScm();
      },
      pkgScm),
      pkgScm.pkgCache
    );

    pkgScm.updateScm();

    return pkgScm;
  }

  private pkgCache?: PackageCache;

  private activePackage: ModifiedPackage | undefined;

  private curScm: vscode.SourceControl | undefined;

  private scmDisposable: vscode.Disposable | undefined;

  private constructor(accountManager: AccountManager, logger: Logger) {
    super(accountManager, logger);
    this.disposables.push(
      vscode.commands.registerCommand(
        REVERT_CHANGE_COMMAND,
        this.revertChange,
        this
      ),
      vscode.commands.registerCommand(
        COMMIT_CHANGES_COMMAND,
        this.commitChanges,
        this
      ),
      vscode.commands.registerCommand(SHOW_DIFF_COMMAND, this.showDiff, this),
      vscode.commands.registerCommand(
        SHOW_DIFF_FROM_URI_COMMAND,
        this.showDiffFromUri,
        this
      ),
      vscode.commands.registerCommand(ADD_FILE_COMMAND, this.addFile, this),
      vscode.commands.registerCommand(
        REMOVE_FILE_COMMAND,
        this.removeFile,
        this
      ),
      vscode.commands.registerCommand(
        DISCARD_CHANGES_COMMAND,
        this.discardChanges,
        this
      ),
      vscode.workspace.registerTextDocumentContentProvider(
        OBS_FILE_AT_HEAD_SCHEME,
        this
      ),
      vscode.commands.registerCommand(
        SET_CURRENT_PKG_OF_HISTORY_TREE_FROM_EDITOR_COMMAND,
        this.setCurrentPackageFromEditor,
        this
      )
    );
  }

  public provideOriginalResource(
    uri: vscode.Uri,
    token: vscode.CancellationToken
  ): vscode.Uri | undefined {
    return token.isCancellationRequested
      ? undefined
      : this.getUriOfOriginalResource(uri);
  }

  public provideTextDocumentContent(
    uri: vscode.Uri,
    token: vscode.CancellationToken
  ): Promise<string | undefined> {
    if (uri.scheme !== OBS_FILE_AT_HEAD_SCHEME) {
      throw new Error(
        `Invalid uri scheme '${uri.scheme}', expected ${OBS_FILE_AT_HEAD_SCHEME}`
      );
    }

    const path = this.getPathOfOriginalResource(uri);
    return token.isCancellationRequested
      ? Promise.resolve(undefined)
      : fsPromises.readFile(path, { encoding: "utf-8" });
  }

  public dispose() {
    this.scmDisposable?.dispose();
    super.dispose();
  }

  private getPathOfOriginalResource(uri: vscode.Uri): string {
    const pathUri = uri.with({ scheme: "file" });
    return join(dirname(pathUri.fsPath), ".osc", basename(pathUri.fsPath));
  }

  private getUriOfOriginalResource(uri: vscode.Uri): vscode.Uri | undefined {
    if (this.activePackage === undefined) {
      return undefined;
    }
    const splitPath = uri.fsPath.split(sep);
    const matchingFile = this.activePackage.files.find(
      (f) => f.name === splitPath[splitPath.length - 1]
    );

    if (matchingFile === undefined) {
      return undefined;
    }
    return uri.with({ scheme: OBS_FILE_AT_HEAD_SCHEME });
  }

  private async showDiffFromUri(uri?: vscode.Uri): Promise<void> {
    if (uri === undefined) {
      return;
    }
    assert(
      this.activePackage !== undefined,
      "A package must be currently active"
    );

    const fname = basename(uri.fsPath);
    const fileState = this.activePackage.filesInWorkdir.find(
      (f) => f.name === fname
    )!.state;

    if (fileState === FileState.ToBeAdded) {
      await vscode.commands.executeCommand(
        "vscode.diff",
        EmptyDocumentProvider.buildUri(fname),
        uri,
        `New File: ${fname}`
      );
    } else {
      const orig = this.getUriOfOriginalResource(uri);
      if (orig === undefined) {
        this.logger.error(
          "Could not get uri of the original resource of %s",
          uri
        );
        return;
      }

      if (
        fileState === FileState.Missing ||
        fileState === FileState.ToBeDeleted
      ) {
        await vscode.commands.executeCommand(
          "vscode.diff",
          orig,
          EmptyDocumentProvider.buildUri(fname),
          `File ${fname} ${
            fileState === FileState.ToBeDeleted
              ? "will be deleted"
              : "is missing"
          }`
        );
      } else {
        await vscode.commands.executeCommand(
          "vscode.diff",
          orig,
          EmptyDocumentProvider.buildUri(fname),
          `${fname} (Working Tree)`
        );
      }
    }
  }

  private async addFile(
    ...resourceStates: vscode.SourceControlResourceState[]
  ): Promise<void> {
    const filesToAdd = resourceStates.map((state) =>
      basename(state.resourceUri.fsPath)
    );
    assert(
      this.activePackage !== undefined,
      "A package must be currently active"
    );
    await addAndDeleteFilesFromPackage(this.activePackage, [], filesToAdd);
  }

  private async removeFile(
    ...resourceStates: vscode.SourceControlResourceState[]
  ): Promise<void> {
    const filesToDelete = resourceStates.map((state) =>
      basename(state.resourceUri.fsPath)
    );
    assert(
      this.activePackage !== undefined,
      "A package must be currently active"
    );
    await addAndDeleteFilesFromPackage(this.activePackage, filesToDelete, []);
  }

  private async discardChanges(
    ...resourceStates: vscode.SourceControlResourceState[]
  ): Promise<void> {
    await Promise.all(
      resourceStates.map(async (resourceState) => {
        const matchingEditors = vscode.window.visibleTextEditors.filter(
          (editor) =>
            editor.document.uri.toString() ===
            resourceState.resourceUri.toString()
        );
        const uriAtHead = this.getUriOfOriginalResource(
          resourceState.resourceUri
        );
        if (uriAtHead === undefined) {
          this.logger.error(
            "Could not get uri of the original file of the file %s from %s/%s",
            basename(resourceState.resourceUri.fsPath),
            this.activePackage?.projectName,
            this.activePackage?.name
          );
          return;
        }

        // if the document is not open, then just overwrite the file contents
        if (matchingEditors.length === 0) {
          await fsPromises.copyFile(
            this.getPathOfOriginalResource(uriAtHead),
            resourceState.resourceUri.fsPath
          );
        } else {
          const origContent = await this.provideTextDocumentContent(
            resourceState.resourceUri.with({ scheme: OBS_FILE_AT_HEAD_SCHEME }),
            { isCancellationRequested: false } as vscode.CancellationToken
          );
          if (origContent === undefined) {
            this.logger.error(
              "could not get original content for the file %s from %s/%s",
              resourceState.resourceUri.fsPath,
              this.activePackage?.projectName,
              this.activePackage?.name
            );
            return;
          }

          await Promise.all(
            matchingEditors.map(async (editor) => {
              await editor.edit((builder) =>
                builder.replace(
                  new vscode.Range(0, 0, editor.document.lineCount, 0),
                  origContent
                )
              );
              await editor.document.save();
            })
          );
        }
      })
    );
  }

  private async showDiff(
    ...resourceStates: vscode.SourceControlResourceState[]
  ): Promise<void> {
    await Promise.all(
      resourceStates.map(async (resourceState) => {
        await this.showDiffFromUri(resourceState.resourceUri);
      })
    );
  }

  private async revertChange(
    uri?: vscode.Uri,
    changes?: LineChange[],
    index?: number
  ): Promise<void> {
    if (uri === undefined || changes === undefined || index === undefined) {
      // FIXME: use the active editor and revert all changes instead maybe?
      this.logger.error(
        "Command revertChange cannot be executed without all mandatory arguments."
      );
      return;
    }

    assert(
      changes.length >= index,
      `Must have received at least ${index} line changes, but got only ${changes.length}`
    );
    const change = changes[index];

    if (this.activePackage === undefined) {
      this.logger.error(
        "Revert of the line change [%d:%d] in %s was requested, but no activePackage exists",
        change.modifiedStartLineNumber,
        change.modifiedEndLineNumber,
        uri.fsPath
      );
      return;
    }

    // the change is just a set of lines being deleted
    const isDeletion = change.modifiedEndLineNumber === 0;
    // the change is just the addition of lines
    const isAddition = change.originalEndLineNumber === 0;

    assert(
      !(isDeletion && isAddition),
      "LineChange must be an Addition or a Deletion, but cannot be both at once"
    );

    const matchingEditors = vscode.window.visibleTextEditors.filter(
      (editor) => editor.document.uri.toString() === uri.toString()
    );
    // FIXME: why do we get more than 1 here??
    // if (matchingEditors.length !== 1) {
    //   this.logger.error(
    //     "Expected to find 1 matching text editor for this Uri (%s) but got %d",
    //     uri.toString(),
    //     matchingEditors.length
    //   );
    //   return;
    // }
    const matchingEditor = matchingEditors[0];

    let success: boolean;
    if (isAddition) {
      success = await matchingEditor.edit((editBuilder) =>
        editBuilder.delete(
          new vscode.Range(
            change.modifiedStartLineNumber - 1,
            0,
            // FIXME: what to do at the end of the file?
            change.modifiedEndLineNumber,
            0
          )
        )
      );
    } else {
      const origDocument = await vscode.workspace.openTextDocument(
        this.getUriOfOriginalResource(uri)!
      );

      const origContent = origDocument.getText(
        new vscode.Range(
          change.originalStartLineNumber - 1,
          0,
          change.originalEndLineNumber,
          0
        )
      );

      success = await matchingEditor.edit((editBuilder) =>
        isDeletion
          ? editBuilder.insert(
              // for deletions change.modifiedStartLineNumber is the line
              // *after* which the content needs to be inserted
              new vscode.Position(change.modifiedStartLineNumber, 0),
              origContent
            )
          : editBuilder.replace(
              new vscode.Range(
                change.modifiedStartLineNumber - 1,
                0,
                change.modifiedEndLineNumber,
                0
              ),
              origContent
            )
      );
    }

    if (!success) {
      this.logger.error(
        "Reverting the line change [%d:%d] in %s failed",
        change.modifiedStartLineNumber,
        change.modifiedEndLineNumber,
        uri.fsPath
      );
    }
  }

  private async commitChanges(scm?: vscode.SourceControl): Promise<void> {
    if (this.activePackage === undefined) {
      this.logger.error("Cannot commit changes: no activePackage is set");
      return;
    }

    const con = this.activeAccounts.getConfig(this.activePackage.apiUrl)
      ?.connection;
    if (con === undefined) {
      this.logger.error(
        "Cannot commit changes: no connection for the API '%s' exists",
        this.activePackage.apiUrl
      );
      return;
    }

    const commitMsg = scm?.inputBox.value;
    if (commitMsg === undefined || commitMsg === "") {
      {
        const commitAnyway = await vscode.window.showInformationMessage(
          "No commit message provided, commit anyway?",
          "Yes",
          "No"
        );
        if (commitAnyway === undefined || commitAnyway === "No") {
          this.logger.debug(
            "No commit message provided and user decided to not commit the changes"
          );
          return;
        }
      }
    }

    await commit(con, this.activePackage, commitMsg);
    if (this.curScm?.inputBox.value !== undefined) {
      this.curScm.inputBox.value = "";
    }

    // this.updateScm(await readInModifiedPackageFromDir(this.activePackage.path));
  }

  private updateScm(): void {
    this.curScm?.dispose();
    this.activePackage = this.pkgCache!.activePackage;

    if (this.pkgCache!.activePackage !== undefined) {
      this.curScm = this.scmFromModifiedPackage(this.pkgCache!.activePackage);
    }
  }

  private scmFromModifiedPackage(pkg: ModifiedPackage): vscode.SourceControl {
    const obsScm = vscode.scm.createSourceControl(
      "obs",
      "OBS package " + pkg.projectName + "/" + pkg.name
    );

    const untrackedFiles = obsScm.createResourceGroup(
      "untracked",
      "untracked files"
    );
    untrackedFiles.hideWhenEmpty = true;
    untrackedFiles.resourceStates = pkg.filesInWorkdir
      .filter((f) => f.state === FileState.Untracked)
      .map((f) => ({ resourceUri: vscode.Uri.file(join(pkg.path, f.name)) }));

    // const removedFiles = obsScm.createResourceGroup(
    //   "deleted",
    //   "removed files"
    // );
    // untrackedFiles.resourceStates = pkg.filesInWorkdir
    //   .filter((f) => f.state === FileState.ToBeDeleted)
    //   .map((f) => ({ resourceUri: vscode.Uri.file(join(pkg.path, f.name)) }));

    const changed = obsScm.createResourceGroup("changes", "Changed files");

    changed.resourceStates = pkg.filesInWorkdir
      .filter(
        (f) =>
          f.state !== FileState.Unmodified && f.state !== FileState.Untracked
      )
      .map((f) => {
        const resourceUri = vscode.Uri.file(join(pkg.path, f.name));
        return {
          command: {
            arguments: [resourceUri],
            command: SHOW_DIFF_FROM_URI_COMMAND,
            title: "Show the diff to HEAD"
          },
          decorations: {
            faded: f.state === FileState.Missing,
            strikeThrough: f.state === FileState.ToBeDeleted
          },
          resourceUri
        };
      });

    obsScm.quickDiffProvider = this;
    obsScm.inputBox.placeholder = "Commit message";
    obsScm.acceptInputCommand = {
      command: COMMIT_CHANGES_COMMAND,
      title: "commit the current changes"
    };

    return obsScm;
  }

  @logAndReportExceptions(true)
  private async setCurrentPackageFromEditor(): Promise<void> {
    if (this.activePackage !== undefined) {
      await vscode.commands.executeCommand(
        SET_CURRENT_PKG_OF_HISTORY_TREE_COMMAND,
        this.activePackage
      );
    }
  }
}

export class HistoryRootTreeElement extends vscode.TreeItem {
  public contextValue = "historyRoot";

  constructor(pkg: Package) {
    super(
      `${pkg.projectName}/${pkg.name}`,
      vscode.TreeItemCollapsibleState.Expanded
    );
  }
}

export class CommitTreeElement extends vscode.TreeItem {
  public contextValue = "commit";

  public iconPath = new vscode.ThemeIcon("git-commit");

  constructor(public readonly rev: Revision, public readonly apiUrl: string) {
    super(
      `${rev.revision}: ${
        rev.commitMessage === undefined
          ? "no commit message available"
          : rev.commitMessage.split("\n")[0]
      }`,
      vscode.TreeItemCollapsibleState.None
    );
    this.command = {
      arguments: [this],
      command: OPEN_COMMIT_DOCUMENT_COMMAND,
      title: "Show commit info"
    };
  }
}

function isCommitTreeElement(elem: vscode.TreeItem): elem is CommitTreeElement {
  return elem.contextValue === "commit";
}

function isHistoryRootTreeElement(
  elem: vscode.TreeItem
): elem is HistoryRootTreeElement {
  return elem.contextValue === "historyRoot";
}

type HistoryTreeItem = CommitTreeElement | HistoryRootTreeElement;

export const OBS_REVISION_FILE_SCHEME = "vscodeObsCommit";

export const OPEN_COMMIT_DOCUMENT_COMMAND = `${cmdPrefix}.${cmdId}.openCommitDocument`;

export class PackageScmHistoryTree extends ConnectionListenerLoggerBase
  implements
    vscode.TreeDataProvider<HistoryTreeItem>,
    vscode.TextDocumentContentProvider {
  private static commitToUri(rev: Revision, apiUrl: string): vscode.Uri {
    const baseUri = `${OBS_REVISION_FILE_SCHEME}://${rev.revisionHash}/${rev.projectName}/${rev.packageName}/?${apiUrl}`;
    return vscode.Uri.parse(baseUri);
  }

  public onDidChangeTreeData: vscode.Event<HistoryTreeItem | undefined>;

  private onDidChangeTreeDataEmitter: vscode.EventEmitter<
    HistoryTreeItem | undefined
  > = new vscode.EventEmitter();

  private currentPackage: Package | undefined = undefined;
  private currentHistory: readonly Revision[] | undefined = undefined;

  constructor(accountManager: AccountManager, logger: Logger) {
    super(accountManager, logger);
    this.onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

    this.disposables.push(
      vscode.commands.registerCommand(
        SET_CURRENT_PKG_OF_HISTORY_TREE_COMMAND,
        this.setCurrentPackage,
        this
      ),
      vscode.commands.registerCommand(
        OPEN_COMMIT_DOCUMENT_COMMAND,
        this.openCommitDocument,
        this
      ),
      vscode.workspace.registerTextDocumentContentProvider(
        OBS_REVISION_FILE_SCHEME,
        this
      )
    );
  }

  public async provideTextDocumentContent(
    uri: vscode.Uri,
    token: vscode.CancellationToken
  ): Promise<string | undefined> {
    const rev = await this.commitFromUri(uri);

    if (token.isCancellationRequested) {
      return undefined;
    }
    let content = `r${rev.revision} | ${rev.userId} | ${rev.commitTime} | ${rev.revisionHash}`;
    if (rev.version !== undefined) {
      content = content.concat(" | ", rev.version);
    }
    if (rev.requestId !== undefined) {
      content = content.concat(" | rq", rev.requestId.toString());
    }
    content = content.concat(
      `
`,
      rev.commitMessage ?? "No commit message available"
    );

    return content;
  }

  public getTreeItem(element: HistoryTreeItem): vscode.TreeItem {
    return element;
  }

  public getChildren(element?: HistoryTreeItem): HistoryTreeItem[] {
    if (this.currentPackage === undefined) {
      return [];
    }
    if (element === undefined) {
      return [new HistoryRootTreeElement(this.currentPackage)];
    }

    assert(isHistoryRootTreeElement(element));
    if (this.currentHistory === undefined) {
      this.logger.error("currentPackage is set, but no history is present");
      return [];
    }
    return this.currentHistory.map(
      (rev) => new CommitTreeElement(rev, this.currentPackage!.apiUrl)
    );
  }

  private async commitFromUri(uri: vscode.Uri): Promise<Revision> {
    if (uri.scheme !== OBS_REVISION_FILE_SCHEME) {
      throw new Error(
        `cannot extract a Revision from the uri '${uri}', invalid scheme: ${uri.scheme}, expected ${OBS_REVISION_FILE_SCHEME}`
      );
    }

    const revisionHash = uri.authority;
    const apiUrl = uri.query;
    const projAndPkg = uri.path;

    const projAndPkgArr = projAndPkg.split("/");
    if (projAndPkgArr.length < 2 || projAndPkgArr.length > 4) {
      throw new Error(
        `Invalid Uri '${uri}', expected project and package name as part of the path.`
      );
    }

    const firstIndex = projAndPkgArr[0] === "" ? 1 : 0;
    const projectName = projAndPkgArr[firstIndex];
    const packageName = projAndPkgArr[firstIndex + 1];

    let hist: readonly Revision[];
    if (
      this.currentPackage !== undefined &&
      this.currentPackage.apiUrl === apiUrl &&
      this.currentPackage.projectName === projectName &&
      this.currentPackage.name === packageName &&
      this.currentHistory !== undefined
    ) {
      hist = this.currentHistory;
    } else {
      const con = this.activeAccounts.getConfig(apiUrl)?.connection;
      if (con === undefined) {
        throw new Error(
          `cannot retrieve the history of the package ${projectName}/${packageName} from ${apiUrl}: no account is configured`
        );
      }
      hist = await fetchHistory(con, {
        apiUrl,
        name: packageName,
        projectName
      });
    }
    const foundRev = hist.find((rev) => rev.revisionHash === revisionHash);
    if (foundRev === undefined) {
      throw new Error(
        `cannot retrieve revision ${revisionHash} of package ${projectName}/${packageName} from ${apiUrl}: revision does not exist`
      );
    }
    return foundRev;
  }

  private async openCommitDocument(element?: vscode.TreeItem): Promise<void> {
    if (element === undefined || !isCommitTreeElement(element)) {
      return;
    }
    const uri = PackageScmHistoryTree.commitToUri(
      element.rev,
      this.currentPackage!.apiUrl
    );
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: false });
  }

  private async setCurrentPackage(pkg?: Package): Promise<void> {
    if (pkg === undefined) {
      this.logger.error("setCurrentPackage called without the pkg parameter");
      return;
    }
    const con = this.activeAccounts.getConfig(pkg.apiUrl)?.connection;
    if (con === undefined) {
      throw new Error(
        `cannot fetch history for ${pkg.projectName}/${pkg.name}: no account is configured for the API ${pkg.apiUrl}`
      );
    }

    try {
      this.currentHistory = await fetchHistory(con, pkg);
      this.currentPackage = pkg;
      this.onDidChangeTreeDataEmitter.fire(undefined);
    } catch (err) {
      this.logger.error(
        "Failed to load history of %s/%s from %s, got error: %s",
        pkg.projectName,
        pkg.name,
        pkg.apiUrl,
        err.toString()
      );
      throw new Error(
        `cannot fetch history for ${pkg.projectName}/${pkg.name}: communication error`
      );
    }
  }
}
