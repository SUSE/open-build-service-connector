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

import {
  checkOutPackage,
  checkOutProject,
  ConnectionState,
  Package,
  Project
} from "open-build-service-api";
import { join } from "path";
import { Logger } from "pino";
import * as vscode from "vscode";
import {
  AccountManager,
  ApiUrl,
  connectionStateToMessage,
  promptUserForAccount,
  ValidAccount
} from "./accounts";
import { assert } from "./assert";
import {
  BasePackage,
  BaseProject,
  ConnectionListenerLoggerBase
} from "./base-components";
import {
  BookmarkState,
  isPackageBookmark,
  isProjectBookmark,
  PackageBookmark,
  packageBookmarkFromPackage,
  ProjectBookmark,
  ProjectBookmarkImpl
} from "./bookmarks";
import { cmdPrefix } from "./constants";
import { logAndReportExceptions } from "./decorators";
import {
  DEFAULT_OBS_FETCHERS,
  ObsFetchers,
  VscodeWindow
} from "./dependency-injection";
import { ObsServerInformation } from "./instance-info";
import {
  OBS_PACKAGE_FILE_URI_SCHEME,
  RemotePackageFileContentProvider,
  SHOW_REMOTE_PACKAGE_FILE_CONTENTS_COMMAND
} from "./package-file-contents";
import {
  ChangedObject,
  ChangeType,
  ProjectBookmarkManager,
  RefreshBehavior
} from "./project-bookmarks";
import {
  FileTreeElement,
  isFileTreeElement,
  isProjectTreeElement,
  isProjectTreeItem
} from "./project-view";
import {
  dropUndefined,
  isUri,
  logException,
  makeThemedIconPath,
  promptUserForPackage,
  promptUserForProjectName
} from "./util";

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

/** ID of the command to check a package out to the file system. */
export const CHECK_OUT_PACKAGE_COMMAND = `${cmdPrefix}.${cmdId}.checkOutPackage`;

/** ID of the command to check a project out to the file system. */
export const CHECK_OUT_PROJECT_COMMAND = `${cmdPrefix}.${cmdId}.checkOutProject`;

/** ID of the command to branch and checkout a package */
export const BRANCH_AND_BOOKMARK_AND_CHECKOUT_PACKAGE_COMMAND = `${cmdPrefix}.${cmdId}.branchAndBookmarkAndCheckoutPackage`;

export const SUBMIT_PACKAGE_COMMAND = `${cmdPrefix}.${cmdId}.submitPackage`;

type BookmarkTreeItem =
  | BookmarkedProjectTreeElement
  | BookmarkedPackageTreeElement
  | FileTreeElement
  | ObsServerTreeElement
  | MyBookmarksElement
  | AddBookmarkElement;

export class BookmarkedProjectTreeElement extends vscode.TreeItem {
  public readonly project: ProjectBookmark;

  constructor(project: ProjectBookmark) {
    super(
      project.name,
      project.state === BookmarkState.Ok
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );
    const { name, apiUrl, state } = project;
    this.project = new ProjectBookmarkImpl({ name, apiUrl }, project.state);
    this.contextValue = "project";
    this.iconPath =
      state === BookmarkState.Ok ? BOOKMARK_ICON : BROKEN_BOOKMARK_ICON;
  }
}

export function isBookmarkedProjectTreeElement(
  elem: vscode.TreeItem
): elem is BookmarkedProjectTreeElement {
  return (
    (elem as any).project !== undefined &&
    isProjectBookmark((elem as any).project)
  );
}

export class BookmarkedPackageTreeElement extends vscode.TreeItem {
  public readonly parentProject: BaseProject;

  public readonly contextValue = "package";

  public readonly iconPath:
    | vscode.ThemeIcon
    | { readonly dark: string; readonly light: string } = new vscode.ThemeIcon(
    "package"
  );

