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
import { dirname, join, relative, basename } from "path";
import { Logger } from "pino";
import * as vscode from "vscode";
import { AccountManager } from "./accounts";
import { ConnectionListenerLoggerBase } from "./base-components";
import { debounce } from "./decorators";
import { fsPathFromEmptyDocumentUri } from "./empty-file-provider";
import { fsPathFromObsRevisionUri } from "./scm-history";
import { fsPathFromFileAtHeadUri } from "./vcs";

export class ActivePackageWatcher extends ConnectionListenerLoggerBase {
  public static async createActivePackageWatcher(
    accountManager: AccountManager,
    logger: Logger
  ): Promise<ActivePackageWatcher> {
    const pkgCache = new ActivePackageWatcher(accountManager, logger);

    await Promise.all(
      vscode.window.visibleTextEditors.map((editor) => {
        return pkgCache.addPackageFromTextDocument(editor.document);
      })
    );

    pkgCache.activePackage = pkgCache.getPkg(
      vscode.window.activeTextEditor?.document
    );

    pkgCache.disposables.push(
      // FIXME: we can use this event to find out if we are viewing a diff?
      // vscode.window.onDidChangeVisibleTextEditors(
      //   pkgCache.onVisibleEditorsChange,
      //   pkgCache
      // ),
      vscode.window.onDidChangeActiveTextEditor(
        pkgCache.onActiveEditorChange,
        pkgCache
      )
      // FIXME: these two events fire *very* often (apparently on each SCM
      // update), we probably don't want to include them at all
      // vscode.workspace.onDidOpenTextDocument(pkgCache.onOpenDocument, pkgCache),
      // vscode.workspace.onDidCloseTextDocument(
      //   pkgCache.onCloseDocument,
      //   pkgCache
      // )
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
    const modPkgAndWatcher = this.modifiedPackageMap.get(fsPath);
    return modPkgAndWatcher === undefined ? undefined : modPkgAndWatcher[0];
  }

  @debounce(100)
  private async onOpenDocument(document: vscode.TextDocument): Promise<void> {
    const pkg = this.getPkg(document);
    if (pkg === undefined) {
      await this.addPackageFromTextDocument(document);
    }
  }

  @debounce(100)
  private onCloseDocument(document: vscode.TextDocument): void {
    const pkg = this.getPkg(document);
    if (pkg !== undefined) {
      if (
        vscode.workspace.textDocuments.filter(
          (doc) => this.getPkg(doc) !== undefined
        ).length === 0
      ) {
        this.removePkgFromMap(pkg);
      }
    }
  }

  @debounce(100)
  private async onVisibleEditorsChange(
    editors: vscode.TextEditor[]
  ): Promise<void> {
    const presentEditorPaths = [...this.modifiedPackageMap.keys()];

    await Promise.all(
      editors.map(async function (this: ActivePackageWatcher, editor) {
        const path = dirname(editor.document.uri.fsPath);
        if (!this.modifiedPackageMap.has(path)) {
          await this.addPackageFromTextDocument(editor.document);
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
  }

  @debounce(100)
  private async onActiveEditorChange(
    editor: vscode.TextEditor | undefined
  ): Promise<void> {
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
    this.activePackage = pkg;
    this.onDidChangeActivePackageEmitter.fire(pkg);
  }

  /** */
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
    const pkgUpdate = async function (
      this: ActivePackageWatcher,
      uri: vscode.Uri
    ) {
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
      this.logger.trace(
        "Tried to read in a package from %s but got the error: %s",
        dir,
        err.toString()
      );
      return;
    }
  }
}
