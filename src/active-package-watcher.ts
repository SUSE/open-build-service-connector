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
import {
  ModifiedPackage,
  pathExists,
  PathType,
  readInModifiedPackageFromDir
} from "open-build-service-api";
import { dirname, join, relative } from "path";
import { Logger } from "pino";
import * as vscode from "vscode";
import { AccountManager } from "./accounts";
import { ConnectionListenerLoggerBase } from "./base-components";
import { debounce } from "./decorators";
import { fsPathFromEmptyDocumentUri } from "./empty-file-provider";
import { fsPathFromObsRevisionUri } from "./scm-history";
import { deepEqual } from "./util";
import { fsPathFromFileAtHeadUri } from "./vcs";
import { VscodeWindow, VscodeWorkspace } from "./vscode-dep";

export const EDITOR_CHANGE_DELAY_MS = 100;

interface PkgAndFsWatcher {
  pkg: ModifiedPackage;
  watcher: vscode.FileSystemWatcher;
}

/**
 * This class watches the currently opened text editors and tracks the
 * corresponding packages in the Open Build Service.
 *
 * For most use cases it is sufficient to subscribe to the
 * [[onDidChangeActivePackage]] event. It is fired every time that the Package
 * that belongs to the currently opened text editor window changes.
 *
 * In case your API consumer does not require live updates, but just a one-time
 * information, then use the [[activePackage]] property.
 */
export class ActivePackageWatcher extends ConnectionListenerLoggerBase {
  public static async createActivePackageWatcher(
    accountManager: AccountManager,
    logger: Logger,
    vscodeWindow: VscodeWindow = vscode.window,
    vscodeWorkspace: VscodeWorkspace = vscode.workspace
  ): Promise<ActivePackageWatcher> {
    const pkgWatcher = new ActivePackageWatcher(
      accountManager,
      logger,
      vscodeWindow,
      vscodeWorkspace
    );

    await Promise.all(
      vscodeWindow.visibleTextEditors.map((editor) => {
        return pkgWatcher.addPackageFromTextDocument(editor.document);
      })
    );

    pkgWatcher._activePackage = pkgWatcher.getPkg(
      vscodeWindow.activeTextEditor?.document
    );

    pkgWatcher.disposables.push(
      vscodeWindow.onDidChangeActiveTextEditor(
        pkgWatcher.onActiveEditorChange,
        pkgWatcher
      )
    );

    return pkgWatcher;
  }

  public onDidChangeActivePackage: vscode.Event<ModifiedPackage | undefined>;

  public get activePackage(): ModifiedPackage | undefined {
    return this._activePackage;
  }

  private _activePackage: ModifiedPackage | undefined;

  private modifiedPackageMap = new Map<string, PkgAndFsWatcher>();

  private onDidChangeActivePackageEmitter = new vscode.EventEmitter<
    ModifiedPackage | undefined
  >();

  private constructor(
    accountManager: AccountManager,
    logger: Logger,
    private readonly vscodeWindow: VscodeWindow,
    private readonly vscodeWorkspace: VscodeWorkspace
  ) {
    super(accountManager, logger);
    this.onDidChangeActivePackage = this.onDidChangeActivePackageEmitter.event;
    this.disposables.push(this.onDidChangeActivePackageEmitter);
  }

  public dispose(): void {
    for (const pkgAndFsWatcher of this.modifiedPackageMap.values()) {
      pkgAndFsWatcher.watcher.dispose();
    }
    super.dispose();
  }

  public getPkg(
    document: vscode.TextDocument | undefined
  ): ModifiedPackage | undefined {
    if (document === undefined) {
      return undefined;
    }
    const uri = document.uri;
    let fsPath =
      uri.scheme === "file"
        ? uri.fsPath
        : fsPathFromFileAtHeadUri(uri) ?? fsPathFromEmptyDocumentUri(uri);

    if (fsPath !== undefined) {
      fsPath = dirname(fsPath);
    } else {
      fsPath = fsPathFromObsRevisionUri(uri);
    }

    if (fsPath === undefined) {
      return undefined;
    }
    // we want to also return a package if the user views the diff
    return this.modifiedPackageMap.get(fsPath)?.pkg;
  }