  constructor(public readonly pkg: PackageBookmark) {
    super(pkg.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.parentProject = new BaseProject(pkg.apiUrl, pkg.projectName);
    if (pkg.state !== BookmarkState.Ok) {
      this.iconPath = BROKEN_BOOKMARK_ICON;
    }
  }
}

function isBookmarkedPackageTreeElement(
  elem: vscode.TreeItem
): elem is BookmarkedPackageTreeElement {
  return (
    (elem as any).pkg !== undefined && isPackageBookmark((elem as any).pkg)
  );
}

/**
 * An element in the package tree that symbolizes a OBS instance.
 *
 * It uses the `server` codicon as its default icon if the server is healthy. If
 * the server is broken, then the `endpoints_disconnected` icon from the EOS
 * icons is used and the reason is displayed as the tooltip.
 */
export class ObsServerTreeElement extends vscode.TreeItem {
  constructor(public readonly account: ValidAccount) {
    super(
      account.account.accountName,
      account.state === ConnectionState.Ok
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None
    );
    if (account.state === ConnectionState.Ok) {
      this.iconPath = new vscode.ThemeIcon("server");
      this.contextValue = "ObsServer";
      this.tooltip = account.account.accountName;
    } else {
      this.iconPath = makeThemedIconPath("endpoints_disconnected.svg", false);
      this.tooltip = connectionStateToMessage(
        account.state,
        account.account.apiUrl
      );
      this.contextValue = "BrokenObsServer";
    }
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

    assert(this.label !== undefined);
    this.command = {
      arguments: [this],
      command: BOOKMARK_PROJECT_COMMAND,
      title: typeof this.label === "string" ? this.label : this.label.label
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

const BOOKMARK_ICON = new vscode.ThemeIcon("bookmark");

const BROKEN_BOOKMARK_ICON = makeThemedIconPath("broken_image.svg", false);

function getChildrenOfBookmaredProjectTreeItem(
  rootProject: ProjectBookmark,
  element?:
    | BookmarkedProjectTreeElement
    | BookmarkedPackageTreeElement
    | FileTreeElement
): BookmarkTreeItem[] {
  // root element
  if (element === undefined) {
    return [new BookmarkedProjectTreeElement(rootProject)];
  }

  if (isBookmarkedProjectTreeElement(element)) {
    return (
      rootProject.packages?.map(
        (pkg) => new BookmarkedPackageTreeElement(pkg)
      ) ?? []
    );
  }

  if (isBookmarkedPackageTreeElement(element)) {
    return (
      rootProject.packages
        ?.find((pkg) => pkg.name === element.pkg.name)
        ?.files?.map((f) => new FileTreeElement(element.pkg.apiUrl, f)) ?? []
    );
  }

  assert(
    false,
    `This code must be unreachable, but reached it via a ${element.contextValue} Element`
  );
}

export class CheckOutHandler extends ConnectionListenerLoggerBase {
  constructor(
    accountManager: AccountManager,
    logger: Logger,
    private readonly vscodeWindow: VscodeWindow = vscode.window
  ) {
    super(accountManager, logger);

    this.disposables.push(
      vscode.commands.registerCommand(
        CHECK_OUT_PROJECT_COMMAND,
        this.checkOutProject,
        this
      ),
      vscode.commands.registerCommand(
        CHECK_OUT_PACKAGE_COMMAND,
        this.checkOutPackage,
        this
      )
    );
  }

  private async checkOutProject(elem?: BookmarkTreeItem): Promise<void> {
    let apiUrl: string;
    let projectName: string;
    if (elem !== undefined && !isProjectTreeElement(elem)) {
      this.logger.trace(
        "checkOutProject called on the wrong element, expected a project but got: %s",
        elem.contextValue
      );
      return;
    }
    if (elem === undefined) {
      const apiUrlCandidate = await promptUserForAccount(
        this.activeAccounts,
        "Which account should be used to check out the project?",
        this.vscodeWindow
      );
      if (apiUrlCandidate === undefined) {
        return;
      }
      apiUrl = apiUrlCandidate;

      const projectNameCandidate = await promptUserForProjectName(
        apiUrl,
        "Provide the name of the project that should be checked out.",
        this.vscodeWindow
      );
      if (projectNameCandidate === undefined) {
        return;
      }
      projectName = projectNameCandidate;
    } else {
      assert(isProjectTreeElement(elem));
      apiUrl = elem.project.apiUrl;
      projectName = elem.project.name;
    }

    const dest = await this.vscodeWindow.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false
    });
    if (dest === undefined || dest.length > 1) {
      this.logger.error(
        "User either did not select a destination or somehow selected multiple folders"
      );
      return;
    }

    const con = this.activeAccounts.getConfig(apiUrl)?.connection;
    if (con === undefined) {
      this.logger.error(
        "Could not get a connection for the api %s although the user selected it previously",
        apiUrl
      );
      return;
    }

    await this.vscodeWindow.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Checking out ${projectName} to ${dest[0].fsPath}`,
        cancellable: true
      },
      async (progress, cancellationToken) => {
        let finishedPkgs = 0;
        await checkOutProject(con, projectName, dest[0].fsPath, {
          callback: (pkgName, _index, allPackages) => {
            finishedPkgs++;
            progress.report({
              message: `Checked out package ${pkgName}`,
              increment: Math.floor((100 * finishedPkgs) / allPackages.length)
            });
          },
          cancellationToken
        });
      }
    );

    const openProj = await this.vscodeWindow.showInformationMessage(
      "Open the checked out project now?",
      "Yes",
      "No"
    );

    if (openProj === "Yes") {
      await vscode.commands.executeCommand("vscode.openFolder", dest[0]);
    }
  }

  private async checkOutPackage(
    elemOrEditor?: BookmarkTreeItem | vscode.Uri
  ): Promise<void> {
    let pkg: BasePackage | undefined;

    if (
      isUri(elemOrEditor) &&
      elemOrEditor.scheme === OBS_PACKAGE_FILE_URI_SCHEME
    ) {
      const pkgFileInfo = RemotePackageFileContentProvider.uriToPackageFile(
        elemOrEditor
      );
      pkg = new BasePackage(
        pkgFileInfo.apiUrl,
        pkgFileInfo.pkgFile.projectName,
        pkgFileInfo.pkgFile.packageName
      );
    } else if (
      !isUri(elemOrEditor) &&
      elemOrEditor !== undefined &&
      isBookmarkedPackageTreeElement(elemOrEditor)
    ) {
      pkg = new BasePackage(
        elemOrEditor.parentProject.apiUrl,
        elemOrEditor.parentProject.name,
        elemOrEditor.pkg.name
      );
    } else {
      pkg = await promptUserForPackage(this.activeAccounts, this.vscodeWindow);
    }

    if (pkg === undefined) {
      this.logger.debug(
        "Could not get a package to check out, will do nothing"
      );
      return undefined;
    }

    const pkgToCheckOut = pkg;

    const con = this.activeAccounts.getConfig(pkgToCheckOut.apiUrl)?.connection;
    assert(
      con !== undefined,
      "Connection must not be undefined at this point, as the user previously selected a valid API"
    );

    const dest = await this.vscodeWindow.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Folder to which the package should be checked out"
    });
    if (dest === undefined || dest.length > 1) {
      this.logger.error(
        "User either did not select a destination or somehow selected multiple folders, got the following folders: %o",
        dest
      );
      return;
    }

    await this.vscodeWindow.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Checking out ${pkgToCheckOut.projectName}/${pkgToCheckOut.name} to ${dest[0].fsPath}`,
        cancellable: false
      },
      async () =>
        checkOutPackage(
          con,
          pkgToCheckOut.projectName,
          pkgToCheckOut.name,
          dest[0].fsPath
        )
    );

