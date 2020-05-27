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
import { createHash } from "crypto";
import { promises as fsPromises } from "fs";
import {
  fetchFileContents,
  fetchPackage,
  fetchProject,
  Package,
  PackageFile,
  pathExists,
  PathType,
  Project
} from "open-build-service-api";
import { join } from "path";
import { Logger } from "pino";
import * as vscode from "vscode";
import { AccountManager, ApiUrl } from "./accounts";
import {
  BasePackage,
  BasePackageFile,
  BaseProject,
  ConnectionListenerLoggerBase,
  LoggingDisposableBase
} from "./base-components";
import { cmdPrefix } from "./constants";
import { loadMapFromMemento, saveMapToMemento } from "./util";

const projectBookmarkStorageKey: string = "vscodeObs.ProjectTree.Projects";

const cmdId = "ProjectBookmarks";

interface ObsFetchers {
  readonly fetchFileContents: typeof fetchFileContents;
  readonly fetchPackage: typeof fetchPackage;
  readonly fetchProject: typeof fetchProject;
}

/**
 * Identifier of the command that returns an array of all projects that have
 * been bookmarked for a specific API.
 *
 * For further details, see: [[ProjectBookmarkManager.getAllBookmarkedProjects]]
 */
export const GET_ALL_BOOKMARKED_PROJECTS_COMMAND = `${cmdPrefix}.${cmdId}.getAllBookmarkedProjects`;

/**
 * Identifier of the command that returns a specific project by apiUrl and name.
 *
 * For further details, see: [[ProjectBookmarkManager.getBookmarkedProject]]
 */
export const GET_BOOKMARKED_PROJECT_COMMAND = `${cmdPrefix}.${cmdId}.getBookmarkedProject`;

export const GET_FILE_FROM_CACHE_COMMAND = `${cmdPrefix}.${cmdId}.getPackageFile`;

// export const UPDATE_AND_GET_BOOKMARKED_PROJECT_COMMAND = `${cmdPrefix}.${cmdId}.updateAndGetBookmarkedProject`;

/** */
export function insertPackageIntoProject(
  pkg: Package,
  proj: Project
): ChangeType {
  if (pkg.projectName !== proj.name && pkg.apiUrl !== proj.apiUrl) {
    throw new Error(
      `Cannot insert package ${pkg.name} into project ${proj.name}, project names (${pkg.projectName} vs ${proj.name}) or API URLs (${pkg.apiUrl} vs ${proj.apiUrl}) do not match.`
    );
  }

  let pkgsOfProj = proj.packages ?? [];

  const matchingPkgIndex = pkgsOfProj.findIndex(
    (savedPkg) => savedPkg.name === pkg.name
  );

  let changeType: ChangeType;
  if (matchingPkgIndex === -1) {
    pkgsOfProj = pkgsOfProj.concat([pkg]);
    changeType = ChangeType.Add;
  } else {
    pkgsOfProj[matchingPkgIndex] = pkg;
    changeType = ChangeType.Modify;
  }

  proj.packages = pkgsOfProj;
  return changeType;
}

function dropFileContents(pkg: Package): Package {
  const { apiUrl, name, projectName, files } = pkg;
  return {
    apiUrl,
    files: files?.map((f) => new BasePackageFile(f)),
    name,
    projectName
  };
}

export const enum ChangedObject {
  //  Server,
  Project,
  Package
}

export const enum ChangeType {
  Add,
  Remove,
  Modify
}

export const enum RefreshBehavior {
  Never,
  FetchWhenMissing,
  Always
}

interface ChangedProject {
  readonly apiUrl: string;
  readonly projectName: string;
}

type ChangedPackage = ChangedProject & { readonly packageName: string };

export type ChangedElement = ChangedPackage | ChangedProject;

/**
 * Interface that contains the information about an update of the project
 * bookmarks.
 */
export interface BookmarkUpdate {
  /** What was changed? */
  readonly changedObject: ChangedObject;
  /** How was it changed? */
  readonly changeType: ChangeType;
  /** Identifier of the changed element */
  readonly element: Package | Project;
}

class UpdateEvent implements BookmarkUpdate {
  /** What was changed? */
  public readonly changedObject: ChangedObject;

  constructor(
    public readonly changeType: ChangeType,
    public readonly element: Project | Package
  ) {
    this.changedObject =
      (element as any).packageName === undefined
        ? ChangedObject.Project
        : ChangedObject.Package;
  }
}

