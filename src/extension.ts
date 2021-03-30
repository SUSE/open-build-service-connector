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

import * as vscode from "vscode";
import { AccountManagerImpl } from "./accounts";
import { ErrorPageDocumentProvider } from "./assert";
import { BookmarkedProjectsTreeProvider } from "./bookmark-tree-view";
import { BuildLogDisplay, BuildStatusDisplay } from "./build-control";
import { CheckOutHandler } from "./check-out-handler";
import { CurrentPackageWatcherImpl } from "./current-package-watcher";
import { CurrentProjectTreeProvider } from "./current-project-view";
import { EmptyDocumentForDiffProvider } from "./empty-file-provider";
import { ObsServerInformation } from "./instance-info";
import { setupLogger } from "./logging";
import { OscBuildTaskProvider } from "./osc-build-task";
import { RemotePackageFileContentProvider } from "./package-file-contents";
import { ProjectBookmarkManager } from "./project-bookmarks";
import { RepositoryTreeProvider } from "./repository";
import { PackageScmHistoryTree } from "./scm-history";
import { PackageScm } from "./vcs";

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  const showCollapseAll = true;

  const logger = setupLogger(context, {
    debugMode: process.env.EXTENSION_DEBUG === "1"
  });

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
    new ErrorPageDocumentProvider(logger),
    new BuildStatusDisplay(accountManager, logger),
    new BuildLogDisplay(accountManager, logger)
  );
  if (oscBuildTaskProvider !== undefined) {
    context.subscriptions.push(oscBuildTaskProvider);
  }

  await accountManager.promptForNotPresentAccountPasswords();
}

export function deactivate(): void {
  // NOP
}
