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
import { fetchProject, Package, Project } from "open-build-service-api";
import { join } from "path";
import { Logger } from "pino";
import * as vscode from "vscode";
import {
  AccountManager,
  AccountStorage,
  ApiUrl,
  promptUserForAccount
} from "./accounts";
import { ConnectionListenerLoggerBase } from "./base-components";
import { cmdPrefix } from "./constants";
import { logAndReportExceptions } from "./decorators";
import { SHOW_REMOTE_PACKAGE_FILE_CONTENTS_COMMAND } from "./package-file-contents";
import {
  ChangedObject,
  ChangeType,
  ProjectBookmarkManager,
  RefreshBehavior
} from "./project-bookmarks";
import {
  FileTreeElement,
  getChildrenOfProjectTreeElement,
  getChildrenOfProjectTreeItem,
  isFileTreeElement,
  isPackageTreeElement,
  isProjectTreeElement,
  isProjectTreeItem,
  PackageTreeElement,
  ProjectTreeElement,
  ProjectTreeItem
} from "./project-view";
import { logException, promptUserForProjectName } from "./util";
import { VscodeWindow } from "./vscode-dep";

const cmdId = "obsProject";

/** ID of the command to bookmark a project */
export const BOOKMARK_PROJECT_COMMAND = `${cmdPrefix}.${cmdId}.bookmarkProject`;

/** ID of the command to remove a project bookmark */
export const REMOVE_BOOKMARK_COMMAND = `${cmdPrefix}.${cmdId}.removeBookmark`;

/** ID of the command to refresh a project */
export const UPDATE_PROJECT_COMMAND = `${cmdPrefix}.${cmdId}.updateProject`;

/**
 * ID of the command to update a Package from a [[PackageTreeElement]].
 *
 * This command takes two parameters:
 * @param element  The [[PackageTreeElement]] which stored package should be
 *     updated. If this parameter is missing or not a [[PackageTreeElement]],
 *     then this command does nothing (it just logs the error).
 * @param forceUpdate  optional boolean flag whether to fetch the package list
 *     even if the package has already fetched files (defaults to true).
 */
export const UPDATE_PACKAGE_COMMAND = `${cmdPrefix}.${cmdId}.updatePackage`;

type BookmarkTreeItem =
  | ProjectTreeItem
  | ObsServerTreeElement
  | MyBookmarksElement
  | AddBookmarkElement;

export class ObsServerTreeElement extends vscode.TreeItem {
  public readonly contextValue = "ObsServer";
  public readonly iconPath = new vscode.ThemeIcon("server");

  constructor(public account: AccountStorage) {
    super(account.accountName, vscode.TreeItemCollapsibleState.Expanded);
  }
}

function isObsServerTreeElement(
  treeItem: BookmarkTreeItem
): treeItem is ObsServerTreeElement {
  return treeItem.contextValue === "ObsServer";
}

export class AddBookmarkElement extends vscode.TreeItem {
  public readonly contextValue = "AddBookmarkElement";

  public readonly iconPath = new vscode.ThemeIcon("add");

  constructor() {
    super("Bookmark a Project", vscode.TreeItemCollapsibleState.None);

    this.command = {
      arguments: [this],
      command: BOOKMARK_PROJECT_COMMAND,
      title: this.label!
    };
  }
}

function isAddBookmarkElement(
  element: BookmarkTreeItem
): element is AddBookmarkElement {
  return element.contextValue === "AddBookmarkElement";
}

/** This class represents the tree element under which all bookmarks are put */
export class MyBookmarksElement extends vscode.TreeItem {
  public readonly contextValue = "MyBookmarksElement";

  constructor() {
    super("My bookmarks", vscode.TreeItemCollapsibleState.Expanded);
  }
}

function isMyBookmarksElement(
  treeItem: BookmarkTreeItem
): treeItem is MyBookmarksElement {
  return treeItem.contextValue === "MyBookmarksElement";
}

const BOOKMARK_ICON = {
  dark: join(__filename, "..", "..", "media", "dark", "bookmark_border.svg"),
  light: join(__filename, "..", "..", "media", "light", "bookmark_border.svg")
};

