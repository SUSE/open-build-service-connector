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

import { promises as fsPromises } from "fs";
import { join } from "path";
import * as pino from "pino";
import * as vscode from "vscode";
import { AccountManagerImpl } from "./accounts";
import { ErrorPageDocumentProvider } from "./assert";
import {
  BookmarkedProjectsTreeProvider,
  CheckOutHandler
} from "./bookmark-tree-view";
import { cmdPrefix } from "./constants";
import { CurrentPackageWatcherImpl } from "./current-package-watcher";
import { CurrentProjectTreeProvider } from "./current-project-view";
import { EmptyDocumentForDiffProvider } from "./empty-file-provider";
import { ObsServerInformation } from "./instance-info";
import { OscBuildTaskProvider } from "./osc-build-task";
import { RemotePackageFileContentProvider } from "./package-file-contents";
import { ProjectBookmarkManager } from "./project-bookmarks";
import { RepositoryTreeProvider } from "./repository";
import { PackageScmHistoryTree } from "./scm-history";
import { PackageScm } from "./vcs";

export const GET_LOGFILE_PATH_COMMAND = `${cmdPrefix}.logging.getLogfilePath`;

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  const showCollapseAll = true;

  const logFile = join(
    context.logUri.fsPath,
    `vscode-obs.${new Date().getTime()}.log`
  );

  let options: pino.LoggerOptions;
  if (process.env.EXTENSION_DEBUG === "1") {
    options = {
      level: "trace"
    };
    console.log(logFile);
  } else {
    options = {
      level: vscode.workspace
        .getConfiguration("vscode-obs")
        .get<pino.Level>("logLevel", "error")
    };
  }
  await fsPromises.mkdir(context.logUri.fsPath, { recursive: true });
  const logger = pino(options, pino.destination(logFile));

  const accountManager = await AccountManagerImpl.createAccountManager(logger);

  const projectBookmarkManager = await ProjectBookmarkManager.createProjectBookmarkManager(
    context,
    accountManager,
    logger
  );
  const currentPackageWatcher = await CurrentPackageWatcherImpl.createCurrentPackageWatcher(
    accountManager,
    logger,
    projectBookmarkManager
  );
  const bookmarkedProjectsTreeProvider = new BookmarkedProjectsTreeProvider(
    accountManager,
    projectBookmarkManager,
    logger
  );
  const bookmarkedProjectsTree = vscode.window.createTreeView(
    "bookmarkedProjectsTree",
    {
      showCollapseAll,
      treeDataProvider: bookmarkedProjectsTreeProvider
    }
  );

  const currentProjectTreeProvider = new CurrentProjectTreeProvider(
    currentPackageWatcher,
    accountManager,
    logger
  );
  const currentProjectTree = vscode.window.createTreeView(
    "currentProjectTree",
    { showCollapseAll, treeDataProvider: currentProjectTreeProvider }
  );

  const repoTreeProvider = new RepositoryTreeProvider(
    currentPackageWatcher,
    accountManager,
    logger
  );
  const repositoryTree = vscode.window.createTreeView("repositoryTree", {
    showCollapseAll,
    treeDataProvider: repoTreeProvider
  });
  const [
    packageScmHistoryTreeProvider,
    oscBuildTaskProvider
  ] = await Promise.all([
    PackageScmHistoryTree.createPackageScmHistoryTree(
      currentPackageWatcher,
      accountManager,
      logger
    ),
    OscBuildTaskProvider.createOscBuildTaskProvider(
      currentPackageWatcher,
      accountManager,
      logger
    )
  ]);

  const packageScmHistoryTree = vscode.window.createTreeView(
    "packageScmHistoryTree",
    { showCollapseAll, treeDataProvider: packageScmHistoryTreeProvider }
  );

  const pkgFileProv = new RemotePackageFileContentProvider(
    accountManager,
    logger
  );

  context.subscriptions.push(
    currentProjectTree,
    repositoryTree,
    accountManager,
    bookmarkedProjectsTree,
    pkgFileProv,
    currentPackageWatcher,
    new PackageScm(currentPackageWatcher, accountManager, logger),
    packageScmHistoryTree,
    new ObsServerInformation(accountManager, logger),
    new EmptyDocumentForDiffProvider(),
    new CheckOutHandler(accountManager, logger),
    vscode.commands.registerCommand(GET_LOGFILE_PATH_COMMAND, () => logFile),
    new ErrorPageDocumentProvider(logger)
  );
  if (oscBuildTaskProvider !== undefined) {
    context.subscriptions.push(oscBuildTaskProvider);
  }

  await accountManager.promptForUninmportedAccountsInOscrc();
  await accountManager.promptForNotPresentAccountPasswords();
}

export function deactivate() {
  // NOP
}