class MetadataCache extends ConnectionListenerLoggerBase {
  public static async createMetadataCache(
    extensionContext: vscode.ExtensionContext,
    accountManager: AccountManager,
    logger: Logger,
    obsFetchers: ObsFetchers
  ): Promise<MetadataCache> {
    const cache = new MetadataCache(
      extensionContext,
      accountManager,
      logger,
      obsFetchers
    );
    await fsPromises.mkdir(cache.baseStoragePath, { recursive: true });
    return cache;
  }

  private static readonly PROJECT_STORAGE_FILE = "project.json";

  private readonly baseStoragePath: string;

  private constructor(
    extensionContext: vscode.ExtensionContext,
    accountManager: AccountManager,
    logger: Logger,
    private readonly obsFetchers: ObsFetchers
  ) {
    super(accountManager, logger);
    this.baseStoragePath = join(
      extensionContext.globalStoragePath,
      "projectCache"
    );
    this.logger.info(
      "Project cache will be stored in %s",
      this.baseStoragePath
    );
    this.disposables.push(
      vscode.commands.registerCommand(
        GET_FILE_FROM_CACHE_COMMAND,
        this.getPackageFile,
        this
      )
    );
  }

  // public async addPackageFile(
  //   pkgFile: PackageFile,
  //   pkg: Package
  // ): Promise<void> {
  //   // const proj = await this.getProject({apiUrl: pkg.apiUrl, name: pkg.projectName});
  //   const cachedPkg = (await this.getPackage(pkg)) ?? pkg;
  // }

  // public async addPackage(pkg: Package): Promise<void> {
  //   const emptyProj = {
  //     apiUrl: pkg.apiUrl,
  //     name: pkg.projectName
  //   };
  //   const proj = (await this.getProject(emptyProj)) ?? emptyProj;
  //   insertPackageIntoProject(dropFileContents(pkg), proj);
  //   await this.addProject(proj);
  // }

  public async getPackageFile(
    apiUrl: string,
    pkgFile: BasePackageFile,
    refreshBehavior: RefreshBehavior = RefreshBehavior.FetchWhenMissing
  ): Promise<PackageFile> {
    const pkg = await this.getPackage(
      new BasePackage(apiUrl, pkgFile.projectName, pkgFile.packageName),
      refreshBehavior
    );
    const fileContentsDir = join(
      this.getProjectBasePath({ apiUrl, name: pkgFile.projectName }),
      pkgFile.packageName
    );
    const fileContentsPath = join(fileContentsDir, pkgFile.name);

    const file: PackageFile =
      pkg.files?.find((f) => f.name === pkgFile.name) ?? pkgFile;

    if (await pathExists(fileContentsPath, PathType.File)) {
      try {
        file.contents = await fsPromises.readFile(fileContentsPath);
      } catch (err) {
        this.logger.error(
          "Failed to read the file contents from %s",
          fileContentsPath
        );
        await this.unlinkFile(fileContentsPath);
      }
    }

    if (
      refreshBehavior === RefreshBehavior.Always ||
      (file.contents === undefined && RefreshBehavior.FetchWhenMissing)
    ) {
      assert(
        refreshBehavior !== RefreshBehavior.Never,
        "Must not try to fetch the package contents when refreshBehavior is set to Never"
      );
      const account = this.activeAccounts.getConfig(apiUrl);

      if (account === undefined) {
        throw new Error(
          `Cannot fetch the file ${pkgFile.projectName}/${pkgFile.packageName}/${pkgFile.name} from ${apiUrl}, no account is configured`
        );
      }
      try {
        file.contents = await this.obsFetchers.fetchFileContents(
          account.connection,
          pkgFile
        );
        await fsPromises.mkdir(fileContentsDir, { recursive: true });
        await fsPromises.writeFile(fileContentsPath, file.contents);
      } catch (err) {
        this.logger.error(
          "Tried to fetch & save the file contents of %s/%s/%s to %s but got an error: %s",
          pkgFile.projectName,
          pkgFile.packageName,
          pkgFile.name,
          fileContentsPath,
          err.toString()
        );
      }
    }
    return file;
  }