export class BookmarkedProjectsTreeProvider extends ConnectionListenerLoggerBase
  implements vscode.TreeDataProvider<BookmarkTreeItem> {
  public onDidChangeTreeData: vscode.Event<BookmarkTreeItem | undefined>;

  private onDidChangeTreeDataEmitter: vscode.EventEmitter<
    BookmarkTreeItem | undefined
  > = new vscode.EventEmitter<BookmarkTreeItem | undefined>();

  constructor(
    accountManager: AccountManager,
    private readonly bookmarkMngr: ProjectBookmarkManager,
    logger: Logger,
    private vscodeWindow: VscodeWindow = vscode.window,
    private readonly obsFetchProject: typeof fetchProject = fetchProject
  ) {
    super(accountManager, logger);

    this.onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

    this.disposables.push(
      vscode.commands.registerCommand(
        BOOKMARK_PROJECT_COMMAND,
        this.bookmarkProjectCommand,
        this
      ),
      vscode.commands.registerCommand(
        REMOVE_BOOKMARK_COMMAND,
        this.removeBookmark,
        this
      ),
      vscode.commands.registerCommand(
        UPDATE_PROJECT_COMMAND,
        this.updateProject,
        this
      ),
      vscode.commands.registerCommand(
        UPDATE_PACKAGE_COMMAND,
        this.updatePackage,
        this
      ),

      bookmarkMngr.onBookmarkUpdate(
        ({ changeType, changedObject, element }) => {
          let treeItem: ProjectTreeItem;
          if (changedObject === ChangedObject.Project) {
            assert(
              (element as any).projectName === undefined,
              `Must receive a Project via the onBookmarkUpdate event when a project is modified, but got something else instead: ${element}`
            );
            treeItem = new ProjectTreeElement(element as Project);
          } else {
            assert(
              changedObject === ChangedObject.Package,
              `changeObject must be a package, but got ${changedObject} instead`
            );
            assert((element as any).projectName !== undefined);
            treeItem = new PackageTreeElement(element as Package);
          }

          if (changeType === ChangeType.Modify) {
            this.onDidChangeTreeDataEmitter.fire(treeItem);
          } else {
            this.onDidChangeTreeDataEmitter.fire(this.getParent(treeItem));
          }
        },
        this
      ),
      this.onDidChangeTreeDataEmitter,
      // tslint:disable-next-line: variable-name
      this.onAccountChange((_apiUrls) => {
        this.refresh();
      })
    );
  }

  public refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  public getTreeItem(element: BookmarkTreeItem): vscode.TreeItem {
    if (!isProjectTreeItem(element)) {
      return element;
    }
    if (isProjectTreeElement(element)) {
      element.iconPath = BOOKMARK_ICON;
    } else if (isFileTreeElement(element)) {
      element.command = {
        arguments: [element],
        command: SHOW_REMOTE_PACKAGE_FILE_CONTENTS_COMMAND,
        title: "Show this files' contents"
      };
    }
    // element.command = {
    //   arguments: [element.parentProject, false],
    //   command: UPDATE_AND_GET_BOOKMARKED_PROJECT_COMMAND,
    //   title: "Fetch the packages of this Project"
    // };
    // else if (isPackageTreeElement(element)) {
    //   element.command = {
    //     arguments: [element, false],
    //     command: UPDATE_PACKAGE_COMMAND,
    //     title: "Fetch the files of this Package"
    //   };
    // }
    return element;
  }

  public async getChildren(
    element?: BookmarkTreeItem
  ): Promise<BookmarkTreeItem[]> {
    // bookmark & current project
    if (element === undefined) {
      return [new AddBookmarkElement(), new MyBookmarksElement()];
    }

    // FIXME: what should we do if *no* accounts are configured?
    if (
      isMyBookmarksElement(element) &&
      this.activeAccounts.getAllApis().length > 1
    ) {
      return this.activeAccounts
        .getAllApis()
        .map(
          (apiUrl) =>
            new ObsServerTreeElement(
              this.activeAccounts.getConfig(apiUrl)!.account
            )
        );
    } else if (
      (isMyBookmarksElement(element) &&
        this.activeAccounts.getAllApis().length === 1) ||
      isObsServerTreeElement(element)
    ) {
      const apiUrl =
        this.activeAccounts.getAllApis().length === 1
          ? this.activeAccounts.getAllApis()[0]
          : (element as ObsServerTreeElement).account.apiUrl;

      const projects = await this.bookmarkMngr.getAllBookmarkedProjects(apiUrl);
      return projects === undefined
        ? []
        : ([] as ProjectTreeItem[]).concat(
            ...projects.map((bookmark) =>
              getChildrenOfProjectTreeItem(bookmark, undefined)
            )
          );
    } else if (isMyBookmarksElement(element)) {
      const accountCount = this.activeAccounts.getAllApis().length;
      assert(
        accountCount === 0,
        `Must have no accounts configured, but got ${accountCount}`
      );
      return [];
    }

    assert(
      !isMyBookmarksElement(element) &&
        !isObsServerTreeElement(element) &&
        !isAddBookmarkElement(element),
      `Invalid element: ${element.contextValue}. Must not be a MyBookmarksElement, ObsServerTreeElement or a AddBookmarkElement`
    );

    const projTreeItem: ProjectTreeItem = element as ProjectTreeItem;

    if (isProjectTreeElement(projTreeItem)) {
      const projFromBookmark = await logException(
        this.logger,
        () =>
          this.bookmarkMngr.getBookmarkedProject(
            projTreeItem.project.apiUrl,
            projTreeItem.project.name,
            RefreshBehavior.FetchWhenMissing
          ),
        `Retrieving the bookmarked project ${projTreeItem.project.name}`
      );

      return projFromBookmark === undefined
        ? []
        : getChildrenOfProjectTreeElement(projFromBookmark, projTreeItem);
    }

    if (isPackageTreeElement(projTreeItem)) {
      const apiUrl = projTreeItem.parentProject.apiUrl;
      const pkg = await logException(
        this.logger,
        () =>
          this.bookmarkMngr.getBookmarkedPackage(
            apiUrl,
            projTreeItem.parentProject.name,
            projTreeItem.packageName,
            RefreshBehavior.FetchWhenMissing
          ),
        `Retrieving the bookmarked package ${projTreeItem.packageName}`
      );
      return pkg === undefined
        ? []
        : pkg.files?.map((f) => new FileTreeElement(apiUrl, f)) ?? [];
    }

    assert(false, "This code must be unreachable");
  }

  public getParent(element: BookmarkTreeItem): BookmarkTreeItem | undefined {
    if (isProjectTreeItem(element)) {
      if (isPackageTreeElement(element)) {
        return new ProjectTreeElement(element.parentProject);
      }
      if (isFileTreeElement(element)) {
        return new PackageTreeElement({
          apiUrl: element.parentProject.apiUrl,
          name: element.packageName,
          projectName: element.parentProject.name
        });
      }
      assert(isProjectTreeElement(element));

      if (this.activeAccounts.getAllApis().length > 1) {
        const accStorage = this.activeAccounts.getConfig(element.project.apiUrl)
          ?.account;
        assert(
          accStorage !== undefined,
          `Could not get an account for the API ${element.project.apiUrl}, but it must exist`
        );
        return new ObsServerTreeElement(accStorage!);
      } else {
        return new MyBookmarksElement();
      }
    }

    if (isAddBookmarkElement(element) || isMyBookmarksElement(element)) {
      return undefined;
    }
    if (isObsServerTreeElement(element)) {
      return new MyBookmarksElement();
    }

    assert(false, "This part of the code must be unreachable");
  }

  /**
   * Command to update a package from the tree view.
   *
   * @param element
   */
  @logAndReportExceptions()
  public async updatePackage(element?: BookmarkTreeItem): Promise<void> {
    if (element === undefined || !isPackageTreeElement(element)) {
      this.logger.error(
        "updatePackage called on undefined or on a wrong element: %s",
        element?.contextValue
      );
      return;
    }

    await this.bookmarkMngr.getBookmarkedPackage(
      element.parentProject.apiUrl,
      element.parentProject.name,
      element.packageName,
      RefreshBehavior.Always
    );
    this.onDidChangeTreeDataEmitter.fire(element);
  }

  @logAndReportExceptions()
  public async updateProject(element?: BookmarkTreeItem): Promise<void> {
    if (element === undefined || !isProjectTreeElement(element)) {
      this.logger.error(
        "updateProject called on undefined or on a wrong element: %s",
        element?.contextValue
      );
      return;
    }

    const newProj = await this.bookmarkMngr.getBookmarkedProject(
      element.project.apiUrl,
      element.project.name,
      RefreshBehavior.Always
    );
    if (newProj === undefined) {
      // TODO: not very helpful error message, can we maybe get a failure reason out of that?
      this.vscodeWindow.showErrorMessage(
        `Updating the project ${element.project.name} failed.`
      );
      return;
    }
    this.onDidChangeTreeDataEmitter.fire(element);
  }

  @logAndReportExceptions()
  public async bookmarkProjectCommand(
    addBookmarkElement?: BookmarkTreeItem
  ): Promise<void> {
    let apiUrl: ApiUrl;

    if (this.activeAccounts.getAllApis().length === 0) {
      throw new Error("No accounts are present, cannot add a bookmark");
    }

    // FIXME: if addBookmarkElement is undefined, then this command was invoked
    if (
      addBookmarkElement !== undefined &&
      !isAddBookmarkElement(addBookmarkElement)
    ) {
      this.logger.error(
        "Add bookmark command called on an invalid Element: %s",
        addBookmarkElement.contextValue
      );
      return;
    }

    if (this.activeAccounts.getAllApis().length > 1) {
      const userSuppliedApiUrl = await promptUserForAccount(
        this.activeAccounts,
        "Pick an account for which the bookmark should be added",
        this.vscodeWindow
      );
      if (userSuppliedApiUrl === undefined) {
        return;
      }
      apiUrl = userSuppliedApiUrl;
    } else {
      assert(
        this.activeAccounts.getAllApis().length === 1,
        `Expected to have 1 know account, but got ${
          this.activeAccounts.getAllApis().length
        }`
      );
      apiUrl = this.activeAccounts.getAllApis()[0];
    }
    const accountConfig = this.activeAccounts.getConfig(apiUrl);
    if (accountConfig === undefined) {
      this.logger.error("undefined account for the API %s", apiUrl);
      return;
    }

    const projectName = await promptUserForProjectName(
      apiUrl,
      "Provide the name of the project that you want to add",
      this.vscodeWindow
    );

    if (projectName === undefined) {
      this.logger.trace(
        "addProjectToBookmarksTreeButton invoked, but no project name was provided"
      );
      return;
    }

    let proj: Project | undefined;
    try {
      proj = await this.obsFetchProject(
        accountConfig.connection,
        projectName,
        true
      );
    } catch (err) {
      const selected = await this.vscodeWindow.showErrorMessage(
        `Adding a bookmark for the project ${projectName} using the account ${accountConfig.account.accountName} failed with: ${err}.`,
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
      assert(
        proj.packages !== undefined && proj.apiUrl === apiUrl,
        `received Project is invalid: packages are undefined (${proj.packages}) or the apiUrl does not match the provided value (${proj.apiUrl} vs ${apiUrl})`
      );

      const addAll =
        // FIXME: make this number configurable?
        proj.packages!.length < 10
          ? "Yes"
          : await this.vscodeWindow.showInformationMessage(
              `This project has ${proj.packages?.length} packages, add them all?`,
              "Yes",
              "No"
            );
      if (addAll === undefined) {
        return;
      }
      if (addAll === "No") {
        const pkgs = await this.vscodeWindow.showQuickPick(
          proj.packages!.map((pkg) => pkg.name),
          {
            canPickMany: true,
            placeHolder: "Select packages to be bookmarked"
          }
        );
        if (pkgs === undefined) {
          return;
        }
        bookmark.packages = pkgs.map((pkgName) => ({
          apiUrl,
          name: pkgName,
          projectName
        }));
      } else {
        assert(
          addAll === "Yes",
          `variable addAll must equal 'Yes' but got ${addAll} instead`
        );
        bookmark.packages = proj.packages;
      }
    }

    await this.bookmarkMngr.addProjectToBookmarks(bookmark);
    // FIXME: this should fire with the ObsServerTreeElement or the MyBookmarksElement
    // NOTE: this must not fire with the ProjectTreeElement, as that one doesn't
    // exist yet and thus will result in nothing happening
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  public async removeBookmark(element?: BookmarkTreeItem): Promise<void> {
    // do nothing if the command was somehow invoked on the wrong tree item
    if (
      element === undefined ||
      !isProjectTreeItem(element) ||
      !isProjectTreeElement(element)
    ) {
      this.logger.error(
        "removeBookmark was called on a wrong element, expected a ProjectTreeItem, but got %s instead",
        element
      );
      return;
    }

    const apiUrl = element.project.apiUrl;
    const projects = this.bookmarkMngr.getAllBookmarkedProjects(apiUrl);
    if (projects === undefined) {
      this.logger.error(
        "No project bookmarks are present for the API %s",
        apiUrl
      );
      return;
    }

    await this.bookmarkMngr.removeProjectFromBookmarks(element.project);
    this.refresh();
  }
}