  public async reloadCurrentPackage(): Promise<void> {
    if (this.vscodeWindow.activeTextEditor !== undefined) {
      await this.addPackageFromTextDocument(
        this.vscodeWindow.activeTextEditor.document
      );
    }
  }

  @debounce(EDITOR_CHANGE_DELAY_MS)
  private async onActiveEditorChange(
    editor: vscode.TextEditor | undefined
  ): Promise<void> {
    this.logger.trace(
      "reacting to active editor change event to file: '%s'",
      editor?.document.fileName
    );
    if (editor !== undefined) {
      await this.addPackageFromTextDocument(editor.document);
    }
    this.fireActivePackageEvent(this.getPkg(editor?.document));
  }

  /**
   * Fires the [[onDidChangeActivePackage]] event with the supplied package and
   * sets the current active package to that value.
   */
  private fireActivePackageEvent(pkg: ModifiedPackage | undefined) {
    if (!deepEqual(pkg, this._activePackage)) {
      this._activePackage = pkg;
      this.onDidChangeActivePackageEmitter.fire(pkg);
    }
  }

  /** */
  private insertPkgIntoMap(pkg: ModifiedPackage): void {
    if (this.modifiedPackageMap.has(pkg.path)) {
      this.updatePkgInMap(pkg);
      return;
    }

    const wsFolder = this.vscodeWorkspace.getWorkspaceFolder(
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
    const watcher = this.vscodeWorkspace.createFileSystemWatcher(
      new vscode.RelativePattern(wsFolder, `${relPath}/**`)
    );
    const pkgUpdate = async function (
      this: ActivePackageWatcher,
      uri: vscode.Uri
    ) {
      this.logger.trace(
        "File watcher for package %s registered a change in %s",
        pkg.name,
        uri.toString()
      );
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
            (err as Error).toString()
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

    this.modifiedPackageMap.set(pkg.path, { pkg, watcher });
  }

  private removePkgFromMap(pkgOrPath: ModifiedPackage | string): void {
    const key = typeof pkgOrPath === "string" ? pkgOrPath : pkgOrPath.path;
    const pkgAndWatcher = this.modifiedPackageMap.get(key);
    const deleteRes = this.modifiedPackageMap.delete(key);
    if (pkgAndWatcher !== undefined) {
      pkgAndWatcher.watcher.dispose();
    }
    if (this._activePackage?.path === key) {
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
    this.modifiedPackageMap.set(pkg.path, {
      pkg,
      watcher: pkgAndWatcher.watcher
    });
    if (pkg.path === this._activePackage?.path) {
      this.fireActivePackageEvent(pkg);
    }
  }

  /**
   *
   */
  private async addPackageFromTextDocument(
    document: vscode.TextDocument
  ): Promise<void> {
    if (document.uri.scheme !== "file") {
      this.logger.trace(
        "Will not register package from the editor %s, invalid uri scheme %s",
        document.fileName,
        document.uri.scheme
      );
      return;
    }
    const dir = dirname(document.uri.fsPath);
    if (!(await pathExists(join(dir, ".osc"), PathType.Directory))) {
      this.logger.trace(
        "Tried to read in a package %s, but no .osc directory exists",
        dir
      );
      return;
    }
    try {
      const modPkg = await readInModifiedPackageFromDir(dir);
      this.insertPkgIntoMap(modPkg);
    } catch (err) {
      this.logger.trace(err.stack);
      this.logger.trace(
        "Tried to read in a package from %s but got the error: %s",
        dir,
        (err as Error).toString()
      );

      this.removePkgFromMap(dir);
      return;
    }
  }
}