  /**
   * Retrieve the requested package from the cache, optionally fetching data if
   * required or requested.
   *
   * @throw It only throws if data need to be fetched and a related error
   *     occurs.
   */
  public async getPackage(
    pkg: BasePackage,
    refreshBehavior: RefreshBehavior = RefreshBehavior.FetchWhenMissing
  ): Promise<Package> {
    const emptyProj: Project = {
      apiUrl: pkg.apiUrl,
      name: pkg.projectName
    };

    const proj = await this.getProject(emptyProj, refreshBehavior);
    const cachedPkg: Package =
      proj.packages?.find((p) => p.name === pkg.name) ?? pkg;

    if (
      refreshBehavior === RefreshBehavior.Always ||
      cachedPkg.files === undefined
    ) {
      const account = this.activeAccounts.getConfig(pkg.apiUrl);

      if (account === undefined) {
        throw new Error(
          `Cannot fetch the package ${pkg.projectName}/${pkg.name} from ${pkg.apiUrl}, no account is configured`
        );
      }

      const newPkg = await this.obsFetchers.fetchPackage(
        account.connection,
        pkg.projectName,
        pkg.name,
        { retrieveFileContents: false, expandLinks: true }
      );
      insertPackageIntoProject(newPkg, proj);
      await this.saveProject(proj);
      return newPkg;
    } else {
      return pkg;
    }
  }

  public async getProject(
    proj: BaseProject,
    refreshBehavior: RefreshBehavior = RefreshBehavior.FetchWhenMissing
  ): Promise<Project> {
    let projectFromCache: Project | undefined;
    let projectJsonContents: string | undefined;
    const projJson = join(
      this.getProjectBasePath(proj),
      MetadataCache.PROJECT_STORAGE_FILE
    );

    if (await pathExists(projJson, PathType.File)) {
      try {
        projectJsonContents = await fsPromises.readFile(projJson, {
          encoding: "utf8"
        });
      } catch (err) {
        this.logger.error(
          "Tried to read file %s, but got the error %s",
          projJson,
          err.toString()
        );

        await this.unlinkFile(projJson);
      }
    }

    if (projectJsonContents !== undefined) {
      try {
        projectFromCache = JSON.parse(projectJsonContents);
      } catch (err) {
        this.logger.error(
          "Could not decode the project %s from %s, got the error: %s",
          proj.name,
          proj.apiUrl,
          err.toString()
        );
        await this.unlinkFile(projJson);
      }
    }

    if (
      (projectFromCache === undefined ||
        refreshBehavior === RefreshBehavior.Always ||
        (refreshBehavior === RefreshBehavior.FetchWhenMissing &&
          projectFromCache.packages === undefined)) &&
      refreshBehavior !== RefreshBehavior.Never
    ) {
      const account = this.activeAccounts.getConfig(proj.apiUrl);
      if (account === undefined) {
        throw new Error(
          `Cannot fetch project ${proj.name} from ${proj.apiUrl}: no account is configured`
        );
      }

      const freshProj = await this.obsFetchers.fetchProject(
        account.connection,
        proj.name,
        { getPackageList: true }
      );
      await this.saveProject(freshProj);
      return freshProj;
      // } catch (err) {
      //   this.logger.error(
      //     "Tried to fetch the project %s from %s, but got an error: %s",
      //     proj.name,
      //     proj.apiUrl,
      //     err.toString()
      //   );
      // }
    }
    if (projectFromCache !== undefined) {
      return projectFromCache;
    }
    return proj;
  }

  private async saveProject(proj: Project): Promise<void> {
    const basePath = this.getProjectBasePath(proj);
    await fsPromises.mkdir(basePath, { recursive: true });
    await fsPromises.writeFile(
      join(basePath, MetadataCache.PROJECT_STORAGE_FILE),
      JSON.stringify(proj)
    );
  }

  /** remove the project.json file with the given file without throwing any exceptions */
  private async unlinkFile(path: string): Promise<void> {
    try {
      await fsPromises.unlink(path);
    } catch (err) {
      this.logger.error("Failed to remove %s due to: %s", path, err.toString());
    }
  }

  private getApiHash(projectOrPackage: BaseProject | BasePackage): string {
    let hash = createHash("md5");
    hash = hash.update(projectOrPackage.apiUrl);
    return hash.digest("hex");
  }

  private getProjectBasePath(proj: BaseProject): string {
    return join(this.baseStoragePath, this.getApiHash(proj), proj.name);
  }
}

/**
 * Class that is responsible for storing project bookmarks.
 */
export class ProjectBookmarkManager extends LoggingDisposableBase {
  public static async createProjectBookmarkManager(
    ctx: vscode.ExtensionContext,
    accountManager: AccountManager,
    logger: Logger,
    obsFetchers: ObsFetchers = { fetchProject, fetchFileContents, fetchPackage }
  ): Promise<ProjectBookmarkManager> {
    const cache = await MetadataCache.createMetadataCache(
      ctx,
      accountManager,
      logger,
      obsFetchers
    );
    const mngr = new ProjectBookmarkManager(cache, ctx.globalState, logger);
    mngr.disposables.push(cache);
    return mngr;
  }

