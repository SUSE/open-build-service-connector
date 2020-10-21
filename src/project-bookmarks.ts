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
  ModifiedPackage,
  Package,
  PackageFile,
  pathExists,
  PathType,
  Project
} from "open-build-service-api";
import { join } from "path";
import { Logger } from "pino";
import { inspect } from "util";
import * as vscode from "vscode";
import { AccountManager, ApiUrl } from "./accounts";
import {
  BasePackage,
  BasePackageFile,
  BaseProject,
  ConnectionListenerLoggerBase,
  LoggingDisposableBase
} from "./base-components";
import {
  BookmarkState,
  isProjectBookmark,
  PackageBookmark,
  packageBookmarkFromPackage,
  PackageBookmarkImpl,
  ProjectBookmark,
  ProjectBookmarkImpl
} from "./bookmarks";
import { cmdPrefix } from "./constants";
import { DEFAULT_OBS_FETCHERS, ObsFetchers } from "./dependency-injection";
import {
  dropUndefined,
  loadMapFromMemento,
  saveMapToMemento,
  setDifference,
  setUnion
} from "./util";

const projectBookmarkStorageKey: string = "vscodeObs.ProjectTree.Projects";

const cmdId = "ProjectBookmarks";

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

/**
 * Identifier of the command that returns the specified package by apiUrl,
 * project name and package name.
 *
 * This command directly calls the function [[ProjectBookmarkManager.getBookmarkedPackage]]
 */
export const GET_BOOKMARKED_PACKAGE_COMMAND = `${cmdPrefix}.${cmdId}.getBookmarkedPackage`;

export const GET_FILE_FROM_CACHE_COMMAND = `${cmdPrefix}.${cmdId}.getPackageFile`;

// export const UPDATE_AND_GET_BOOKMARKED_PROJECT_COMMAND = `${cmdPrefix}.${cmdId}.updateAndGetBookmarkedProject`;

/**
 * Insert the package `pkg` into the package list of `proj`.
 *
 * @throw `Error` when the packages project does not match `proj`.
 * @return [[ChangeType.Add]] if the package was not yet in list of packages or
 *     [[ChangeType.Modify]] if `pkg` was already in the package list of `proj`
 *     and got updated
 */
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

export function dropFileContents(pkg: ModifiedPackage): ModifiedPackage;
export function dropFileContents(pkg: PackageBookmark): PackageBookmark;
export function dropFileContents(pkg: Package): Package;

