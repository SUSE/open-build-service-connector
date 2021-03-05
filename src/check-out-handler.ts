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

import { promises as fsPromises } from "fs";
import {
  checkOutPackage,
  checkOutProject,
  pathExists,
  rmRf
} from "open-build-service-api";
import { join } from "path";
import { Logger } from "pino";
import * as vscode from "vscode";
import { AccountManager, promptUserForAccount } from "./accounts";
import { assert } from "./assert";
import { BasePackage, ConnectionListenerLoggerBase } from "./base-components";
import {
  BookmarkTreeItem,
  CHECK_OUT_PACKAGE_COMMAND,
  CHECK_OUT_PROJECT_COMMAND,
  isBookmarkedPackageTreeElement
} from "./bookmark-tree-view";
import { VscodeWindow } from "./dependency-injection";
import {
  OBS_PACKAGE_FILE_URI_SCHEME,
  RemotePackageFileContentProvider
} from "./package-file-contents";
import { isProjectTreeElement } from "./project-view";
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

    const con = this.activeAccounts.getConfig(apiUrl)?.connection;
    if (con === undefined) {
      this.logger.error(
        "Could not get a connection for the api %s although the user selected it previously",
        apiUrl
      );
      return;
    }

    const checkOutPath = await this.createDirectoryForCheckOut(
      projectName,
      projectName,
      "Folder where the project should be checked out"
    );
    if (checkOutPath === undefined) {
      return;
    }

    let cancelled: boolean = false;
    await this.vscodeWindow.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Checking out ${projectName} to ${checkOutPath}`,
        cancellable: true
      },
      async (progress, cancellationToken) => {
        await checkOutProject(con, projectName, checkOutPath, {
          callback: (pkgName, _index, allPackages) => {
            progress.report({
              message: `Checked out package ${pkgName}`,
              increment: 100 / allPackages.length
            });
          },
          cancellationToken
        });
        cancelled = cancellationToken.isCancellationRequested;
      }
    );

    if (cancelled) {
      await rmRf(checkOutPath);
      return;
    }

    const openProj = await this.vscodeWindow.showInformationMessage(
      "Open the checked out project now?",
      "Yes",
      "No"
    );

    if (openProj === "Yes") {
      await vscode.commands.executeCommand(
        "vscode.openFolder",
        vscode.Uri.file(checkOutPath)
      );
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
        checkOutPackage(
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
      await vscode.commands.executeCommand(
        "vscode.openFolder",
        vscode.Uri.file(checkOutPath)
      );
    }
  }
}
