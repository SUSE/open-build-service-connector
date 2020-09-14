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

// import * as assert from "assert";
import {
  fetchPackage,
  fetchProject,
  ModifiedPackage,
  Package,
  pathExists,
  PathType,
  Project,
  readInCheckedOutProject,
  readInModifiedPackageFromDir
} from "open-build-service-api";
import { basename, dirname, join, relative } from "path";
import { Logger } from "pino";
import * as vscode from "vscode";
import { AccountManager } from "./accounts";
import { ConnectionListenerLoggerBase } from "./base-components";
import { PackageBookmark, ProjectBookmark } from "./bookmarks";
import { debounce } from "./decorators";
import {
  OBS_PACKAGE_FILE_URI_SCHEME,
  RemotePackageFileContentProvider
} from "./package-file-contents";
import {
  GET_BOOKMARKED_PACKAGE_COMMAND,
  GET_BOOKMARKED_PROJECT_COMMAND
} from "./project-bookmarks";
import { getPkgPathFromVcsUri } from "./vcs";

/** Currently active project of the current text editor window. */
export interface CurrentPackage {
  /**
   * The Project belonging to the currently opened file.
   * `undefined` if the file does not belong to any Project.
   */
  readonly currentProject: Project | CheckedOutProject | undefined;

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
   * additional properties of the [[activeProject]].
   *
   * This field must be present when [[activeProject]] is not undefined.
   */
  properties?: {
    /**
     * If this project is checked out, then the path to its root folder is saved
     * in this variable.
     */
    readonly checkedOutPath: string | undefined;
  };
}

/* class WatchedProject extends DisposableBase {
  private _watchedPackages: string[];
  private _packages: ModifiedPackage[] = [];
  private _projMeta: ProjectMeta | undefined;

  private watcher: vscode.FileSystemWatcher;

  private onProjectUpdateEmitter = new vscode.EventEmitter<ProjectUpdate>();

  public static async createWatchedProject(
    fsPath: string,
    packages: string[]
  ): Promise<WatchedProject> {
    const watchedProject = new WatchedProject(fsPath, packages);
    try {
      watchedProject._projMeta = (await readInCheckedOutProject(fsPath)).meta;
    } catch (err) {}

    await Promise.all(
      packages.map(async (packageName, index) => {
        try {
          watchedProject._packages[index] = await readInModifiedPackageFromDir(
            join(fsPath, packageName)
          );
          assert(
            watchedProject._packages[index].name ===
              watchedProject._watchedPackages[index]
          );
        } catch (err) {}
      })
    );
    return watchedProject;
  }

  public readonly onProjectUpdate = this.onProjectUpdateEmitter.event;

  get watchedPackages(): string[] {
    return this._watchedPackages;
  }

  get projectMeta(): ProjectMeta | undefined {
    return this._projMeta;
  }

  public async getPackage(
    pkgName: string
  ): Promise<ModifiedPackage | undefined> {
    const pkgInd = this._watchedPackages.findIndex((name) => name === pkgName);
    return pkgInd === -1 ? undefined : this._packages[pkgInd];
  }

  public async addWatchedPackage(pkgName: string): Promise<void> {
    if (this._watchedPackages.find((name) => name === pkgName) === undefined) {
      this._watchedPackages.push(pkgName);
      this._packages.push(
        await readInModifiedPackageFromDir(join(this.fsPath, pkgName))
      );
    }
  }

  public ensurePackageNotWatched(pkgName: string): void {
    const ind = this._watchedPackages.findIndex((name) => name === pkgName);
    if (ind > -1) {
      this._watchedPackages.splice(ind, 1);
      this._packages.splice(ind, 1);
    }
  }

  private constructor(public readonly fsPath: string, packages: string[]) {
    super();

    this.fsPath = fsPath;
    this._watchedPackages = packages;

    const wsFolder = vscode.workspace.getWorkspaceFolder(
      vscode.Uri.file(fsPath)
    );
    if (wsFolder === undefined) {
      throw new Error(
        `Cannot get workspace folder from project in path: ${fsPath}`
      );
    }
    const relPath = relative(wsFolder.uri.fsPath, fsPath);
    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(wsFolder, `${relPath}/**`)
    );

    this.disposables.push(
      this.watcher.onDidCreate(this.pkgUpdateCallback, this),
      this.watcher.onDidDelete(this.pkgUpdateCallback, this),
      this.watcher.onDidChange(this.pkgUpdateCallback, this),
      this.watcher,
      this.onProjectUpdateEmitter
    );
  }
}*/

