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

import { assert } from "./assert";
import {
  Connection,
  isProjectWithMeta,
  ModifiedPackage,
  Package,
  PackageFile,
  pathExists,
  PathType,
  Project,
  ProjectWithMeta,
  readInAndUpdateCheckedoutProject,
  readInModifiedPackageFromDir
} from "open-build-service-api";
import { basename, dirname, join, relative } from "path";
import { Logger } from "pino";
import * as vscode from "vscode";
import { AccountManager } from "./accounts";
import { ConnectionListenerLoggerBase } from "./base-components";
import {
  isPackageBookmark,
  isProjectBookmark,
  PackageBookmark,
  ProjectBookmark
} from "./bookmarks";
import { debounce } from "./decorators";
import {
  DEFAULT_OBS_FETCHERS,
  ObsFetchers,
  VscodeWindow,
  VscodeWorkspace
} from "./dependency-injection";
import {
  OBS_PACKAGE_FILE_URI_SCHEME,
  RemotePackageFileContentProvider
} from "./package-file-contents";
import {
  BookmarkUpdate,
  ChangedObject,
  ProjectBookmarkManager
} from "./project-bookmarks";
import { deepEqual } from "./util";
import { getPkgPathFromVcsUri } from "./vcs";

export const EDITOR_CHANGE_DELAY_MS = 100;

/** Currently active project of the current text editor window. */
export interface CurrentPackage {
  /**
   * The Project belonging to the currently opened file.
   * `undefined` if the file does not belong to any Project.
   */
  readonly currentProject:
    | ProjectWithMeta
    | CheckedOutProject
    | ProjectBookmark
    | undefined;

  /**
   *
   */
  readonly currentPackage:
    | ModifiedPackage
    | Package
    | PackageBookmark
    | undefined;

  /** The currently opened file belonging to the package [[currentPackage]] */
  readonly currentFilename: string | undefined;

  /**
   * additional properties of the [[currentProject]].
   *
   * This field must be present when [[currentProject]] is not undefined.
   */
  properties?: {
    /**
     * If this project is checked out, then the path to its root folder is saved
     * in this variable.
     */
    readonly checkedOutPath: string | undefined;
  };
}

const normalizePath = (path: string): string =>
  path[path.length - 1] === "/" ? path.slice(0, path.length - 1) : path;

interface LocalPackage {
  pkg: ModifiedPackage;
  project: ProjectWithMeta | CheckedOutProject;
  // FIXME: use CheckedOutProject instead?
  projectCheckedOut: boolean;
  packageWatcher: vscode.FileSystemWatcher;
}

interface RemotePackage {
  pkg: Package | PackageBookmark;
  project: Project | ProjectBookmark;
}

export function isModifiedPackage(
  pkg: Package | PackageBookmark | ModifiedPackage
): pkg is ModifiedPackage {
  return (
    /* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition */
    (pkg as ModifiedPackage).path !== undefined &&
    typeof (pkg as ModifiedPackage).path === "string" &&
    /* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition */
    (pkg as ModifiedPackage).filesInWorkdir !== undefined &&
    Array.isArray((pkg as ModifiedPackage).filesInWorkdir)
  );
}

export interface CheckedOutProject extends ProjectWithMeta {
  readonly checkoutPath: string;
}

function isCheckedOutProject(
  proj: Project | CheckedOutProject
): proj is CheckedOutProject {
  return (
    /* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition */
    (proj as CheckedOutProject).checkoutPath !== undefined &&
    typeof (proj as CheckedOutProject).checkoutPath === "string"
  );
}

const strcmp = (str1: string, str2: string): number =>
  str1 === str2 ? 0 : str1 > str2 ? 1 : -1;

const cmpFiles = (f1: PackageFile, f2: PackageFile): number =>
  strcmp(f1.name, f2.name);

