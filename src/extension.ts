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
import { ActivePackageWatcher } from "./active-package-watcher";
import {
  BookmarkedProjectsTreeProvider,
  CheckOutHandler
} from "./bookmark-tree-view";
import { CurrentProjectTreeProvider } from "./current-project-view";
import { EmptyDocumentForDiffProvider } from "./empty-file-provider";
import { ObsServerInformation } from "./instance-info";
import { RemotePackageFileContentProvider } from "./package-file-contents";
import { ProjectBookmarkManager } from "./project-bookmarks";
import { RepositoryTreeProvider } from "./repository";
import { PackageScmHistoryTree } from "./scm-history";
import { PackageScm } from "./vcs";
import { ActiveProjectWatcherImpl } from "./workspace";

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  const showCollapseAll = true;

  const logFile = join(
    context.logPath,
    `vscode-obs.${new Date().getTime()}.log`
  );

  let options: pino.LoggerOptions;
  if (process.env.EXTENSION_DEBUG === "1") {
    options = {
      level: "trace",
      prettyPrint: true,
      prettifier: require("pino-pretty")
    };
    console.log(logFile);
  } else {
    options = {
      level: vscode.workspace
        .getConfiguration("vscode-obs")
        .get<pino.Level>("logLevel", "error")
    };
  }
  await fsPromises.mkdir(context.logPath, { recursive: true });
  const logger = pino(options, pino.destination(logFile));

  const accountManager = await AccountManagerImpl.createAccountManager(logger);

  const [
    projectBookmarks,
    actProjWatcher,
    activePackageWatcher
  ] = await Promise.all([
    ProjectBookmarkManager.createProjectBookmarkManager(
      context,
      accountManager,
      logger
    ),
    ActiveProjectWatcherImpl.createActiveProjectWatcher(accountManager, logger),
    ActivePackageWatcher.createActivePackageWatcher(accountManager, logger)
  ]);

  const bookmarkedProjectsTreeProvider = new BookmarkedProjectsTreeProvider(
    accountManager,
    projectBookmarks,
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
    actProjWatcher,
    accountManager,
    logger
  );
  const currentProjectTree = vscode.window.createTreeView(
    "currentProjectTree",
    { showCollapseAll, treeDataProvider: currentProjectTreeProvider }
  );

  const repoTreeProvider = new RepositoryTreeProvider(
    actProjWatcher,
    accountManager,
    logger
  );
  const repositoryTree = vscode.window.createTreeView("repositoryTree", {
    showCollapseAll,
    treeDataProvider: repoTreeProvider
  });
  const packageScmHistoryTreeProvider = await PackageScmHistoryTree.createPackageScmHistoryTree(
    activePackageWatcher,
    accountManager,
    logger
  );
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
    new PackageScm(activePackageWatcher, accountManager, logger),
    packageScmHistoryTree,
    new ObsServerInformation(accountManager, logger),
    new EmptyDocumentForDiffProvider(),
    new CheckOutHandler(accountManager, logger)
  );

  await accountManager.promptForUninmportedAccountsInOscrc();
  await accountManager.promptForNotPresentAccountPasswords();
}

export function deactivate() {
  // NOP
}