  /**
   * Event that is fired every time the bookmarks are modified.
   *
   * The passed object includes additional information about how the type of
   * change that occurred.
   */
  public onBookmarkUpdate: vscode.Event<BookmarkUpdate>;

  private bookmarkedProjects: Map<ApiUrl, Project[]> = new Map<
    ApiUrl,
    Project[]
  >();

  private onBookmarkUpdateEmitter: vscode.EventEmitter<
    BookmarkUpdate
  > = new vscode.EventEmitter();

  private constructor(
    private readonly metadataCache: MetadataCache,
    private globalState: vscode.Memento,

    logger: Logger
  ) {
    super(logger);

    this.bookmarkedProjects = loadMapFromMemento(
      globalState,
      projectBookmarkStorageKey
    );

    this.onBookmarkUpdate = this.onBookmarkUpdateEmitter.event;

    this.disposables.push(
      this.onBookmarkUpdateEmitter,
      vscode.commands.registerCommand(
        GET_ALL_BOOKMARKED_PROJECTS_COMMAND,
        this.getAllBookmarkedProjects,
        this
      ),
      vscode.commands.registerCommand(
        GET_BOOKMARKED_PROJECT_COMMAND,
        this.getBookmarkedProject,
        this
      )
      // vscode.commands.registerCommand(
      //   UPDATE_AND_GET_BOOKMARKED_PROJECT_COMMAND,
      //   this.updateAndGetBookmarkedProject,
      //   this
      // )
    );
  }

  /**
   * Returns the list of all projects that are bookmarked for the respective
   * `apiUrl`.
   *
   * This function is also available via the command with the identifier
   * [[GET_ALL_BOOKMARKED_PROJECTS_COMMAND]].
   *
   * @return An array of projects that have been bookmarked for the specified
   *     API (if none have been bookmarked, then an empty array is returned).
   *     If the `apiUrl` parameter is omitted, then `undefined` is returned.
   */
  public async getAllBookmarkedProjects(
    apiUrl?: ApiUrl
  ): Promise<Project[] | undefined> {
    if (apiUrl === undefined) {
      return undefined;
    }
    const allProjectsOfApi: Project[] =
      this.bookmarkedProjects.get(apiUrl) ?? [];
    const cachedProjects = await Promise.all(
      allProjectsOfApi.map((proj) =>
        this.getBookmarkedProject(apiUrl, proj.name)
      )
    );

    return cachedProjects.filter((proj) => proj !== undefined) as Project[];
  }

  /**
   * Finds a specific project in the bookmarks and returns it.
   *
   * This function is also available via the command with the identifier
   * [[GET_BOOKMARKED_PROJECT_COMMAND]].
   */
  public async getBookmarkedProject(
    apiUrl?: ApiUrl,
    projectName?: string,
    refreshBehavior: RefreshBehavior = RefreshBehavior.FetchWhenMissing
  ): Promise<Project | undefined> {
    if (apiUrl === undefined || projectName === undefined) {
      this.logger.debug(
        "getBookmarkedProject called without a valid apiUrl (%s) or projectName (%s)",
        apiUrl,
        projectName
      );
      return undefined;
    }
    const reducedProj = this.bookmarkedProjects
      .get(apiUrl)
      ?.find((proj) => proj.name === projectName);

    if (reducedProj === undefined) {
      this.logger.debug(
        "requested bookmarked project %s from %s not found in bookmarks",
        projectName,
        apiUrl
      );
      return undefined;
    }

    const cachedProj = await this.metadataCache.getProject(
      {
        apiUrl,
        name: projectName
      },
      refreshBehavior
    );

    const { packages, ...rest } = cachedProj;

    return {
      ...rest,
      packages: packages?.filter(
        (pkg) =>
          reducedProj.packages?.find(
            (bookmarkedPkg) => bookmarkedPkg.name === pkg.name
          ) !== undefined
      )
    };
  }

