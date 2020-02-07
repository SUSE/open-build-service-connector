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
  getProject,
  Project,
  fetchPackage,
  HistoryFetchType,
  Package
} from "obs-ts";
import { fetchFileContents, PackageFile } from "obs-ts/lib/file";
import { Logger } from "pino";
import * as vscode from "vscode";
import { AccountStorage, ApiAccountMapping, ApiUrl } from "./accounts";
import { LoggingBase } from "./base-components";
import {
  loadMapFromMemento,
  logAndReportExceptions,
  saveMapToMemento
} from "./util";
import { VscodeWindow } from "./vscode-dep";
import { inspect } from "util";

const projectBookmarkStorageKey: string = "vscodeObs.ProjectTree.Projects";

/** URI scheme of the read-only files */
export const UriScheme = "vscodeObsPackageFile";

// class ProjectTreeRootElement extends vscode.TreeItem {
//   public readonly contextValue = "projectRoot";

//   constructor() {
//     super("Projects", vscode.TreeItemCollapsibleState.Expanded);
//   }
// }

// function isProjectTreeRootElement(
//   treeItem: ProjectTreeItem
// ): treeItem is ProjectTreeRootElement {
//   return treeItem.contextValue === "projectRoot";
// }

export class BookmarkedProjectsRootElement extends vscode.TreeItem {
  public readonly contextValue = "BookmarkedProjectsRoot";

  public readonly iconPath = {
    dark: "media/bookmark.svg",
    light: "media/bookmark_border.svg"
  };

  constructor() {
    super("Bookmarked Projects", vscode.TreeItemCollapsibleState.Expanded);
  }
}

function isBookmarkedProjectsRootElement(
  treeItem: ProjectTreeItem
): treeItem is BookmarkedProjectsRootElement {
  return treeItem.contextValue === "BookmarkedProjectsRoot";
}

export class ObsServerTreeElement extends vscode.TreeItem {
  public readonly contextValue = "ObsServer";
  public readonly iconPath = "media/api.svg";

  constructor(public account: AccountStorage) {
    super(account.accountName, vscode.TreeItemCollapsibleState.Collapsed);
  }
}

function isObsServerTreeElement(
  treeItem: ProjectTreeItem
): treeItem is ObsServerTreeElement {
  return treeItem.contextValue === "ObsServer";
}

export class ProjectTreeElement extends vscode.TreeItem {
  public readonly contextValue = "project";

  public readonly iconPath = "media/Noun_Project_projects_icon_1327109_cc.svg";

  constructor(
    public readonly project: Project,
    public readonly bookmark: boolean,
    public readonly parent?: ObsServerTreeElement
  ) {
    super(
      bookmark ? project.name : "Current project: ".concat(project.name),
      vscode.TreeItemCollapsibleState.Collapsed
    );
  }
}

export function isProjectTreeElement(
  treeItem: ProjectTreeItem
): treeItem is ProjectTreeElement {
  return (treeItem as ProjectTreeElement).project !== undefined;
}

export class PackageTreeElement extends vscode.TreeItem {
  public readonly command: vscode.Command;

  public readonly contextValue = "package";

  public readonly iconPath = "media/package.svg";

  constructor(
    public readonly pkg: Package,
    public readonly parent: ProjectTreeElement
  ) {
    super(pkg.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.command = {
      arguments: [this],
      command: "obsProject.updatePackage",
      title: "Update this packages contents and data"
    };
  }
}

function isPackageTreeElement(
  treeItem: ProjectTreeItem
): treeItem is PackageTreeElement {
  return treeItem.contextValue === "package";
}

class FileTreeElement extends vscode.TreeItem {
  public readonly command: vscode.Command;

  public readonly contextValue = "packageFile";

  public readonly iconPath = "media/insert_drive_file.svg";

