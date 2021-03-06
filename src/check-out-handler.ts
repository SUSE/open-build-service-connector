/**
 * Copyright (c) 2021 SUSE LLC
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

import { IVSCodeExtLogger } from "@vscode-logging/logger";
import { promises as fsPromises } from "fs";
import { pathExists, rmRf } from "open-build-service-api";
import { join } from "path";
import * as vscode from "vscode";
import { AccountManager, promptUserForAccount } from "./accounts";
import { assert } from "./assert";
import { BasePackage, ConnectionListenerLoggerBase } from "./base-components";
import {
  BookmarkTreeItem,
  CHECK_OUT_PACKAGE_COMMAND,
  CHECK_OUT_PROJECT_COMMAND,
  isBookmarkedPackageTreeElement,
  isBookmarkedProjectTreeElement
} from "./bookmark-tree-view";
import {
  DEFAULT_OBS_FETCHERS,
  ObsFetchers,
  VscodeWindow
} from "./dependency-injection";
import {
  OBS_PACKAGE_FILE_URI_SCHEME,
  RemotePackageFileContentProvider
} from "./package-file-contents";
import { isUri, promptUserForPackage, promptUserForProjectName } from "./util";

export class CheckOutHandler extends ConnectionListenerLoggerBase {
  /** Wrapper around the [[CHECK_OUT_PACKAGE_COMMAND]] command. */
  public static async checkOutPackageCommand(
    elemOrEditor?: BookmarkTreeItem | vscode.Uri
  ): Promise<void> {
    await vscode.commands.executeCommand(
      CHECK_OUT_PACKAGE_COMMAND,
      elemOrEditor
    );
  }

  constructor(
    accountManager: AccountManager,
    logger: IVSCodeExtLogger,
    private readonly vscodeWindow: VscodeWindow = vscode.window,
    private readonly obsFetchers: ObsFetchers = DEFAULT_OBS_FETCHERS,
    private readonly executeCommand: typeof vscode.commands.executeCommand = vscode
      .commands.executeCommand
  ) {
    super(accountManager, logger);

    this.disposables.push(
      vscode.commands.registerCommand(
        CHECK_OUT_PROJECT_COMMAND,
        this.checkOutProjectInteractively,
        this
      ),
      vscode.commands.registerCommand(
        CHECK_OUT_PACKAGE_COMMAND,
        this.checkOutPackageInteractively,
        this
      )
    );
  }

  private async createDirectoryForCheckOut(
    dirName: string,
    objectLabel: string,
    openLabel?: string
  ): Promise<string | undefined> {
    const dest = await this.vscodeWindow.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel
    });
    if (dest === undefined || dest.length > 1) {
      this.logger.error(
        "User either did not select a destination or somehow selected multiple folders, got the following folders: %o",
        dest
      );
      return;
    }

    const checkOutPath = join(dest[0].fsPath, dirName);
    if ((await pathExists(checkOutPath)) !== undefined) {
      const msg = `Cannot check out ${objectLabel} to ${dest[0].fsPath}: already contains ${dirName}`;
      this.logger.error(msg);
      await this.vscodeWindow.showErrorMessage(msg);
      return undefined;
    } else {
      await fsPromises.mkdir(checkOutPath);
      return checkOutPath;
    }
  }

  /**
   * Interactive wizard to check out a project to the file system.
   *
   * @return The path where the folder was checked out or `undefined` if the
   *     process got canceled at some point and no checkout got created.
   */
  public async checkOutProjectInteractively(
    elem?: BookmarkTreeItem
  ): Promise<string | undefined> {
    let apiUrl: string;
    let projectName: string;
    if (elem !== undefined && !isBookmarkedProjectTreeElement(elem)) {
      this.logger.trace(
        "checkOutProject called on the wrong element, expected a project but got: %s",
        elem.contextValue
      );
      return undefined;
    }
    if (elem === undefined) {
      const apiUrlCandidate = await promptUserForAccount(
        this.activeAccounts,
        "Which account should be used to check out the project?",
        this.vscodeWindow
      );
      if (apiUrlCandidate === undefined) {
        return undefined;
      }
      apiUrl = apiUrlCandidate;

      const projectNameCandidate = await promptUserForProjectName(
        apiUrl,
        "Provide the name of the project that should be checked out.",
        this.vscodeWindow
      );
      if (projectNameCandidate === undefined) {
        return undefined;
      }
      projectName = projectNameCandidate;
    } else {
      assert(isBookmarkedProjectTreeElement(elem));
      apiUrl = elem.project.apiUrl;
      projectName = elem.project.name;
    }

    const con = this.activeAccounts.getConfig(apiUrl)?.connection;
    if (con === undefined) {
      this.logger.error(
        "Could not get a connection for the api %s although the user selected it previously",
        apiUrl
      );
      return undefined;
    }

    const checkOutPath = await this.createDirectoryForCheckOut(
      projectName,
      projectName,
      "Folder where the project should be checked out"
    );
    if (checkOutPath === undefined) {
      return undefined;
    }

    let cancelled: boolean = false;
    await this.vscodeWindow.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Checking out ${projectName} to ${checkOutPath}`,
        cancellable: true
      },
      async (progress, cancellationToken) => {
        const success = await this.obsFetchers.checkOutProject(
          con,
          projectName,
          checkOutPath,
          {
            callback: (pkgName, _index, allPackages) => {
              progress.report({
                message: `Checked out package ${pkgName}`,
                increment: 100 / allPackages.length
              });
            },
            cancellationToken
          }
        );
        cancelled = !success;
      }
    );

    /* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition */
    if (cancelled) {
      await rmRf(checkOutPath);
      return undefined;
    }

    const openProj = await this.vscodeWindow.showInformationMessage(
      "Open the checked out project now?",
      "Yes",
      "No"
    );

    if (openProj === "Yes") {
      await this.executeCommand(
        "vscode.openFolder",
        vscode.Uri.file(checkOutPath)
      );
    }

    return checkOutPath;
  }

  /**
   * Interactively checks out a package to the file system, prompting the user
   * for the target directory and optionally for the package that should be
   * checked out.
   *
   * @return The path to which the package was checked out on success or
   *     `undefined` if there was a failure or the user did not provide input at
   *     some point and the check out was thus canceled.
   */
  public async checkOutPackageInteractively(
    elemOrEditor?: BookmarkTreeItem | vscode.Uri
  ): Promise<string | undefined> {
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
    if (con === undefined) {
      const msg = `no account configured to download the package ${pkgToCheckOut.projectName}/${pkgToCheckOut.name} from ${pkgToCheckOut.apiUrl}`;
      this.logger.error(msg);
      await this.vscodeWindow.showErrorMessage("You have ".concat(msg));
      return undefined;
    }

    const checkOutPath = await this.createDirectoryForCheckOut(
      pkgToCheckOut.name,
      `${pkgToCheckOut.projectName}/${pkgToCheckOut.name}`,
      "Folder where the package should be checked out"
    );
    if (checkOutPath === undefined) {
      return;
    }

    await this.vscodeWindow.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Checking out ${pkgToCheckOut.projectName}/${pkgToCheckOut.name} to ${checkOutPath}`,
        cancellable: false
      },
      async () =>
        this.obsFetchers.checkOutPackage(
          con,
          pkgToCheckOut.projectName,
          pkgToCheckOut.name,
          checkOutPath
        )
    );

    const openPkg = await this.vscodeWindow.showInformationMessage(
      "Open the checked out Package now?",
      "Yes",
      "No"
    );

    if (openPkg === "Yes") {
      await this.executeCommand(
        "vscode.openFolder",
        vscode.Uri.file(checkOutPath)
      );
    }

    return checkOutPath;
  }
}