  /**
   * Put or update the given project in the list of bookmarked projects.
   *
   * If the project is not yet present, then it is added. If it is present, then
   * the existing entry is overwritten.
   * The updated bookmarks are always saved in the [[globalState]] Memento.
   */
  public async addProjectToBookmarks(proj: Project): Promise<void> {
    let allProjects = this.bookmarkedProjects.get(proj.apiUrl) ?? [];
    const matchingProjectIndex = allProjects.findIndex(
      (bookmarkedProj) => bookmarkedProj.name === proj.name
    );

    const { name, apiUrl, packages } = proj;
    const reducedProj: Project = {
      apiUrl,
      name,
      packages: packages?.map((pkg) => dropFileContents(pkg))
    };

    let changeType: ChangeType;
    if (matchingProjectIndex === -1) {
      allProjects = allProjects.concat([reducedProj]);
      changeType = ChangeType.Add;
    } else {
      allProjects[matchingProjectIndex] = reducedProj;
      changeType = ChangeType.Modify;
    }
    this.bookmarkedProjects.set(proj.apiUrl, allProjects);

    await this.saveBookmarkedProjects(new UpdateEvent(changeType, proj));
  }

  // FIXME: needs a better name, as this does **not** always update
  /* public async updateAndGetBookmarkedProject(
    proj: Project,
    forceFetchPackages: boolean = true
  ): Promise<Project> {
    const cachedProj = await this.getBookmarkedProject(proj.apiUrl, proj.name);
    if (cachedProj === undefined) {
      this.logger.debug(
        "Calling update project on not bookmarked project %s from %s",
        proj.name,
        proj.apiUrl
      );
    } else {
      if (
        cachedProj.packages !== undefined &&
        cachedProj.packages.length > 0 &&
        !forceFetchPackages
      ) {
        return cachedProj;
      }
    }

    const account = this.activeAccounts.getConfig(proj.apiUrl);

    if (account === undefined) {
      const errMsg = `Cannot update the project ${proj.name}, the corresponding account does not exist`;
      throw new Error(errMsg);
    }

    const updatedProj = await fetchProject(account.connection, proj.name, true);
    await this.addProjectToBookmarks(updatedProj);
    return updatedProj;
  }*/

  public async removeProjectFromBookmarks(proj: Project): Promise<void> {
    const projects = this.bookmarkedProjects.get(proj.apiUrl);
    if (projects === undefined) {
      this.logger.info(
        "No project bookmarks are present for the API %s",
        proj.apiUrl
      );
      return;
    }
    this.bookmarkedProjects.set(
      proj.apiUrl,
      projects.filter((project) => project.name !== proj.name)
    );
    await this.saveBookmarkedProjects(new UpdateEvent(ChangeType.Remove, proj));
  }

  /**
   * Finds a specified package in the bookmarks and returns it.
   *
   * This function is also available via the command with the identifier
   * [[GET_BOOKMARKED_PACKAGE_COMMAND]].
   */
  public async getBookmarkedPackage(
    apiUrl?: ApiUrl,
    projectName?: string,
    packageName?: string,
    refreshBehavior: RefreshBehavior = RefreshBehavior.FetchWhenMissing
  ): Promise<Package | undefined> {
    if (
      apiUrl === undefined ||
      projectName === undefined ||
      packageName === undefined
    ) {
      return undefined;
    }
    const proj = await this.getBookmarkedProject(
      apiUrl,
      projectName,
      refreshBehavior
    );
    if (proj === undefined) {
      return undefined;
    }
    const pkg = proj.packages?.find((p) => p.name === packageName);

    if (pkg !== undefined) {
      return this.metadataCache.getPackage(pkg, refreshBehavior);
    }
    return pkg;
  }

  /**
   * Put or update the package in the list of bookmarked projects.
   *
   * Try to find the project to which this package belongs by name or throw an
   * exception if it isn't found. Then add the package to the list of packages
   * if it is not present or update the existing version.
   * The resulting bookmarks are then saved in the [[globalState]] Memento.
   *
   * @param apiUrl  API URL of the Project to which the package belongs.
   * @param pkg  The package to be added or updated
   * @param refreshView  Run [[refresh]] once the project bookmarks have been
   *     updated.
   *
   * @throw Error when there is no project with the name [[pkg.project]].
   */
  public async addPackageToBookmarks(pkg: Package): Promise<void> {
    const allProjects = this.bookmarkedProjects.get(pkg.apiUrl) ?? [];
    const matchingProjIndex = allProjects.findIndex(
      (proj) => proj.name === pkg.projectName
    );
    if (matchingProjIndex === -1) {
      throw new Error(
        `Cannot find project ${pkg.projectName} from the API ${pkg.apiUrl} in the bookmarked projects`
      );
    }
    assert(
      allProjects[matchingProjIndex].packages !== undefined,
      `package list of the project ${pkg.projectName} must not be undefined`
    );

    const changeType = insertPackageIntoProject(
      pkg,
      allProjects[matchingProjIndex]
    );
    // let pkgsOfProj = allProjects[matchingProjIndex].packages!;

    // const matchingPkgIndex = pkgsOfProj.findIndex(
    //   (savedPkg) => savedPkg.name === pkg.name
    // );

    // if (matchingPkgIndex === -1) {
    //   pkgsOfProj = pkgsOfProj.concat([pkg]);
    // } else {
    //   pkgsOfProj[matchingPkgIndex] = pkg;
    // }

    // allProjects[matchingProjIndex].packages = pkgsOfProj;

    this.bookmarkedProjects.set(pkg.apiUrl, allProjects);

    await this.saveBookmarkedProjects(new UpdateEvent(changeType, pkg));
  }