async function getProjectOfPackage(
  packagePath: string
): Promise<Project | undefined> {
  const potentialProjPath = dirname(packagePath);
  const wsFolder = vscode.workspace.getWorkspaceFolder(
    vscode.Uri.file(potentialProjPath)
  );
  if (wsFolder === undefined) {
    return undefined;
  }
  try {
    return readInCheckedOutProject(potentialProjPath);
  } catch (_err) {
    return undefined;
  }
}

interface LocalPackage {
  pkg: ModifiedPackage;
  project: Project;
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
    (pkg as ModifiedPackage).path !== undefined &&
    typeof (pkg as ModifiedPackage).path === "string" &&
    (pkg as ModifiedPackage).filesInWorkdir !== undefined &&
    Array.isArray((pkg as ModifiedPackage).filesInWorkdir)
  );
}

interface CheckedOutProject extends Project {
  readonly checkoutPath: string;
}

function isCheckedOutProject(
  proj: Project | CheckedOutProject
): proj is CheckedOutProject {
  return (
    (proj as CheckedOutProject).checkoutPath !== undefined &&
    typeof (proj as CheckedOutProject).checkoutPath === "string"
  );
}

const EMPTY_CUR_PKG: CurrentPackage = Object.freeze({
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
    logger: Logger
  ): Promise<CurrentPackageWatcher> {
    const pkgWatcher = new CurrentPackageWatcherImpl(accountManager, logger);

    await Promise.all(
      vscode.window.visibleTextEditors.map((editor) => {
        return pkgWatcher.addPackageFromUri(editor.document.uri);
      })
    );

    await pkgWatcher.onActiveEditorChange(vscode.window.activeTextEditor);

    return pkgWatcher;
  }

  private _currentPackage: CurrentPackage = EMPTY_CUR_PKG;

  private localPackages = new Map<string, LocalPackage>();

  private remotePackages = new Map<vscode.Uri, RemotePackage>();

  private watchedProjects = new Map<
    string,
    { project: Project; watcher: vscode.FileSystemWatcher }
  >();

  public get currentPackage(): CurrentPackage {
    return this._currentPackage;
  }

  private onDidChangeCurrentPackageEmitter: vscode.EventEmitter<
    CurrentPackage
  > = new vscode.EventEmitter<CurrentPackage>();

  private constructor(accountManager: AccountManager, logger: Logger) {
    super(accountManager, logger);
    this.onDidChangeCurrentPackage = this.onDidChangeCurrentPackageEmitter.event;
    this.disposables.push(
      this.onDidChangeCurrentPackageEmitter,
      vscode.window.onDidChangeActiveTextEditor(this.onActiveEditorChange, this)
    );
  }

  public getAllLocalPackages(): Map<vscode.WorkspaceFolder, ModifiedPackage[]> {
    const res = new Map<vscode.WorkspaceFolder, ModifiedPackage[]>();
    for (const [path, localPkg] of this.localPackages) {
      const wsFolder = vscode.workspace.getWorkspaceFolder(
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

  public async reloadCurrentPackage(): Promise<void> {
    if (this._currentPackage.currentPackage === undefined) {
      return;
    }
    try {
      const {
        currentProject,
        currentFilename,
        properties
      } = this._currentPackage;
      if (isModifiedPackage(this._currentPackage.currentPackage)) {
        const currentPackage = await readInModifiedPackageFromDir(
          this._currentPackage.currentPackage.path
        );
        const localPkg = this.localPackages.get(currentPackage.path);
        if (localPkg === undefined) {
          this.logger.error(
            "Reload of the current package %s/%s was requested, but it was not found in the map of local packages",
            this._currentPackage.currentPackage.projectName,
            this._currentPackage.currentPackage.name
          );
          // FIXME: we should add the package now
        } else {
          this.localPackages.set(currentPackage.path, {
            project: localPkg?.project,
            pkg: currentPackage,
            projectCheckedOut: localPkg?.projectCheckedOut,
            packageWatcher: localPkg?.packageWatcher
          });
        }
        this._currentPackage = {
          currentProject,
          currentPackage,
          currentFilename,
          properties
        };
        this.fireActivePackageEvent();
      } else {
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
        const currentPackage = await fetchPackage(
          con,
          this._currentPackage.currentPackage.projectName,
          this._currentPackage.currentPackage.name,
          { retrieveFileContents: false }
        );
        const uri = vscode.window.activeTextEditor?.document.uri;
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
      }
    } catch (err) {
      this.logger.error(
        "Tried to reload the package %s, but got the error %s",
        this._currentPackage.currentPackage?.name,
        (err as Error).toString()
      );
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

    try {
      const project = await readInCheckedOutProject(projKey);
      this.watchedProjects.set(projKey, {
        project,
        watcher: watchedProj.watcher
      });
      if (this._currentPackage.currentProject !== undefined) {
        const isCur = isCheckedOutProject(this._currentPackage.currentProject)
          ? this._currentPackage.currentProject.checkoutPath === projKey
          : this._currentPackage.currentProject.apiUrl === project.apiUrl &&
            this._currentPackage.currentProject.name === project.name;
        if (isCur) {
          const { currentProject, ...rest } = this._currentPackage;
          this._currentPackage = { currentProject: project, ...rest };
          this.fireActivePackageEvent();
        }
      }
    } catch (err) {
      this.logger.error(
        "Tried to read in the project from %s, but got the error %s",
        projKey,
        (err as Error).toString()
      );
    }
  }

  private async pkgUpdateCallback(uri: vscode.Uri): Promise<void> {
    if (uri.scheme !== "file") {
      // shouldn't happen
      this.logger.error(
        "file system watcher received a non file uri: %s",
        uri.toString()
      );
      return;
    }
    const fsPath = uri.fsPath;
    const dotOscIndex = fsPath.indexOf(".osc");
    const pkgPath =
      dotOscIndex === -1 ? dirname(fsPath) : fsPath.substring(0, dotOscIndex);

    const localPkg = this.localPackages.get(pkgPath);

    if (localPkg === undefined) {
      this.logger.trace(
        "A package watcher got triggered on the uri %s, but no package is registered under this location.",
        uri
      );
      return;
    }

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
        this._currentPackage = {
          currentPackage: pkg,
          currentProject: project,
          currentFilename: this._currentPackage.currentFilename,
          properties: {
            checkedOutPath: projectCheckedOut ? dirname(pkgPath) : undefined
          }
        };
        this.fireActivePackageEvent();
      }
    } catch (err) {
      this.logger.error(
        "Tried reading in a package from %s, but got the following error: %s",
        fsPath,
        (err as Error).toString()
      );
    }
  }

  @debounce(100)
  private async onActiveEditorChange(
    editor: vscode.TextEditor | undefined
  ): Promise<void> {
    const currentFilename =
      editor !== undefined ? basename(editor?.document.uri.fsPath) : undefined;
    this._currentPackage = EMPTY_CUR_PKG;

    if (editor !== undefined) {
      if (!this.isTextDocumentTracked(editor.document)) {
        this._currentPackage = await this.addPackageFromUri(
          editor.document.uri
        );
      } else {
        if (editor.document.uri.scheme === OBS_PACKAGE_FILE_URI_SCHEME) {
          const remotePkg = this.remotePackages.get(editor.document.uri);
          if (remotePkg !== undefined) {
            this._currentPackage = {
              currentProject: remotePkg.project,
              currentPackage: remotePkg.pkg,
              currentFilename,
              properties: {
                checkedOutPath: isCheckedOutProject(remotePkg.project)
                  ? remotePkg.project.checkoutPath
                  : undefined
              }
            };
          }
        } else {
          const pkgPath = getPkgPathFromVcsUri(editor.document.uri);
          if (pkgPath !== undefined) {
            const localPkg = this.localPackages.get(pkgPath);

            if (localPkg !== undefined) {
              this._currentPackage = {
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
      }
    }
    this.fireActivePackageEvent();
  }

  /**
   * Fires the [[onDidChangeActivePackage]] event with the supplied package and
   * sets the current active package to that value.
   */
  private fireActivePackageEvent(): void {
    this.onDidChangeCurrentPackageEmitter.fire(this._currentPackage);
  }

  private isTextDocumentTracked(document: vscode.TextDocument): boolean {
    if (document.uri.scheme === OBS_PACKAGE_FILE_URI_SCHEME) {
      return this.remotePackages.has(document.uri);
    }
    const fsPath = getPkgPathFromVcsUri(document.uri);
    return fsPath === undefined ? false : this.localPackages.has(fsPath);
  }

  /** */
  // private insertPkgIntoMap(pkg: ModifiedPackage): void {
  //   if (this.modifiedPackageMap.has(pkg.path)) {
  //     this.updatePkgInMap(pkg);
  //     return;
  //   }

  //   this.modifiedPackageMap.set(pkg.path, [pkg, watcher]);
  // }

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
    if (uri.scheme === OBS_PACKAGE_FILE_URI_SCHEME) {
      let project: Project | undefined;
      let pkg: Package | undefined;
      const {
        apiUrl,
        pkgFile
      } = RemotePackageFileContentProvider.uriToPackageFile(uri);
      [project, pkg] = await Promise.all([
        vscode.commands.executeCommand<Project | undefined>(
          GET_BOOKMARKED_PROJECT_COMMAND,
          apiUrl,
          pkgFile.projectName
        ),
        vscode.commands.executeCommand<Package | undefined>(
          GET_BOOKMARKED_PACKAGE_COMMAND,
          apiUrl,
          pkgFile.projectName,
          pkgFile.packageName
        )
      ]);

      if (project === undefined || pkg === undefined) {
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
              project = await fetchProject(con, pkgFile.projectName, {
                fetchPackageList: true
              });
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
              pkg = await fetchPackage(
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
        currentProject: project,
        currentPackage: pkg,
        currentFilename: basename(uri.toString())
        // FIXME: find out if the project is checked out somewhere
        // properties: { checkedOutPath: project}
      };
    } else {
      const fsPath = getPkgPathFromVcsUri(uri);

      if (fsPath === undefined) {
        this.logger.error("Could not obtain fsPath from uri %s", uri);
        return EMPTY_CUR_PKG;
      }

      // const dir = dirname(fsPath);
      if (!(await pathExists(join(fsPath, ".osc"), PathType.Directory))) {
        this.logger.trace(
          "Tried to read in a package %s, but no .osc directory exists",
          fsPath
        );
        return EMPTY_CUR_PKG;
      }

      try {
        const pkg = await readInModifiedPackageFromDir(fsPath);

        const wsFolder = vscode.workspace.getWorkspaceFolder(
          vscode.Uri.file(fsPath)
        );
        if (wsFolder === undefined) {
          this.logger.error(
            "Cannot get workspace folder from project in path: %s",
            fsPath
          );
          return EMPTY_CUR_PKG;
        }
        const relPath = relative(wsFolder.uri.fsPath, fsPath);
        const packageWatcher = vscode.workspace.createFileSystemWatcher(
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

        const proj = await getProjectOfPackage(fsPath);

        if (proj !== undefined) {
          // the package has a parent project that needs to be watched
          const projPath = dirname(fsPath);

          const watchedProj = this.watchedProjects.get(projPath);
          if (watchedProj === undefined) {
            const wsFolder = vscode.workspace.getWorkspaceFolder(
              vscode.Uri.file(projPath)
            );
            if (wsFolder === undefined) {
              this.logger.error(
                "Cannot get workspace folder from project in path: %s",
                projPath
              );
              return EMPTY_CUR_PKG;
            }
            const relPath = relative(wsFolder.uri.fsPath, projPath);
            const projWatcher = vscode.workspace.createFileSystemWatcher(
              new vscode.RelativePattern(wsFolder, `${relPath}/.osc*/*`)
            );

            this.disposables.push(
              projWatcher,
              projWatcher.onDidChange(this.projUpdateCallback, this),
              projWatcher.onDidCreate(this.projUpdateCallback, this),
              projWatcher.onDidDelete(this.projUpdateCallback, this)
            );

            this.watchedProjects.set(projPath, {
              project: proj,
              watcher: projWatcher
            });
          }
        }

        this.localPackages.set(pkg.path, {
          pkg,
          project: proj ?? { name: pkg.projectName, apiUrl: pkg.apiUrl },
          projectCheckedOut: proj !== undefined,
          packageWatcher
        });

        return {
          currentProject: proj,
          currentPackage: pkg,
          currentFilename: basename(fsPath),
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
        return EMPTY_CUR_PKG;
      }
    }
  }
}