export function dropFileContents(
  pkg: Package | PackageBookmark | ModifiedPackage
): Package | PackageBookmark | ModifiedPackage {
  const { files, ...rest } = pkg;
  return {
    files: files?.map((f) => new BasePackageFile(f)),
    ...rest
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
  readonly element: PackageBookmark | ProjectBookmark;
}

class UpdateEvent implements BookmarkUpdate {
  /** What was changed? */
  public readonly changedObject: ChangedObject;

  constructor(
    public readonly changeType: ChangeType,
    public readonly element: ProjectBookmark | PackageBookmark
  ) {
    this.changedObject =
      (element as any).projectName === undefined
        ? ChangedObject.Project
        : ChangedObject.Package;
  }
}

class MetadataCache extends ConnectionListenerLoggerBase {
  public static async createMetadataCache(
    extensionContext: vscode.ExtensionContext,
    accountManager: AccountManager,
    logger: Logger,
    initialProjects = new Map<ApiUrl, ProjectBookmark[]>(),
    obsFetchers: ObsFetchers = DEFAULT_OBS_FETCHERS
  ): Promise<MetadataCache> {
    const cache = new MetadataCache(
      extensionContext,
      accountManager,
      logger,
      obsFetchers
    );
    await fsPromises.mkdir(cache.baseStoragePath, { recursive: true });

    await Promise.all(
      [...initialProjects.values()].map((bookmarks) =>
        Promise.all(bookmarks.map((b) => cache.saveProject(b)))
      )
    );
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
      extensionContext.globalStorageUri.fsPath,
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
    pkg: Package,
    refreshBehavior: RefreshBehavior = RefreshBehavior.FetchWhenMissing,
    saveInProject: boolean = true
  ): Promise<PackageBookmark> {
    const emptyProj: Project = {
      apiUrl: pkg.apiUrl,
      name: pkg.projectName
    };

    // we really don't want to refresh the project's metadata here, as
    // getPackage() gets also called from getProject() and that leads to nasty
    // endless recursions
    const proj = await this.getProject(emptyProj, RefreshBehavior.Never);
    const cachedPkg: Package =
      proj.packages?.find((p) => p.name === pkg.name) ?? pkg;

    const uncachedFilesPresent =
      setDifference(
        new Set((pkg.files ?? []).map((f) => f.name)),
        new Set((cachedPkg.files ?? []).map((f) => f.name))
      ).size > 0;

    if (
      refreshBehavior === RefreshBehavior.Always ||
      (refreshBehavior === RefreshBehavior.FetchWhenMissing &&
        (cachedPkg.files === undefined || uncachedFilesPresent))
    ) {
      this.logger.trace(
        "Refetching %s/%s from %s, because %s",
        pkg.projectName,
        pkg.name,
        pkg.apiUrl,
        refreshBehavior === RefreshBehavior.Always
          ? "refresh forced"
          : refreshBehavior === RefreshBehavior.FetchWhenMissing &&
            (cachedPkg.files === undefined || uncachedFilesPresent)
          ? "files need to get refetched"
          : assert(false, "this branch must be unreachable")
      );

      const account = this.activeAccounts.getConfig(pkg.apiUrl);

      if (account === undefined) {
        throw new Error(
          `Cannot fetch the package ${pkg.projectName}/${pkg.name} from ${pkg.apiUrl}, no account is configured`
        );
      }

      try {
        const newPkg = await this.obsFetchers.fetchPackage(
          account.connection,
          pkg.projectName,
          pkg.name,
          { retrieveFileContents: false, expandLinks: true }
        );
        assert(
          newPkg.files !== undefined && Array.isArray(newPkg.files),
          `fetchPackage must return a list of files for the package ${
            pkg.projectName
          }/${pkg.name}, but got ${inspect(newPkg.files)} instead`
        );

        if (saveInProject) {
          insertPackageIntoProject(newPkg, proj);
          await this.saveProject(proj);
        }
        return packageBookmarkFromPackage(newPkg);
      } catch (err) {
        this.logger.error(
          "Could not fetch the package %s/%s from %s",
          pkg.projectName,
          pkg.name,
          pkg.apiUrl
        );
        return {
          state: BookmarkState.RemoteGone,
          ...pkg,
          files: cachedPkg.files ?? []
        };
      }
    } else {
      return packageBookmarkFromPackage(pkg);
    }
  }

  public async addProject(proj: ProjectBookmark): Promise<void> {
    const projFromCache = await this.getProject(proj, RefreshBehavior.Never);
    const mergedProject = { ...projFromCache, ...proj };
    await this.saveProject(mergedProject);
  }

  public async getProject(
    proj: Project,
    refreshBehavior: RefreshBehavior = RefreshBehavior.FetchWhenMissing
  ): Promise<ProjectBookmark> {
    let projectFromCache: ProjectBookmark | undefined;
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

    // the project that was passed has packages that are not in the cache
    // => we'll have to add those as well
    const uncachedPackagesPresent =
      setDifference(
        new Set((proj.packages ?? []).map((p) => p.name)),
        new Set((projectFromCache?.packages ?? []).map((p) => p.name))
      ).size > 0;

    const incompletePackages = (projectFromCache?.packages ?? []).filter(
      (pkg) => pkg.files === undefined
    );

    let needFetchAll = projectFromCache === undefined;
    let needFetchPackages =
      uncachedPackagesPresent ||
      incompletePackages.length > 0 ||
      projectFromCache?.packages === undefined;
    const pkgRefetchReason = `${
      uncachedPackagesPresent ? "uncached packages in requested project" : ""
    }${
      incompletePackages.length > 0
        ? "; packages without a file list are present"
        : ""
    }${
      projectFromCache?.packages === undefined
        ? "; cached project has never fetched any packages"
        : ""
    }`;

    let needFetchMeta = projectFromCache?.meta === undefined;

    if (refreshBehavior === RefreshBehavior.Always) {
      needFetchAll = true;
      needFetchMeta = true;
      needFetchPackages = true;
    }

    // return what we have if no refresh is needed or wanted
    if (
      refreshBehavior === RefreshBehavior.Never ||
      (refreshBehavior === RefreshBehavior.FetchWhenMissing &&
        !needFetchMeta &&
        !needFetchPackages &&
        !needFetchAll)
    ) {
      if (projectFromCache !== undefined) {
        return projectFromCache;
      }
      return new ProjectBookmarkImpl(proj, BookmarkState.Unknown);
    }

    this.logger.trace(
      "Refetching the project %s from %s, because %s",
      proj.name,
      proj.apiUrl,
      refreshBehavior === RefreshBehavior.Always
        ? "refresh forced"
        : needFetchAll
        ? "need to refetch packages and metadata"
        : needFetchMeta
        ? "need to refetch metadata"
        : needFetchPackages
        ? `need to refetch the packages (${pkgRefetchReason})`
        : assert(false, "this branch must be unreachable")
    );

    const account = this.activeAccounts.getConfig(proj.apiUrl);
    if (account === undefined) {
      throw new Error(
        `Cannot fetch project ${proj.name} from ${proj.apiUrl}: no account is configured`
      );
    }

    // try to fetch the project if:
    // - none is cached
    // - have to refresh always
    // - additional packages are being added
    // - uncached packages are present and refreshBehavior is FetchWhenMissing
    try {
      const {
        packages,
        ...restOfFreshProj
      } = await this.obsFetchers.fetchProject(account.connection, proj.name, {
        fetchPackageList: false
      });

      assert(
        packages === undefined,
        `fetchProject should reply with packages = undefined if invoked with fetchPackageList: false, but got ${inspect(
          packages
        )} instead`
      );
      assert(
        restOfFreshProj.meta !== undefined,
        `meta of ${restOfFreshProj.name} is undefined but it must be defined`
      );

      const pkgNamesToSave = [
        ...setUnion(
          //setUnion(
          new Set((proj.packages ?? []).map((pkg) => pkg.name)),
          new Set((projectFromCache?.packages ?? []).map((pkg) => pkg.name))
          //),
          //new Set(incompletePackages)
        ).values()
      ];

      // Need to save the returned packages here, as getPackage() can insert
      // files into the packages. But that will not be returned by this
      // function without re-reading (which we don't want to do)
      const newPackages: PackageBookmark[] = [];
      for (const name of pkgNamesToSave) {
        const pkgToFetch: Package = {
          name,
          apiUrl: proj.apiUrl,
          projectName: proj.name,
          files:
            proj.packages?.find((p) => p.name === name)?.files ??
            projectFromCache?.packages?.find((p) => p.name === name)?.files
        };
        newPackages.push(
          await this.getPackage(pkgToFetch, refreshBehavior, false)
        );
      }

      const projToSave = {
        packages: newPackages,
        state: BookmarkState.Ok,
        ...restOfFreshProj
      };
      await this.saveProject(projToSave);

      assert(newPackages.length === pkgNamesToSave.length);

      return new ProjectBookmarkImpl(
        {
          packages: newPackages,
          ...restOfFreshProj
        },
        BookmarkState.Ok
      );
    } catch (err) {
      this.logger.error(
        "Tried to fetch the project %s from %s, but got an error: %s",
        proj.name,
        proj.apiUrl,
        err.toString()
      );
      return {
        ...proj,
        state: BookmarkState.RemoteGone,
        packages: (projectFromCache?.packages ?? []).map(
          (pkg) => new PackageBookmarkImpl(pkg, BookmarkState.RemoteGone)
        )
      };
    }
  }

  private async saveProject(proj: ProjectBookmark): Promise<void> {
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

  /**
   * Returns the path in which the project's metadata will be stored.
   *
   * The path is a combination of the project's api url and it's name encoded as
   * hexadecimal to avoid using any invalid characters in filenames (e.g. ':' on
   * Windows).
   */
  private getProjectBasePath(proj: BaseProject): string {
    return join(
      this.baseStoragePath,
      Buffer.from(proj.apiUrl).toString("hex"),
      Buffer.from(proj.name).toString("hex")
    );
  }
}

type GetBookmarkedProjectRetT = ProjectBookmark | undefined;

type GetBookmarkedPackageRetT = PackageBookmark | undefined;

/**
 * Class that is responsible for storing project bookmarks.
 */
export class ProjectBookmarkManager extends LoggingDisposableBase {
  public static async getBookmarkedProjectCommand(
    apiUrl?: ApiUrl,
    projectName?: string,
    refreshBehavior: RefreshBehavior = RefreshBehavior.FetchWhenMissing
  ): Promise<GetBookmarkedProjectRetT> {
    return await vscode.commands.executeCommand<GetBookmarkedProjectRetT>(
      GET_BOOKMARKED_PROJECT_COMMAND,
      apiUrl,
      projectName,
      refreshBehavior
    );
  }

  public static async getBookmarkedPackageCommand(
    apiUrl?: ApiUrl,
    projectName?: string,
    packageName?: string,
    refreshBehavior: RefreshBehavior = RefreshBehavior.FetchWhenMissing
  ): Promise<GetBookmarkedPackageRetT> {
    return await vscode.commands.executeCommand<GetBookmarkedPackageRetT>(
      GET_BOOKMARKED_PACKAGE_COMMAND,
      apiUrl,
      projectName,
      packageName,
      refreshBehavior
    );
  }

  public static async createProjectBookmarkManager(
    ctx: vscode.ExtensionContext,
    accountManager: AccountManager,
    logger: Logger,
    obsFetchers: ObsFetchers = DEFAULT_OBS_FETCHERS
  ): Promise<ProjectBookmarkManager> {
    const bookmarkedProjects = loadMapFromMemento<ApiUrl, ProjectBookmark[]>(
      ctx.globalState,
      projectBookmarkStorageKey
    );

    const cache = await MetadataCache.createMetadataCache(
      ctx,
      accountManager,
      logger,
      bookmarkedProjects,
      obsFetchers
    );
    const mngr = new ProjectBookmarkManager(cache, ctx.globalState, logger);
    mngr.bookmarkedProjects = bookmarkedProjects;

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

  private bookmarkedProjects = new Map<ApiUrl, ProjectBookmark[]>();

  private onBookmarkUpdateEmitter: vscode.EventEmitter<
    BookmarkUpdate
  > = new vscode.EventEmitter();

  private constructor(
    private readonly metadataCache: MetadataCache,
    private globalState: vscode.Memento,

    logger: Logger
  ) {
    super(logger);

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
      ),
      vscode.commands.registerCommand(
        GET_BOOKMARKED_PACKAGE_COMMAND,
        this.getBookmarkedPackage,
        this
      )
    );
  }

  public async dispose(): Promise<void> {
    await this.saveBookmarkedProjects();
    super.dispose();
  }

  /**
   * Overload for the invocation via a command that has been called without
   * parameters.
   */
  public async getAllBookmarkedProjects(): Promise<undefined>;
  public async getAllBookmarkedProjects(
    apiUrl: ApiUrl
  ): Promise<ProjectBookmark[]>;

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
  ): Promise<ProjectBookmark[] | undefined> {
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

    return dropUndefined(cachedProjects);
  }

  public async getBookmarkedProject(): Promise<undefined>;
  public async getBookmarkedProject(apiUrl: string): Promise<undefined>;
  public async getBookmarkedProject(
    apiUrl: ApiUrl,
    projectName: string,
    refreshBehavior?: RefreshBehavior
  ): Promise<ProjectBookmark | undefined>;

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
  ): Promise<GetBookmarkedProjectRetT> {
    if (apiUrl === undefined || projectName === undefined) {
      this.logger.debug(
        "getBookmarkedProject called without a valid apiUrl (%s) or projectName (%s)",
        apiUrl,
        projectName
      );
      return undefined;
    }

    const projsOfApi = this.bookmarkedProjects.get(apiUrl);
    if (projsOfApi === undefined) {
      return undefined;
    }

    const reducedProjIndex = projsOfApi.findIndex(
      (proj) => proj.name === projectName
    );

    if (reducedProjIndex === -1) {
      this.logger.debug(
        "requested bookmarked project %s from %s not found in bookmarks",
        projectName,
        apiUrl
      );
      return undefined;
    }

    const reducedProj = projsOfApi[reducedProjIndex];

    const cachedProj = await this.metadataCache.getProject(
      {
        apiUrl,
        name: projectName,
        packages: reducedProj.packages
      },
      refreshBehavior
    );

    const { packages, state, ...rest } = cachedProj;

    const projWithFilteredPkgs = {
      ...rest,
      // in case the project was explicitly added in a broken state, then
      // metadataCache.getProject() can set the state to BookmarkState.Unknown,
      // but we then want to use the state from the current map
      state: state === BookmarkState.Unknown ? reducedProj.state : state,
      packages: packages?.filter(
        (pkg) =>
          reducedProj.packages?.find(
            (bookmarkedPkg) => bookmarkedPkg.name === pkg.name
          ) !== undefined
      )
    };

    projsOfApi[reducedProjIndex] = projWithFilteredPkgs;
    this.bookmarkedProjects.set(apiUrl, projsOfApi);

    await this.saveBookmarkedProjects();

    return projWithFilteredPkgs;
  }

  /**
   * Put or update the given project in the list of bookmarked projects.
   *
   * If the project is not yet present, then it is added. If it is present, then
   * the existing entry is overwritten.
   * The updated bookmarks are always saved in the [[globalState]] Memento.
   */
  public async addProjectToBookmarks(
    proj: Project | ProjectBookmark
  ): Promise<void> {
    this.logger.trace(
      "requested to add project %s, which is a %s",
      proj.name,
      isProjectBookmark(proj) ? "ProjectBookmark" : "Project"
    );

    let allProjects = this.bookmarkedProjects.get(proj.apiUrl) ?? [];
    const matchingProjectIndex = allProjects.findIndex(
      (bookmarkedProj) => bookmarkedProj.name === proj.name
    );

    const { name, apiUrl } = proj;

    const reducedProj: ProjectBookmark = isProjectBookmark(proj)
      ? {
          apiUrl,
          name,
          state: proj.state,
          packages: proj.packages?.map((pkg) => dropFileContents(pkg))
        }
      : {
          apiUrl,
          name,
          packages: proj.packages?.map((pkg) =>
            packageBookmarkFromPackage(dropFileContents(pkg))
          ),
          state: BookmarkState.Ok
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

    await Promise.all([
      this.saveBookmarkedProjects(new UpdateEvent(changeType, reducedProj)),
      this.metadataCache.addProject(reducedProj)
    ]);
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

  // FIXME: why is this not used??
  public async removeProjectFromBookmarks(proj: Project): Promise<void> {
    const projects = this.bookmarkedProjects.get(proj.apiUrl);
    if (projects === undefined) {
      this.logger.info(
        "No project bookmarks are present for the API %s",
        proj.apiUrl
      );
      return;
    }
    const projToDropIndex = projects.findIndex(
      (project) => project.name === proj.name
    );
    if (projToDropIndex === -1) {
      return;
    }
    const removedProj = projects.splice(projToDropIndex, 1);
    assert(removedProj.length === 1 && removedProj[0].name === proj.name);
    this.bookmarkedProjects.set(proj.apiUrl, projects);
    await this.saveBookmarkedProjects(
      new UpdateEvent(ChangeType.Remove, removedProj[0])
    );
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
  ): Promise<GetBookmarkedPackageRetT> {
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
   * @param pkg  The package to be added or updated
   *
   * @throw Error when there is no project with the name [[pkg.project]].
   */
  public async addPackageToBookmarks(pkg: Package): Promise<void> {
    let allProjects = this.bookmarkedProjects.get(pkg.apiUrl) ?? [];
    let matchingProjIndex = allProjects.findIndex(
      (proj) => proj.name === pkg.projectName
    );

    const { files, ...rest } = pkg;
    const pkgBookmark: PackageBookmark = {
      ...rest,
      files: files ?? [],
      state: BookmarkState.Ok
    };

    if (matchingProjIndex === -1) {
      const proj = {
        name: pkg.projectName,
        apiUrl: pkg.apiUrl,
        packages: [pkg]
      };
      await this.addProjectToBookmarks(proj);

      allProjects = this.bookmarkedProjects.get(pkg.apiUrl) ?? [];
      matchingProjIndex = allProjects.findIndex(
        (proj) => proj.name === pkg.projectName
      );
    }

    const changeType = insertPackageIntoProject(
      pkgBookmark,
      allProjects[matchingProjIndex]
    );

    this.bookmarkedProjects.set(pkg.apiUrl, allProjects);

    await this.saveBookmarkedProjects(new UpdateEvent(changeType, pkgBookmark));
  }

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

    if (allProjects[matchingProjIndex].packages === undefined) {
      return;
    }

    const pkgToDropIndex = allProjects[matchingProjIndex].packages?.findIndex(
      (savedPkg) => savedPkg.name === pkg.name
    );

    if (pkgToDropIndex === -1 || pkgToDropIndex === undefined) {
      return;
    }

    const droppedPkg = allProjects[matchingProjIndex].packages!.splice(
      pkgToDropIndex,
      1
    );

    assert(droppedPkg.length === 1 && droppedPkg[0].name === pkg.name);

    this.bookmarkedProjects.set(pkg.apiUrl, allProjects);

    await this.saveBookmarkedProjects(
      new UpdateEvent(ChangeType.Remove, droppedPkg[0])
    );
  }

  /**
   * Save the current project bookmarks in the global state and optionally fire
   * the [[onBookmarkUpdate]] event.
   */
  private async saveBookmarkedProjects(
    updateEvent?: BookmarkUpdate
  ): Promise<void> {
    if (updateEvent === undefined) {
      this.logger.trace("Saving project bookmarks");
    } else {
      this.logger.trace(
        "Saving project bookmarks and firing onBookmarkUpdate Event with %o",
        updateEvent
      );
    }
    await saveMapToMemento(
      this.globalState,
      projectBookmarkStorageKey,
      this.bookmarkedProjects
    );
    if (updateEvent !== undefined) {
      this.onBookmarkUpdateEmitter.fire(updateEvent);
    }
  }
}