    const openPkg = await this.vscodeWindow.showInformationMessage(
      "Open the checked out Package now?",
      "Yes",
      "No"
    );

    if (openPkg === "Yes") {
      await vscode.commands.executeCommand("vscode.openFolder", dest[0]);
    }
  }
}

export class BookmarkedProjectsTreeProvider
  extends ConnectionListenerLoggerBase
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
    private readonly obsFetchers: ObsFetchers = DEFAULT_OBS_FETCHERS
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
      vscode.commands.registerCommand(
        BRANCH_AND_BOOKMARK_AND_CHECKOUT_PACKAGE_COMMAND,
        this.branchAndBookmarkAndCheckoutPackage,
        this
      ),
      vscode.commands.registerCommand(
        SUBMIT_PACKAGE_COMMAND,
        this.submitPackage,
        this
      ),

      bookmarkMngr.onBookmarkUpdate(
        ({ changeType, changedObject, element }) => {
          // FIXME: this does not work reliably
          let _treeItem: BookmarkTreeItem;
          if (changedObject === ChangedObject.Project) {
            assert(
              isProjectBookmark(element),
              `Must receive a Project via the onBookmarkUpdate event when a project is modified, but got something else instead: ${element.toString()}`
            );
            _treeItem = new BookmarkedProjectTreeElement(element);
          } else {
            assert(
              /* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition */
              changedObject === ChangedObject.Package,
              `changeObject must be a package, but got ${changedObject} instead`
            );
            assert(
              isPackageBookmark(element),
              `Must receive a PackageBookmark via the onBookmarkUpdate event when a Package is modified, but got something else instead: ${element.toString()}`
            );
            _treeItem = new BookmarkedPackageTreeElement(element);
          }

          if (changeType === ChangeType.Modify) {
            this.onDidChangeTreeDataEmitter.fire(undefined);
          } else {
            // this.onDidChangeTreeDataEmitter.fire(this.getParent(treeItem));
            this.onDidChangeTreeDataEmitter.fire(undefined);
          }
        },
        this
      ),
      this.onDidChangeTreeDataEmitter,
      this.onAccountChange(() => {
        this.refresh();
      }, this)
    );
  }

  public refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  public getTreeItem(element: BookmarkTreeItem): vscode.TreeItem {
    if (!isProjectTreeItem(element)) {
      return element;
    }
    if (isFileTreeElement(element)) {
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
  ): Promise<BookmarkTreeItem[] | undefined> {
    if (this.activeAccounts.getAllApis().length === 0) {
      return undefined;
    }

    // bookmark & current project
    if (element === undefined) {
      return [new AddBookmarkElement(), new MyBookmarksElement()];
    }
    if (isAddBookmarkElement(element)) {
      return undefined;
    } else if (isMyBookmarksElement(element)) {
      return dropUndefined(
        this.activeAccounts.getAllApis().map((apiUrl) => {
          const acc = this.activeAccounts.getConfig(apiUrl);
          if (acc === undefined) {
            this.logger.error(
              "Tried to get the account of the API '%s' but got undefined",
              apiUrl
            );
            return undefined;
          }
          return new ObsServerTreeElement(acc);
        })
      );
    } else if (isObsServerTreeElement(element)) {
      const apiUrl =
        this.activeAccounts.getAllApis().length === 1
          ? this.activeAccounts.getAllApis()[0]
          : (element as ObsServerTreeElement).account.account.apiUrl;

      const projects = await this.bookmarkMngr.getAllBookmarkedProjects(apiUrl);
      return ([] as BookmarkTreeItem[]).concat(
        ...projects.map((bookmark) =>
          getChildrenOfBookmaredProjectTreeItem(bookmark, undefined)
        )
      );
    }

    assert(
      !isMyBookmarksElement(element) &&
        !isObsServerTreeElement(element) &&
        !isAddBookmarkElement(element),
      `Invalid element: ${
        element.contextValue ?? "no context value"
      }. Must not be a MyBookmarksElement, ObsServerTreeElement or a AddBookmarkElement`
    );

    const projTreeItem:
      | BookmarkedProjectTreeElement
      | BookmarkedPackageTreeElement
      | FileTreeElement = element;

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
        : getChildrenOfBookmaredProjectTreeItem(projFromBookmark, projTreeItem);
    }

    if (isBookmarkedPackageTreeElement(projTreeItem)) {
      const apiUrl = projTreeItem.parentProject.apiUrl;
      const pkg = await logException(
        this.logger,
        () =>
          this.bookmarkMngr.getBookmarkedPackage(
            apiUrl,
            projTreeItem.parentProject.name,
            projTreeItem.pkg.name,
            RefreshBehavior.FetchWhenMissing
          ),
        `Retrieving the bookmarked package ${projTreeItem.pkg.name}`
      );
      return pkg === undefined
        ? []
        : pkg.files?.map((f) => new FileTreeElement(apiUrl, f)) ?? [];
    }

    assert(false, "This code must be unreachable");
  }

  // FIXME: re-enable this
  /* public getParent(element: BookmarkTreeItem): BookmarkTreeItem | undefined {
    if (isProjectTreeItem(element)) {
      if (isPackageTreeElement(element)) {
        return new ProjectTreeElement(element.parentProject);
      }
      if (isFileTreeElement(element)) {
        // this.bookmarkMngr.getBookmarkedProject
        return new BookmarkedPackageTreeElement({
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
        return new ObsServerTreeElement(accStorage);
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
    }*/

  @logAndReportExceptions()
  public async submitPackage(element?: BookmarkTreeItem): Promise<void> {
    if (element === undefined || !isBookmarkedPackageTreeElement(element)) {
      this.logger.error(
        "branchAndBookmarkPackage called on the wrong element: %s",
        element?.contextValue
      );
      return;
    }
    const apiUrl = element.pkg.apiUrl;
    const con = this.activeAccounts.getConfig(apiUrl)?.connection;
    if (con === undefined) {
      throw new Error(
        `cannot branch package ${element.pkg.projectName}/${element.pkg.name}: no account is configured`
      );
    }

    const pkg = await this.bookmarkMngr.getBookmarkedPackage(
      apiUrl,
      element.pkg.projectName,
      element.pkg.name
    );
    if (pkg === undefined) {
      this.logger.error(
        "Could not retrieve package %s/%s, cannot submit it.",
        element.pkg.projectName,
        element.pkg.name
      );
      return;
    }

    let target = {
      projectName: pkg.sourceLink?.project,
      packageName: pkg.sourceLink?.package ?? pkg.name
    };

    if (target.projectName === undefined) {
      target.projectName = await promptUserForProjectName(
        apiUrl,
        `Target project for the submission of ${pkg.projectName}/${pkg.name}`,
        this.vscodeWindow
      );
    }
    if (target.projectName === undefined) {
      this.logger.debug("User did not enter a target project");
      return;
    }

    const req = await this.obsFetchers.submitPackage(
      con,
      element.pkg,
      // Typescript is being extra dense here: just passing `target` does not
      // work, but destructuring works…
      {
        projectName: target.projectName,
        packageName: target.packageName
      }
    );
    const webUiUrl = (await ObsServerInformation.getInstanceInfoCommand(apiUrl))
      ?.webUiUrl;

    await this.vscodeWindow.showInformationMessage(
      "Created request ".concat(
        webUiUrl === undefined
          ? req.id.toString()
          : `[${req.id}](${webUiUrl.href}request/show/${req.id})`
      )
    );
  }

  @logAndReportExceptions()
  public async branchAndBookmarkAndCheckoutPackage(
    element?: BookmarkTreeItem
  ): Promise<void> {
    if (element === undefined || !isBookmarkedPackageTreeElement(element)) {
      this.logger.error(
        "branchAndBookmarkPackage called on the wrong element: %s",
        element?.contextValue
      );
      return;
    }
    const con = this.activeAccounts.getConfig(element.pkg.apiUrl)?.connection;
    if (con === undefined) {
      throw new Error(
        `cannot branch package ${element.pkg.projectName}/${element.pkg.name}: no account is configured`
      );
    }

    let branchedPkg: Package | undefined;
    await this.vscodeWindow.withProgress(
      {
        cancellable: false,
        location: vscode.ProgressLocation.Notification,
        title: `Branching package ${element.pkg.projectName}/${element.pkg.name}`
      },
      async (progress) => {
        branchedPkg = await this.obsFetchers.branchPackage(con, element.pkg);
        progress.report({ message: "Branched" });
        await this.bookmarkMngr.addPackageToBookmarks(branchedPkg);
      }
    );
    assert(branchedPkg !== undefined);
    await vscode.commands.executeCommand(
      CHECK_OUT_PACKAGE_COMMAND,
      new BookmarkedPackageTreeElement(packageBookmarkFromPackage(branchedPkg))
    );
  }

  /**
   * Command to update a package from the tree view.
   *
   * @param element
   */
  @logAndReportExceptions()
  public async updatePackage(element?: BookmarkTreeItem): Promise<void> {
    if (element === undefined || !isBookmarkedPackageTreeElement(element)) {
      this.logger.error(
        "updatePackage called on undefined or on a wrong element: %s",
        element?.contextValue
      );
      return;
    }

    await this.bookmarkMngr.getBookmarkedPackage(
      element.parentProject.apiUrl,
      element.parentProject.name,
      element.pkg.name,
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
      await this.vscodeWindow.showErrorMessage(
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
      proj = await this.obsFetchers.fetchProject(
        accountConfig.connection,
        projectName,
        {
          fetchPackageList: true
        }
      );
    } catch (e) {
      const err = e as Error;
      this.logger.trace(
        "Tried fetching %s from %s, but got %s, prompting the user whether to add anyway",
        projectName,
        apiUrl,
        err.toString()
      );
      const selected = await this.vscodeWindow.showErrorMessage(
        `Adding a bookmark for the project ${projectName} using the account ${
          accountConfig.account.accountName
        } failed with: ${err.toString()}.`,
        "Add anyway",
        "Cancel"
      );
      if (selected === undefined || selected === "Cancel") {
        return;
      }
      assert(selected === "Add anyway");
    }

    const {
      apiUrl: _ignore,
      name: _ignore2,
      state: _ignore3,
      ...restOfBookmark
    } =
      (await this.bookmarkMngr.getBookmarkedProject(
        apiUrl,
        projectName,
        RefreshBehavior.Never
      )) ?? {};

    const bookmark: ProjectBookmark = {
      apiUrl,
      name: projectName,
      state: proj !== undefined ? BookmarkState.Ok : BookmarkState.RemoteGone,
      ...restOfBookmark
    };

    if (proj !== undefined) {
      assert(
        proj.packages !== undefined && proj.apiUrl === apiUrl,
        `received Project is invalid: packages are undefined (${
          proj.packages === undefined
            ? "packages are undefined"
            : "packages are not undefined"
        }) or the apiUrl does not match the provided value (${
          proj.apiUrl
        } vs ${apiUrl})`
      );

      const pkgs = await this.vscodeWindow.showQuickPick(
        proj.packages.map((pkg) => pkg.name),
        {
          canPickMany: true,
          placeHolder: "Select packages to be bookmarked"
        }
      );
      if (pkgs === undefined) {
        return;
      }

      bookmark.packages = pkgs
        .map((pkgName) => ({
          apiUrl,
          name: pkgName,
          projectName,
          state: BookmarkState.Ok
        }))
        .concat(bookmark.packages ?? []);
    }

    await this.bookmarkMngr.addProjectToBookmarks(bookmark);
    // FIXME: this should fire with the ObsServerTreeElement or the MyBookmarksElement
    // NOTE: this must not fire with the ProjectTreeElement, as that one doesn't
    // exist yet and thus will result in nothing happening
    // this.onDidChangeTreeDataEmitter.fire(undefined);
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

    await this.bookmarkMngr.removeProjectFromBookmarks(element.project);
    this.refresh();
  }
}