export function currentPackagesEqual(
  pkg1: CurrentPackage | undefined,
  pkg2: CurrentPackage | undefined
): boolean {
  if (pkg1 === undefined && pkg2 === undefined) {
    return true;
  } else if (
    (pkg1 !== undefined && pkg2 === undefined) ||
    (pkg1 === undefined && pkg2 !== undefined)
  ) {
    return false;
  }

  assert(pkg1 !== undefined && pkg2 !== undefined);

  if (!deepEqual(pkg1.currentProject, pkg2.currentProject)) {
    return false;
  }
  if (pkg1.currentFilename !== pkg2.currentFilename) {
    return false;
  }
  if (pkg1.properties?.checkedOutPath !== pkg2.properties?.checkedOutPath) {
    return false;
  }

  if (pkg1.currentPackage === undefined && pkg2.currentPackage === undefined) {
    return true;
  } else if (
    (pkg1.currentPackage !== undefined && pkg2.currentPackage === undefined) ||
    (pkg1.currentPackage === undefined && pkg2.currentPackage !== undefined)
  ) {
    return false;
  }
  assert(
    pkg1.currentPackage !== undefined && pkg2.currentPackage !== undefined
  );
  if (
    isModifiedPackage(pkg1.currentPackage) &&
    isModifiedPackage(pkg2.currentPackage)
  ) {
    const {
      files: files1,
      filesInWorkdir: filesInWorkdir1,
      ...rest1
    } = pkg1.currentPackage;
    const {
      files: files2,
      filesInWorkdir: filesInWorkdir2,
      ...rest2
    } = pkg2.currentPackage;
    return (
      deepEqual(rest1, rest2) &&
      deepEqual(files1.sort(cmpFiles), files2.sort(cmpFiles)) &&
      deepEqual(filesInWorkdir1.sort(cmpFiles), filesInWorkdir2.sort(cmpFiles))
    );
  } else if (
    !isModifiedPackage(pkg1.currentPackage) &&
    !isModifiedPackage(pkg2.currentPackage)
  ) {
    const { files: files1, ...rest1 } = pkg1.currentPackage;
    const { files: files2, ...rest2 } = pkg2.currentPackage;
    return (
      deepEqual(rest1, rest2) &&
      deepEqual((files1 ?? []).sort(cmpFiles), (files2 ?? []).sort(cmpFiles))
    );
  } else {
    return false;
  }
}

export const EMPTY_CURRENT_PACKAGE: CurrentPackage = Object.freeze({
  currentFilename: undefined,
  currentPackage: undefined,
  currentProject: undefined
});

export interface CurrentPackageWatcher extends vscode.Disposable {
  readonly currentPackage: CurrentPackage;

  readonly onDidChangeCurrentPackage: vscode.Event<CurrentPackage>;

  getAllLocalPackages(): Map<vscode.WorkspaceFolder, ModifiedPackage[]>;

  reloadCurrentPackage(): Promise<void>;
}