  constructor(
    public readonly pkgFile: PackageFile,
    public readonly parent: PackageTreeElement
  ) {
    super(pkgFile.name, vscode.TreeItemCollapsibleState.None);
    this.command = {
      arguments: [this],
      command: "obsProject.showPackageFileContents",
      title: "Show this files' contents"
    };
  }
}

function isFileTreeElement(
  treeItem: ProjectTreeItem
): treeItem is FileTreeElement {
  return treeItem.contextValue === "packageFile";
}

export type ProjectTreeItem =
  // | ProjectTreeRootElement
  | BookmarkedProjectsRootElement
  | ObsServerTreeElement
  | ProjectTreeElement
  | PackageTreeElement
  | FileTreeElement;

export function getProjectOfTreeItem(
  treeItem: ProjectTreeItem
): Project | undefined {
  // if (isObsServerTreeElement(treeItem)) {
  //   return undefined;
  // }
  if (isProjectTreeElement(treeItem)) {
    return treeItem.project;
  }
  return undefined;
}

export class ProjectTreeProvider extends LoggingBase
  implements
    vscode.TreeDataProvider<ProjectTreeItem>,
    vscode.TextDocumentContentProvider {
  private static packageFileToUri(
    packageFile: PackageFile,
    apiUrl: string
  ): vscode.Uri {
    return vscode.Uri.parse(
      `${UriScheme}:${packageFile.name}?${apiUrl}#${packageFile.projectName}/${packageFile.packageName}`,
      true
    );
  }

  private static uriToPackageFile(uri: vscode.Uri): [string, PackageFile] {
    assert(uri.scheme === UriScheme);

    const name = uri.authority.concat(uri.path);
    const apiUrl = uri.query;
    const pathToFile = uri.fragment.split("/");

    if (pathToFile.length !== 2) {
      throw new Error(`Got an invalid file URI: ${uri}`);
    }

    const [projectName, packageName] = pathToFile;

    return [apiUrl, { name, projectName, packageName }];
  }

  public onDidChangeTreeData: vscode.Event<ProjectTreeItem | undefined>;

  public onDidChange: vscode.Event<vscode.Uri>;

  private activeProject: Project | undefined = undefined;

  private bookmarkedProjects: Map<ApiUrl, Project[]> = new Map<
    ApiUrl,
    Project[]
  >();

  private currentConnections: ApiAccountMapping = {
    defaultApi: undefined,
    mapping: new Map()
  };

  private onDidChangeTreeDataEmitter: vscode.EventEmitter<
    ProjectTreeItem | undefined
  > = new vscode.EventEmitter<ProjectTreeItem | undefined>();

  private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();

  constructor(
    onDidChangeActiveProject: vscode.Event<Project | undefined>,
    onAccountChange: vscode.Event<ApiAccountMapping>,
    private globalState: vscode.Memento,
    logger: Logger,
    private vscodeWindow: VscodeWindow = vscode.window
  ) {
    super(logger);

    this.onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

    // FIXME: remove this as it deletes all bookmarks
    // saveMapToMemento(globalState, projectBookmarkStorageKey, new Map());

    this.bookmarkedProjects = loadMapFromMemento(
      globalState,
      projectBookmarkStorageKey
    );
    this.onDidChange = this.onDidChangeEmitter.event;

    onAccountChange(curCon => {
      this.currentConnections = curCon;
      this.refresh();
    }, this);

    onDidChangeActiveProject(activeProject => {
      this.activeProject = activeProject;
      this.refresh();
    });
  }

  /**
   * Find the project in the list of bookmarked projects belonging to the file
   * with the passed uri. If no file matches, then `undefined` is returned. If
   * the uri is invalid, then an exception is thrown.
   */
  public getProjectFromUri(uri: vscode.Uri): Project | undefined {
    const [apiUrl, { projectName }] = ProjectTreeProvider.uriToPackageFile(uri);
    return this.bookmarkedProjects
      .get(apiUrl)
      ?.find(proj => proj.name === projectName);
  }

  public async provideTextDocumentContent(
    uri: vscode.Uri,
    _token: vscode.CancellationToken
  ): Promise<string> {
    const [
      apiUrl,
      { projectName, packageName, name }
    ] = ProjectTreeProvider.uriToPackageFile(uri);

    const con = this.currentConnections.mapping.get(apiUrl)?.connection;

    if (con === undefined) {
      throw new Error(`No connection present for the account ${apiUrl}`);
    }

    const targetFile = this.bookmarkedProjects
      .get(apiUrl)
      ?.find(proj => proj.name === projectName)
      ?.packages?.find(pkg => pkg.name === packageName)
      ?.files?.find(pkgFile => pkgFile.name === name);

    return (
      targetFile?.contents ??
      fetchFileContents(con, { projectName, packageName, name })
    );
  }

  public async showPackageFileContents(
    element?: ProjectTreeItem
  ): Promise<void> {
    if (element === undefined || !isFileTreeElement(element)) {
      this.logger.error(
        "showPackageFileContents called without an element or one that isn't a FileTreeElement"
      );
      return;
    }

    const uri = ProjectTreeProvider.packageFileToUri(
      element.pkgFile,
      element.parent.parent.project.apiUrl
    );
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: false });
  }

  public async removeBookmark(element?: ProjectTreeItem): Promise<void> {
    // do nothing if the command was somehow invoked on the wrong tree item
    if (element === undefined || !isProjectTreeElement(element)) {
      this.logger.error(
        "removeBookmark was called on a wrong element, expected a ProjectTreeItem, but got %s instead",
        element
      );
      return;
    }

    const apiUrl = element.project.apiUrl;
    const projects = this.bookmarkedProjects.get(apiUrl);
    if (projects === undefined) {
      this.logger.error(
        "No project bookmarks are present for the API %s",
        apiUrl
      );
      return;
    }
    this.bookmarkedProjects.set(
      apiUrl,
      projects.filter(proj => proj.name !== element.project.name)
    );
    await this.saveBookmarkedProjects();
  }

  public refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  public getTreeItem(element: ProjectTreeItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(
    element?: ProjectTreeItem
  ): Promise<ProjectTreeItem[]> {
    // bookmark & current project
    if (element === undefined) {
      const elements: ProjectTreeItem[] = [new BookmarkedProjectsRootElement()];
      if (this.activeProject !== undefined) {
        elements.push(new ProjectTreeElement(this.activeProject, false));
      }
      return elements;
    }

    if (
      isBookmarkedProjectsRootElement(element) &&
      this.currentConnections.mapping.size > 1
    ) {
      return [...this.currentConnections.mapping.entries()].map(
        ([_apiUrl, obsInstance]) =>
          new ObsServerTreeElement(obsInstance.account)
      );
    } else if (
      (isBookmarkedProjectsRootElement(element) &&
        this.currentConnections.mapping.size === 1) ||
      isObsServerTreeElement(element)
    ) {
      const apiUrl =
        this.currentConnections.mapping.size === 1
          ? this.currentConnections.defaultApi!
          : (element as ObsServerTreeElement).account.apiUrl;
      const projects = this.bookmarkedProjects.get(apiUrl);

      return projects === undefined
        ? []
        : projects.map(
            bookmark =>
              new ProjectTreeElement(
                bookmark,
                true,
                isObsServerTreeElement(element) ? element : undefined
              )
          );
    }

    if (isProjectTreeElement(element)) {
      // the ProjectTreeElement contains a Project, but we try to get the one
      // from the bookmarks as it could be more up to date
      // fallback to the one from the ProjectTreeElement otherwise
      const proj =
        this.bookmarkedProjects
          .get(element.project.apiUrl)
          ?.find(
            bookmarkedProj => bookmarkedProj.name === element.project.name
          ) ?? element.project;

      // no packages? => try to fetch them if we have a connection for this API
      // => save the new project in the bookmarks
      // have packages? => don't update a thing and just return the elements
      if (proj.packages === undefined) {
        const con = this.currentConnections.mapping.get(proj.apiUrl)
          ?.connection;

        if (con === undefined) {
          this.logger.error(
            "No connection for the API %s is present",
            proj.apiUrl
          );
          return [];
        }

        // now run the update
        const projWithPackages = await getProject(con, proj.name, true);
        assert(
          projWithPackages.packages !== undefined,
          `fetching the project ${element.project.name} resulted in no packages being fetched`
        );

        // do *not* save the project in the bookmarks if it is not already one!
        // otherwise random projects show up in the user's bookmarks...
        if (element.bookmark) {
          await this.saveProjectInBookmarks(projWithPackages, false);
        }

        return projWithPackages.packages!.map(
          pkg => new PackageTreeElement(pkg, element)
        );
      } else {
        return proj.packages.map(pkg => new PackageTreeElement(pkg, element));
      }
    }

    if (isPackageTreeElement(element)) {
      // extract the package from the bookmarkedProjects as it could be more up
      // to date & fallback to the one from the element
      const apiUrl = element.parent.project.apiUrl;
      const pkg =
        this.bookmarkedProjects
          .get(apiUrl)
          ?.find(proj => proj.name === element.pkg.project)
          ?.packages?.find(
            pkgFromBookmark => pkgFromBookmark.name === element.pkg.name
          ) ?? element.pkg;

      // got files already => just dump them
      if (pkg.files !== undefined) {
        return pkg.files.map(pkgFile => new FileTreeElement(pkgFile, element));
      }

      // got no files? => try to update them
      const con = this.currentConnections.mapping.get(apiUrl)?.connection;
      if (con === undefined) {
        this.logger.error("No connection for the API %s is present", apiUrl);
        return [];
      } else {
        const pkgWithFiles = await fetchPackage(
          con,
          element.parent.project.name,
          element.pkg.name,
          { pkgContents: false, historyFetchType: HistoryFetchType.NoHistory }
        );
        assert(
          pkgWithFiles.files !== undefined,
          "Package must contain files at this point, but the attribute is undefined"
        );
        if (element.parent.bookmark) {
          await this.savePackageInBookmarks(apiUrl, pkgWithFiles, false);
        }

        return pkgWithFiles.files!.map(
          pkgFile => new FileTreeElement(pkgFile, element)
        );
      }
    }

    return [];
  }

  /**
   * Command to update a package from the tree view.
   *
   * @param element
   */
  @logAndReportExceptions(false)
  public async updatePackage(element?: ProjectTreeItem): Promise<void> {
    if (element === undefined || !isPackageTreeElement(element)) {
      throw new Error(
        "Called updatePackage on an invalid element: ".concat(
          element?.contextValue ?? ""
        )
      );
    }
    const apiUrl = element.parent.project.apiUrl;
    const con = this.currentConnections.mapping.get(apiUrl)?.connection;
    if (con === undefined) {
      throw new Error(
        `Cannot refresh package ${element.pkg.name}, no Connection for it exists`
      );
    }

    const pkg = await fetchPackage(
      con,
      element.parent.project.name,
      element.pkg.name,
      { pkgContents: false }
    );
    let matchingPackage = this.bookmarkedProjects
      .get(apiUrl)
      ?.find(proj => proj.name === element.parent.project.name)
      ?.packages?.find(projPkg => projPkg.name === element.pkg.name);

    if (matchingPackage !== undefined) {
      matchingPackage = pkg;
      this.refresh();
    }
  }

  @logAndReportExceptions()
  public async refreshProject(element?: ProjectTreeItem): Promise<void> {
    if (element === undefined || !isProjectTreeElement(element)) {
      this.logger.error(
        "Called refreshProject on an invalid element: %s",
        element
      );
      return;
    }

    const instanceInfo = this.currentConnections.mapping.get(
      element.project.apiUrl
    );
    if (instanceInfo === undefined || instanceInfo.connection === undefined) {
      const errMsg = `Cannot update the project ${element.project.name}, the corresponding account is not configured properly`;
      throw new Error(errMsg);
    }

    try {
      const updated = await getProject(
        instanceInfo.connection,
        element.project.name
      );
      this.activeProject = updated;
      // await updateCheckedOutProject(this.activeProject, );
      this.refresh();
    } catch (err) {
      const errMsg = `Could not fetch the project ${element.project.name} from ${element.project.apiUrl}`;
      throw new Error(errMsg);
    }
  }

  public async addProjectToBookmarksTreeButton(
    serverOrBookmark?: ObsServerTreeElement | BookmarkedProjectsRootElement
  ): Promise<void> {
    if (serverOrBookmark === undefined) {
      this.logger.debug(
        "addProjectToBookmarksTreeButton invoked without a parameter for serverOrBookmark"
      );
      return;
    }

    if (isBookmarkedProjectsRootElement(serverOrBookmark)) {
      assert(
        this.currentConnections.mapping.size === 1,
        `addProjectToBookmarksTreeButton was invoked on a BookmarkedProjectsRootElement, but the number of stored accounts is not 1, but got ${this.currentConnections.mapping.size} instead`
      );
      assert(
        this.currentConnections.defaultApi !== undefined,
        "Only one account is stored, but it is not the default"
      );
    }

    const projectName = await this.vscodeWindow.showInputBox({
      prompt: "Provide the name of the project that you want to add",
      validateInput: projName => {
        return /\s/.test(projName)
          ? "The project name must not contain any whitespace"
          : undefined;
      }
    });

    if (projectName === undefined) {
      this.logger.trace(
        "addProjectToBookmarksTreeButton invoked, but no project name was provided"
      );
      return;
    }

    const apiUrl = isBookmarkedProjectsRootElement(serverOrBookmark)
      ? this.currentConnections.defaultApi!
      : serverOrBookmark.account.apiUrl;
    const obsInstance = this.currentConnections.mapping.get(apiUrl);
    if (obsInstance === undefined) {
      this.logger.error("obsInstance is undefined for the account %s", apiUrl);
      return;
    }
    if (obsInstance.connection === undefined) {
      const errMsg = `The account for the buildservice instance ${apiUrl} is not configured properly: no password is specified`;
      throw new Error(errMsg);
    }

    let proj: Project | undefined;
    try {
      proj = await getProject(obsInstance.connection, projectName, true);
    } catch (err) {
      const selected = await this.vscodeWindow.showErrorMessage(
        `Adding a bookmark for the project ${projectName} using the account ${obsInstance.account.accountName} failed with: ${err}.`,
        "Add anyway",
        "Cancel"
      );
      if (selected === undefined || selected === "Cancel") {
        return;
      }
      assert(selected === "Add anyway");
    }

    const bookmark: Project = { apiUrl, name: projectName };

    if (proj !== undefined) {
      assert(proj.packages !== undefined);
      const addAll = await this.vscodeWindow.showInformationMessage(
        `This project has ${proj.packages?.length} packages, add them all?`,
        "Yes",
        "No"
      );
      if (addAll === undefined) {
        return;
      }
      if (addAll === "No") {
        const pkgs = await this.vscodeWindow.showQuickPick(
          proj.packages!.map(pkg => pkg.name),
          { canPickMany: true, placeHolder: "Select packages to be bookmarked" }
        );
        if (pkgs === undefined) {
          return;
        }
        bookmark.packages = pkgs.map(pkgName => ({
          name: pkgName,
          project: projectName
        }));
      }
    }

    const currentBookmarks = this.bookmarkedProjects.get(apiUrl) ?? [];
    currentBookmarks.push(bookmark);
    this.bookmarkedProjects.set(apiUrl, currentBookmarks);
    await this.saveBookmarkedProjects();
  }

  private async saveBookmarkedProjects(
    refreshView: boolean = true
  ): Promise<void> {
    await saveMapToMemento(
      this.globalState,
      projectBookmarkStorageKey,
      this.bookmarkedProjects
    );

    if (refreshView) {
      this.refresh();
    }
  }

  /**
   * Put or update the given project in the list of bookmarked projects.
   *
   * If the project is not yet present, then it is added. If it is present, then
   * the existing entry is overwritten.
   * The updated bookmarks are always saved in the [[globalState]] Memento.
   *
   * @param refreshView  Whether to run [[refresh]] once the bookmarks were
   *     updated.
   */
  private async saveProjectInBookmarks(
    proj: Project,
    refreshView: boolean = true
  ): Promise<void> {
    let allProjects = this.bookmarkedProjects.get(proj.apiUrl) ?? [];
    const matchingProjectIndex = allProjects.findIndex(
      bookmarkedProj => bookmarkedProj.name === proj.name
    );
    if (matchingProjectIndex === -1) {
      allProjects = allProjects.concat([proj]);
    } else {
      allProjects[matchingProjectIndex] = proj;
    }
    this.bookmarkedProjects.set(proj.apiUrl, allProjects);
    await this.saveBookmarkedProjects(refreshView);
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
  private async savePackageInBookmarks(
    apiUrl: string,
    pkg: Package,
    refreshView: boolean = true
  ): Promise<void> {
    const allProjects = this.bookmarkedProjects.get(apiUrl) ?? [];
    const matchingProjIndex = allProjects.findIndex(
      proj => proj.name === pkg.project
    );
    if (matchingProjIndex === -1) {
      throw new Error(
        `Cannot find project ${pkg.project} from the API ${apiUrl} in the bookmarked projects`
      );
    }
    assert(
      allProjects[matchingProjIndex].packages !== undefined,
      `package list of the project ${pkg.project} must not be undefined`
    );
    let pkgsOfProj = allProjects[matchingProjIndex].packages!;
    const matchingPkgIndex = pkgsOfProj.findIndex(
      savedPkg => savedPkg.name === pkg.name
    );

    if (matchingProjIndex === -1) {
      pkgsOfProj = pkgsOfProj.concat([pkg]);
    } else {
      pkgsOfProj[matchingPkgIndex] = pkg;
    }

    allProjects[matchingProjIndex].packages = pkgsOfProj;

    this.bookmarkedProjects.set(apiUrl, allProjects);

    await this.saveBookmarkedProjects(refreshView);
  }

  /*  private async addProjectToBookmarks(
    projectName: string,
    account: AccountStorage,
    packages?: string[]
  ): Promise<void> {
    // whoops, we haven't seen this account yet...
    if (!this.bookmarkedProjects.has(account.apiUrl)) {
      this.bookmarkedProjects.set(account.apiUrl, []);
    }
    const curAccountBookmarks = this.bookmarkedProjects.get(account.apiUrl);
    assert(
      curAccountBookmarks !== undefined,
      "There must be at least an empty array entry for the bookmarks of this project"
    );

    // Project has already been added
    if (
      curAccountBookmarks!.find(
        bookmark => projectName === bookmark.projectName
      ) !== undefined
    ) {
      return;
    }

    // Try to fetch the project, if we get an error, don't add it (unless the
    // user really wants it...)
    try {
      await getProject(
        this.currentConnections.mapping.get(account.apiUrl)![1]!,
        projectName
      );
    } catch (err) {}
    curAccountBookmarks!.push(projectName);
    this.bookmarkedProjects.set(account.apiUrl, curAccountBookmarks!);

    await this.saveBookmarkedProjects();

    this.refresh();
  } */

  /*private getProjectTreeElements(
    account: AccountStorage
  ): Thenable<ProjectTreeElement[]> {
    const projects = this.bookmarkedProjects.get(account.apiUrl);

    return projects === undefined
      ? Promise.resolve([])
      : Promise.all(
          projects.map(
            async proj =>
              new ProjectTreeElement(
                // FIXME: handle failures
                await getProject(
                  // FIXME: handle failure
                  this.currentConnections.mapping.get(account.apiUrl)![1]!,
                  proj
                ),
                account
              )
          )
        );
  }*/
}