  /*public async updateAndGetBookmarkedPackage(
    pkg: Package,
    forceFetchFiles: boolean = true
  ): Promise<Package> {
    const cachedProj = await this.getBookmarkedProject(
      pkg.apiUrl,
      pkg.projectName
    );

    if (cachedProj === undefined) {
      this.logger.error(
        "Could not retrieve the project %s/%s from the cache",
        pkg.projectName,
        pkg.name
      );
      return pkg;
    }

    const apiUrl = pkg.apiUrl;
    const con = this.activeAccounts.getConfig(apiUrl)?.connection;
    if (con === undefined) {
      throw new Error(
        `Cannot refresh package ${pkg.name}, no Connection for it exists`
      );
    }

    if (!forceFetchFiles && cachedPkg.files !== undefined) {
      return pkg;
    }

    const updatedPkg = await fetchPackage(con, pkg.projectName, pkg.name, {
      retrieveFileContents: false
    });
    await this.addPackageToBookmarks(updatedPkg);
    return updatedPkg;
  }*/

  public async removePackageFromBookmarks(pkg: Package): Promise<void> {
    const allProjects = this.bookmarkedProjects.get(pkg.apiUrl) ?? [];
    const matchingProjIndex = allProjects.findIndex(
      (proj) => proj.name === pkg.projectName
    );
    if (matchingProjIndex === -1) {
      this.logger.trace(
        "Removing of the Package Bookmark %s from the API %s is not possible, the API has no projects",
        pkg.name,
        pkg.apiUrl
      );
      return;
    }

    // assert(
    //   allProjects[matchingProjIndex].packages !== undefined,
    //   `package list of the project ${pkg.project} must not be undefined`
    // );

    allProjects[matchingProjIndex].packages = allProjects[
      matchingProjIndex
    ].packages?.filter((savedPkg) => savedPkg.name !== pkg.name);

    this.bookmarkedProjects.set(pkg.apiUrl, allProjects);

    await this.saveBookmarkedProjects(new UpdateEvent(ChangeType.Remove, pkg));
  }

  /*public async getBookmarkedFile(
    apiUrl?: string,
    projectName?: string,
    packageName?: string,
    fileName?: string,
    refreshBehavior: RefreshBehavior = RefreshBehavior.FetchWhenMissing
  ): Promise<PackageFile | undefined> {
    if (
      apiUrl === undefined ||
      projectName === undefined ||
      packageName === undefined ||
      fileName === undefined
    ) {
      return undefined;
    }
    const pkg: Package = (await this.getBookmarkedPackage(
      apiUrl,
      projectName,
      packageName,
      refreshBehavior
    )) ?? { name: packageName, projectName, apiUrl };

    const pkgFile: PackageFile = pkg.files?.find(
      (f) => f.name === fileName
    ) ?? { name: fileName, projectName, packageName };

    if (
      refreshBehavior === RefreshBehavior.Always ||
      (refreshBehavior === RefreshBehavior.FetchWhenMissing &&
        pkgFile.contents === undefined)
    ) {
      const account = this.activeAccounts.getConfig(apiUrl);
      if (account === undefined) {
        this.logger.error(
          "Cannot fetch the package %s/%s from %s, no account is configured",
          projectName,
          packageName,
          apiUrl
        );
      } else {
        pkgFile.contents = await fetchFileContents(account.connection, pkgFile);
      }
    }
    return pkgFile;
  }*/

  private async saveBookmarkedProjects(
    updateEvent: BookmarkUpdate
  ): Promise<void> {
    await saveMapToMemento(
      this.globalState,
      projectBookmarkStorageKey,
      this.bookmarkedProjects
    );
    this.onBookmarkUpdateEmitter.fire(updateEvent);
  }
}