export class CurrentPackageWatcherImpl
  extends ConnectionListenerLoggerBase
  implements CurrentPackageWatcher {
  public readonly onDidChangeCurrentPackage: vscode.Event<CurrentPackage>;

  public static async createCurrentPackageWatcher(
    accountManager: AccountManager,
    logger: Logger,
    bookmarkManager: ProjectBookmarkManager,
    vscodeWindow: VscodeWindow = vscode.window,
    vscodeWorkspace: VscodeWorkspace = vscode.workspace,
    obsFetchers: ObsFetchers = DEFAULT_OBS_FETCHERS
  ): Promise<CurrentPackageWatcher> {
    const pkgWatcher = new CurrentPackageWatcherImpl(
      accountManager,
      logger,
      bookmarkManager.onBookmarkUpdate,
      vscodeWindow,
      vscodeWorkspace,
      obsFetchers
    );

    await Promise.all(
      vscodeWindow.visibleTextEditors.map((editor) => {
        return pkgWatcher.addPackageFromUri(editor.document.uri);
      })
    );

    await pkgWatcher.onActiveEditorChange(vscodeWindow.activeTextEditor);

    return pkgWatcher;
  }

  private _currentPackage: CurrentPackage = EMPTY_CURRENT_PACKAGE;

  private localPackages = new Map<string, LocalPackage>();

  private remotePackages = new Map<vscode.Uri, RemotePackage>();

  private watchedProjects = new Map<
    string,
    { project: Project; watcher?: vscode.FileSystemWatcher; con?: Connection }
  >();

  public get currentPackage(): CurrentPackage {
    return this._currentPackage;
  }

  private onDidChangeCurrentPackageEmitter = new vscode.EventEmitter<CurrentPackage>();

  private constructor(
    accountManager: AccountManager,
    logger: Logger,
    onBookmarkUpdate: vscode.Event<BookmarkUpdate>,
    private readonly vscodeWindow: VscodeWindow,
    private readonly vscodeWorkspace: VscodeWorkspace,
    private readonly obsFetchers: ObsFetchers
  ) {
    super(accountManager, logger);
    this.onDidChangeCurrentPackage = this.onDidChangeCurrentPackageEmitter.event;
    this.disposables.push(
      this.onDidChangeCurrentPackageEmitter,
      this.vscodeWindow.onDidChangeActiveTextEditor(
        this.onActiveEditorChange,
        this
      ),
      onBookmarkUpdate(async (bookmarkUpdate) => {
        if (this.currentPackage.currentPackage === undefined) {
          return;
        }
        if (bookmarkUpdate.changedObject === ChangedObject.Project) {
          if (this.currentPackage.currentProject !== undefined) {
            if (
              this.currentPackage.currentProject.name ===
                bookmarkUpdate.element.name &&
              this.currentPackage.currentProject.apiUrl ===
                bookmarkUpdate.element.apiUrl
            ) {
              await this.reloadCurrentPackage();
            }
          } else {
            if (
              this.currentPackage.currentPackage.projectName ===
                bookmarkUpdate.element.name &&
              this.currentPackage.currentPackage.apiUrl ===
                bookmarkUpdate.element.apiUrl
            ) {
              await this.reloadCurrentPackage();
            }
          }
        } else {
          /* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition */
          assert(bookmarkUpdate.changedObject === ChangedObject.Package);
          if (
            this.currentPackage.currentPackage.name ===
              bookmarkUpdate.element.name &&
            this.currentPackage.currentPackage.apiUrl ===
              bookmarkUpdate.element.apiUrl
          ) {
            await this.reloadCurrentPackage();
          }
        }
      }, this)
    );
  }

  public getAllLocalPackages(): Map<vscode.WorkspaceFolder, ModifiedPackage[]> {
    const res = new Map<vscode.WorkspaceFolder, ModifiedPackage[]>();
    for (const [path, localPkg] of this.localPackages) {
      const wsFolder = this.vscodeWorkspace.getWorkspaceFolder(
        vscode.Uri.file(path)
      );
      if (wsFolder === undefined) {
        this.logger.error(
          "Could get the workspace folder of the package %s checked out in %s",
          localPkg.pkg.name,
          path
        );
      } else {
        const pkgsOfWsFolder = res.get(wsFolder);
        if (pkgsOfWsFolder === undefined) {
          res.set(wsFolder, [localPkg.pkg]);
        } else {
          pkgsOfWsFolder.push(localPkg.pkg);
          res.set(wsFolder, pkgsOfWsFolder);
        }
      }
    }
    return res;
  }

  /**
   * Force a reload of the current and notify all event listeners of changes.
   *
   * This function should be used in cases where it is known that a package will
   * change and where a reload is **crucial** to ensure a good UX as file system
   * watchers don't work on large workspaces.
   */
  public async reloadCurrentPackage(): Promise<void> {
    this.logger.trace("Forcing reload of the current package");

    if (this._currentPackage.currentPackage === undefined) {
      this.logger.trace("Current package is undefined, not reloading");
      return;
    }

    const {
      currentProject,
      currentFilename,
      properties
    } = this._currentPackage;
    if (isModifiedPackage(this._currentPackage.currentPackage)) {
      try {
        this.logger.trace(
          "Reloading the package %s from %s",
          this._currentPackage.currentPackage.name,
          this._currentPackage.currentPackage.path
        );

        let currentPackage = await readInModifiedPackageFromDir(
          this._currentPackage.currentPackage.path
        );
        const localPkg = this.localPackages.get(
          normalizePath(currentPackage.path)
        );
        if (localPkg === undefined) {
          // this case shouldn't actually happen, just to be safe here
          this.logger.error(
            "Reload of the current package %s/%s was requested, but it was not found in the map of local packages. Adding it now.",
            this._currentPackage.currentPackage.projectName,
            this._currentPackage.currentPackage.name
          );
          // we need to add the package via addPackageFromUri as the watchers
          // will otherwise not be created and registered properly
          const newCurrentPackage = (
            await this.addPackageFromUri(
              // the uri is only used to get the packages root folder
              vscode.Uri.file(
                join(currentPackage.path, "actually_completely_irrelevant")
              )
            )
          ).currentPackage;
          assert(
            newCurrentPackage !== undefined &&
              isModifiedPackage(newCurrentPackage) &&
              newCurrentPackage.path === currentPackage.path
          );
          currentPackage = newCurrentPackage;
        } else {
          this.localPackages.set(normalizePath(currentPackage.path), {
            project: localPkg.project,
            pkg: currentPackage,
            projectCheckedOut: localPkg.projectCheckedOut,
            packageWatcher: localPkg.packageWatcher
          });
        }
        this.fireCurrentPackageEvent({
          currentProject,
          currentPackage,
          currentFilename,
          properties
        });
      } catch (err) {
        this.logger.error(
          "Tried to reload the package %s, but got the error %s. Removing it now.",
          this._currentPackage.currentPackage.name,
          (err as Error).toString()
        );
        const path = normalizePath(this._currentPackage.currentPackage.path);
        this.localPackages.get(path)?.packageWatcher.dispose();
        this.localPackages.delete(path);
        this.fireCurrentPackageEvent(EMPTY_CURRENT_PACKAGE);
      }
    } else {
      try {
        const con = this.activeAccounts.getConfig(
          this._currentPackage.currentPackage.apiUrl
        )?.connection;
        if (con === undefined) {
          this.logger.error(
            "Cannot refresh the package %s/%s: no connection exists for the API %s",
            this._currentPackage.currentPackage.projectName,
            this._currentPackage.currentPackage.name,
            this._currentPackage.currentPackage.apiUrl
          );
          return;
        }
        const currentPackage = await this.obsFetchers.fetchPackage(
          con,
          this._currentPackage.currentPackage.projectName,
          this._currentPackage.currentPackage.name,
          { retrieveFileContents: false }
        );
        const uri = this.vscodeWindow.activeTextEditor?.document.uri;
        if (uri !== undefined) {
          const remotePkg = this.remotePackages.get(uri);
          this.remotePackages.set(uri, {
            project: remotePkg?.project ?? {
              name: currentPackage.projectName,
              apiUrl: currentPackage.apiUrl
            },
            pkg: currentPackage
          });
        }
        const newCurrentProject = isPackageBookmark(
          this._currentPackage.currentPackage
        )
          ? await ProjectBookmarkManager.getBookmarkedProjectCommand(
              this._currentPackage.currentPackage.apiUrl,
              this._currentPackage.currentPackage.projectName
            )
          : await this.obsFetchers.fetchProject(
              con,
              this._currentPackage.currentPackage.projectName,
              { fetchPackageList: false }
            );
        this.fireCurrentPackageEvent({
          currentPackage,
          currentFilename,
          currentProject:
            newCurrentProject ?? this._currentPackage.currentProject,
          properties
        });
      } catch (err) {
        this.logger.error(
          "Tried to reload the package %s, but got the error %s. Removing it now.",
          this._currentPackage.currentPackage.name,
          (err as Error).toString()
        );
        // FIXME: remove this package now
      }
    }
  }

  private async projUpdateCallback(uri: vscode.Uri): Promise<void> {
    if (uri.scheme !== "file") {
      this.logger.error(
        "file system watcher received a non file uri: %s",
        uri.toString()
      );
      return;
    }

    const fsPath = uri.fsPath;
    const dotOscIndex = fsPath.indexOf(".osc");
    if (dotOscIndex === -1) {
      this.logger.error(
        "file system watcher noticed a change outside of the .osc* directories: %s",
        fsPath
      );
      return;
    }
    const projKey = fsPath.substring(0, dotOscIndex);
    const watchedProj = this.watchedProjects.get(projKey);
    if (watchedProj === undefined) {
      this.logger.error(
        "Could not find a watched project for the uri %s and the key %s",
        uri,
        projKey
      );
      return;
    }
    const { con, watcher } = watchedProj;

    try {
      if (con === undefined) {
        throw new Error(
          `Cannot fetch project metadata from the API '${watchedProj.project.apiUrl}': no account is defined`
        );
      }
      const project = await readInAndUpdateCheckedoutProject(con, projKey);
      this.watchedProjects.set(projKey, { project, watcher, con });
      if (this._currentPackage.currentProject !== undefined) {
        const isCur = isCheckedOutProject(this._currentPackage.currentProject)
          ? this._currentPackage.currentProject.checkoutPath === projKey
          : this._currentPackage.currentProject.apiUrl === project.apiUrl &&
            this._currentPackage.currentProject.name === project.name;
        if (isCur) {
          const { currentProject: _ignore, ...rest } = this._currentPackage;
          this.fireCurrentPackageEvent({ currentProject: project, ...rest });
        }
      }
    } catch (err) {
      this.logger.error(
        "Tried to read in the project from %s, but got the error %s",
        projKey,
        (err as Error).toString()
      );
      watcher?.dispose();
      this.watchedProjects.delete(projKey);
    }
  }

  private async pkgUpdateCallback(uri: vscode.Uri): Promise<void> {
    const fsPath = uri.fsPath;
    this.logger.trace("File change in %s registered", fsPath);

    if (uri.scheme !== "file") {
      // shouldn't happen
      this.logger.error(
        "file system watcher received a non file uri: %s",
        uri.toString()
      );
      return;
    }

    const dotOscIndex = fsPath.indexOf(".osc");
    const pkgPath = normalizePath(
      dotOscIndex === -1 ? dirname(fsPath) : fsPath.substring(0, dotOscIndex)
    );

    const localPkg = this.localPackages.get(pkgPath);

    if (localPkg === undefined) {
      this.logger.trace(
        "A package watcher got triggered on the uri %s, but no package is registered under this location.",
        uri
      );
      return;
    }

    this.logger.trace(
      "Found the already checked out package %s",
      localPkg.pkg.name
    );

    try {
      const pkg = await readInModifiedPackageFromDir(pkgPath);
      const { project, projectCheckedOut, packageWatcher } = localPkg;
      this.localPackages.set(pkgPath, {
        pkg,
        project,
        projectCheckedOut,
        packageWatcher
      });
      if (
        this._currentPackage.currentPackage !== undefined &&
        isModifiedPackage(this._currentPackage.currentPackage) &&
        this._currentPackage.currentPackage.path === pkg.path
      ) {
        this.fireCurrentPackageEvent({
          currentPackage: pkg,
          currentProject: project,
          currentFilename: this._currentPackage.currentFilename,
          properties: {
            checkedOutPath: projectCheckedOut ? dirname(pkgPath) : undefined
          }
        });
      }
    } catch (err) {
      this.logger.error(
        "Tried reading in a package from %s, but got the following error: %s",
        fsPath,
        (err as Error).toString()
      );
      this.localPackages.get(pkgPath)?.packageWatcher.dispose();
      this.localPackages.delete(pkgPath);
      if (
        this._currentPackage.currentPackage !== undefined &&
        isModifiedPackage(this._currentPackage.currentPackage)
          ? normalizePath(this._currentPackage.currentPackage.path) === pkgPath
          : false
      ) {
        this.fireCurrentPackageEvent(EMPTY_CURRENT_PACKAGE);
      }
    }
  }

  @debounce(EDITOR_CHANGE_DELAY_MS)
  private async onActiveEditorChange(
    editor: vscode.TextEditor | undefined
  ): Promise<void> {
    this.logger.trace(
      "Active editor changed to file '%s'",
      editor?.document.fileName ?? "undefined"
    );

    const currentFilename =
      editor !== undefined ? basename(editor.document.fileName) : undefined;

    try {
      const newCurPkg = await (async (): Promise<CurrentPackage> => {
        if (editor === undefined) {
          this.logger.trace("No editor is active");
          return EMPTY_CURRENT_PACKAGE;
        }
        if (!this.isTextDocumentTracked(editor.document)) {
          const curPkg = await this.addPackageFromUri(editor.document.uri);
          this.logger.trace(
            "Document of editor was not already tracked and yielded the package '%s'",
            curPkg.currentPackage?.name ?? "undefined"
          );
          return curPkg;
        }

        if (editor.document.uri.scheme === OBS_PACKAGE_FILE_URI_SCHEME) {
          this.logger.trace(
            "Document of editor is tracked and it is a remote file on OBS"
          );
          const remotePkg = this.remotePackages.get(editor.document.uri);
          if (remotePkg !== undefined) {
            let currentProject: ProjectWithMeta;
            const remoteProj = remotePkg.project;
            if (
              remoteProj.meta === undefined ||
              !isProjectBookmark(remoteProj)
            ) {
              const con = this.activeAccounts.getConfig(
                remotePkg.project.apiUrl
              )?.connection;
              if (con === undefined) {
                throw new Error(
                  `Could not get a connection for the api '${remotePkg.project.apiUrl}' but one must exist as this belongs to a remote package`
                );
              }
              currentProject = await this.obsFetchers.fetchProject(
                con,
                remotePkg.project.name,
                {
                  fetchPackageList: true
                }
              );
            } else {
              assert(isProjectWithMeta(remoteProj));
              currentProject = remoteProj;
            }
            return {
              currentProject,
              currentPackage: remotePkg.pkg,
              currentFilename,
              properties: {
                // FIXME: the true branch is probably unreachable
                checkedOutPath: isCheckedOutProject(remotePkg.project)
                  ? remotePkg.project.checkoutPath
                  : undefined
              }
            };
          }
        } else {
          this.logger.trace(
            "Document of editor is tracked and it is a local file"
          );
          const pkgPath = getPkgPathFromVcsUri(editor.document.uri);
          if (pkgPath !== undefined) {
            const localPkg = this.localPackages.get(normalizePath(pkgPath));

            if (localPkg !== undefined) {
              return {
                currentProject: localPkg.project,
                currentPackage: localPkg.pkg,
                currentFilename,
                properties: {
                  checkedOutPath: localPkg.projectCheckedOut
                    ? dirname(localPkg.pkg.path)
                    : undefined
                }
              };
            }
          }
        }
        return EMPTY_CURRENT_PACKAGE;
      })();
      this.fireCurrentPackageEvent(newCurPkg);
    } catch (err) {
      this.logger.error(
        "Changing the active editor to '%s' resulted in the following error: %s",
        editor?.document.fileName ?? "undefined",
        (err as Error).toString()
      );
      this.fireCurrentPackageEvent(EMPTY_CURRENT_PACKAGE);
    }
  }

  /**
   * Fires the [[onDidChangeCurrentPackage]] event with the supplied package and
   * sets the current active package to that value.
   */
  private fireCurrentPackageEvent(newCurrentPkg: CurrentPackage): void {
    this.logger.trace(
      "New current package: %s",
      this._currentPackage.currentPackage?.name ?? "undefined"
    );
    this._currentPackage = newCurrentPkg;
    this.onDidChangeCurrentPackageEmitter.fire(this._currentPackage);
  }

  private isTextDocumentTracked(document: vscode.TextDocument): boolean {
    if (document.uri.scheme === OBS_PACKAGE_FILE_URI_SCHEME) {
      return this.remotePackages.has(document.uri);
    }
    const fsPath = getPkgPathFromVcsUri(document.uri);
    return fsPath === undefined
      ? false
      : this.localPackages.has(normalizePath(fsPath));
  }

  /** */
  // private insertPkgIntoMap(pkg: ModifiedPackage): void {
  //   if (this.modifiedPackageMap.has(pkg.path)) {
  //     this.updatePkgInMap(pkg);
  //     return;
  //   }

  //   this.modifiedPackageMap.set(pkg.path, [pkg, watcher]);
  // }

  // FIXME: add this back again:
  // private removePkgFromMap(pkgOrPath: ModifiedPackage | string): void {
  //   const key = typeof pkgOrPath === "string" ? pkgOrPath : pkgOrPath.path;
  //   const pkgAndWatcher = this.modifiedPackageMap.get(key);
  //   const deleteRes = this.modifiedPackageMap.delete(key);
  //   if (pkgAndWatcher !== undefined) {
  //     pkgAndWatcher[1].dispose();
  //   }
  //   if (this.currentPackage?.path === key) {
  //     this.fireActivePackageEvent(undefined);
  //   }
  //   assert(
  //     deleteRes === (pkgAndWatcher !== undefined),
  //     "Deletion of the package must succeed when we were able to retrieve it"
  //   );
  // }

  /**
   *
   */
  private async addPackageFromUri(uri: vscode.Uri): Promise<CurrentPackage> {
    this.logger.trace(
      "Trying to add a package from the uri %s",
      uri.toString()
    );
    if (uri.scheme === OBS_PACKAGE_FILE_URI_SCHEME) {
      let project;
      let pkg: Package | undefined;
      const {
        apiUrl,
        pkgFile
      } = RemotePackageFileContentProvider.uriToPackageFile(uri);
      [project, pkg] = await Promise.all([
        ProjectBookmarkManager.getBookmarkedProjectCommand(
          apiUrl,
          pkgFile.projectName
        ),
        ProjectBookmarkManager.getBookmarkedPackageCommand(
          apiUrl,
          pkgFile.projectName,
          pkgFile.packageName
        )
      ]);

      if (
        project === undefined ||
        pkg === undefined ||
        !isProjectWithMeta(project)
      ) {
        // apparently this is not a bookmark, try to fetch the project/package instead
        const con = this.activeAccounts.getConfig(apiUrl)?.connection;
        if (con === undefined) {
          // we have managed to open a file belonging to a Package for which we
          // don't have a connection??
          this.logger.error(
            "No connection exists for the API %s, which is required to retrieve the project for the file %s",
            apiUrl,
            uri
          );
        } else {
          try {
            if (project === undefined) {
              project = await this.obsFetchers.fetchProject(
                con,
                pkgFile.projectName,
                {
                  fetchPackageList: true
                }
              );
            }
          } catch (err) {
            this.logger.error(
              "Got the following error while trying to obtain the Project for the file %s: %s",
              uri,
              (err as Error).toString()
            );
            // something went wrong, we'll therefore reset activeProject to
            // undefined to not send invalid data
            project = undefined;
          }

          try {
            if (pkg === undefined) {
              pkg = await this.obsFetchers.fetchPackage(
                con,
                pkgFile.projectName,
                pkgFile.packageName,
                { expandLinks: true, retrieveFileContents: false }
              );
            }
          } catch (err) {
            this.logger.error(
              "Got the following error while trying to obtain the Package for the file %s: %s",
              uri,
              (err as Error).toString()
            );
            // something went wrong, we'll therefore reset activeProject to
            // undefined to not send invalid data
            pkg = undefined;
          }
        }

        if (pkg !== undefined) {
          this.remotePackages.set(uri, {
            pkg,
            project: project ?? { name: pkg.projectName, apiUrl: pkg.apiUrl }
          });
        } else {
          // FIXME
          this.logger.error("");
        }
      }

      return {
        currentProject:
          project !== undefined && isProjectWithMeta(project)
            ? project
            : undefined,
        currentPackage: pkg,
        currentFilename: basename(uri.toString())
        // FIXME: find out if the project is checked out somewhere
        // properties: { checkedOutPath: project}
      };
    } else {
      this.logger.trace("Uri does not belong to a remote file");

      const fsPath = getPkgPathFromVcsUri(uri);

      if (fsPath === undefined) {
        this.logger.error("Could not obtain fsPath from uri %s", uri);
        return EMPTY_CURRENT_PACKAGE;
      }

      // const dir = dirname(fsPath);
      if (!(await pathExists(join(fsPath, ".osc"), PathType.Directory))) {
        this.logger.trace(
          "Tried to read in a package %s, but no .osc directory exists",
          fsPath
        );
        return EMPTY_CURRENT_PACKAGE;
      }

      try {
        const pkg = await readInModifiedPackageFromDir(fsPath);

        const wsFolder = this.vscodeWorkspace.getWorkspaceFolder(
          vscode.Uri.file(fsPath)
        );
        if (wsFolder === undefined) {
          this.logger.error(
            "Cannot get workspace folder from uri in path: %s",
            fsPath
          );
          return EMPTY_CURRENT_PACKAGE;
        }
        const relPath = relative(wsFolder.uri.fsPath, fsPath);
        const packageWatcher = this.vscodeWorkspace.createFileSystemWatcher(
          new vscode.RelativePattern(
            wsFolder,
            relPath === "" ? "**" : `${relPath}/**`
          )
        );
        this.disposables.push(
          packageWatcher.onDidChange(this.pkgUpdateCallback, this),
          packageWatcher.onDidCreate(this.pkgUpdateCallback, this),
          packageWatcher.onDidDelete(this.pkgUpdateCallback, this),
          packageWatcher
        );

        this.logger.trace(
          "Read in package in from %s and added file system watchers",
          fsPath
        );

        const projPath = dirname(fsPath);
        const con = this.activeAccounts.getConfig(pkg.apiUrl)?.connection;

        if (con === undefined) {
          throw new Error(
            `Cannot fetch project via from the API '${pkg.apiUrl}': no account is configured`
          );
        }

        let proj: ProjectWithMeta | undefined;
        try {
          proj = await readInAndUpdateCheckedoutProject(con, projPath);
        } catch (err) {
          this.logger.trace(
            "Got the following error while reading in a project from %s: %s",
            projPath,
            (err as Error).toString()
          );
          proj = undefined;
        }

        if (proj !== undefined) {
          this.logger.trace("Found project in %s: %s", projPath, proj.name);

          const watchedProj = this.watchedProjects.get(projPath);
          if (watchedProj === undefined) {
            const wsFolder = this.vscodeWorkspace.getWorkspaceFolder(
              vscode.Uri.file(projPath)
            );
            // we need to handle the case where the project does not belong to
            // the workspace:
            // we still want to be able to read it in, but we do not want to add
            // to the watched projects
            // FIXME: or do we?
            let watcher: undefined | vscode.FileSystemWatcher;

            if (wsFolder === undefined) {
              this.logger.debug(
                "Cannot get workspace folder from project in path: %s",
                projPath
              );
            } else {
              const relPath = relative(wsFolder.uri.fsPath, projPath);
              watcher = this.vscodeWorkspace.createFileSystemWatcher(
                new vscode.RelativePattern(wsFolder, `${relPath}/.osc*/*`)
              );

              this.disposables.push(
                watcher,
                watcher.onDidChange(this.projUpdateCallback, this),
                watcher.onDidCreate(this.projUpdateCallback, this),
                watcher.onDidDelete(this.projUpdateCallback, this)
              );
            }

            this.watchedProjects.set(projPath, { project: proj, watcher, con });
            this.logger.trace(
              "Successfully registered the project '%s' in '%s'%s",
              proj.name,
              projPath,
              watcher === undefined ? "" : " with a filesystem watcher enabled"
            );
          }
        } else {
          this.logger.trace(
            "Could not find a parent project of %s in %s",
            pkg.name,
            dirname(pkg.path)
          );
        }

        const currentProject =
          proj ??
          (await this.obsFetchers.fetchProject(con, pkg.projectName, {
            fetchPackageList: true
          }));

        this.localPackages.set(pkg.path, {
          pkg,
          project: currentProject,
          projectCheckedOut: proj !== undefined,
          packageWatcher
        });

        return {
          currentProject,
          currentPackage: pkg,
          currentFilename: basename(uri.fsPath),
          properties: {
            checkedOutPath: proj !== undefined ? dirname(fsPath) : undefined
          }
        };
      } catch (err) {
        this.logger.error(
          "Tried to read in a package from %s, but got the error: %s",
          fsPath,
          (err as Error).toString()
        );
        return EMPTY_CURRENT_PACKAGE;
      }
    }
  }
}
