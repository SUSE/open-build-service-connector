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
import { AccountManager } from "./accounts";
import { ProjectTreeProvider, UriScheme } from "./project-view";
import { RepositoryTreeProvider } from "./repository";
import { WorkspaceToProjectMatcher } from "./workspace";
import { ObsServerInformation } from "./instance-info";

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  const showCollapseAll = true;

  await fsPromises.mkdir(context.logPath, { recursive: true });
  console.log(context.logPath);
  const dest = pino.destination(
    join(context.logPath, `vscode-obs.${new Date().getTime()}.log`)
  );
  const logger = pino(
    {
      // FIXME: stop using trace by default
      level:
        "trace" /*vscode.workspace
        .getConfiguration("vscode-obs")
        .get<pino.Level>("logLevel", "trace")*/
    },
    dest
  );

  const accountManager = await AccountManager.createAccountManager(logger);

  const [
    ws2Proj,
    delayedInit
  ] = WorkspaceToProjectMatcher.createWorkspaceToProjectMatcher(
    accountManager.onConnectionChange,
    logger
  );

  const projectTreeProvider = new ProjectTreeProvider(
    ws2Proj.onDidChangeActiveProject,
    accountManager.onAccountChange,
    accountManager.activeAccounts,
    context.globalState,
    logger
  );

  const projectTree = vscode.window.createTreeView("projectTree", {
    showCollapseAll,
    treeDataProvider: projectTreeProvider
  });

  const repoTreeProvider = new RepositoryTreeProvider(
    ws2Proj.onDidChangeActiveProject,
    accountManager.onConnectionChange,
    logger
  );
  context.subscriptions.push(
    vscode.window.createTreeView("repositoryTree", {
      showCollapseAll,
      treeDataProvider: repoTreeProvider
    })
  );

  await delayedInit(ws2Proj);

  [
    accountManager,
    await ObsServerInformation.createObsServerInformation(
      accountManager.activeAccounts,
      accountManager.onAccountChange,
      logger
    ),
    vscode.commands.registerCommand(
      "obsRepository.addArchitecturesToRepo",
      repoTreeProvider.addArchitecturesToRepo,
      repoTreeProvider
    ),
    vscode.commands.registerCommand(
      "obsRepository.removeArchitectureFromRepo",
      repoTreeProvider.removeArchitectureFromRepo,
      repoTreeProvider
    ),
    vscode.commands.registerCommand(
      "obsRepository.removePathFromRepo",
      repoTreeProvider.removePathFromRepo,
      repoTreeProvider
    ),
    vscode.commands.registerCommand(
      "obsRepository.addPathToRepo",
      repoTreeProvider.addPathToRepo,
      repoTreeProvider
    ),

    vscode.commands.registerCommand(
      "obsProject.refreshProject",
      projectTreeProvider.refreshProject,
      projectTreeProvider
    ),
    vscode.commands.registerCommand(
      "obsProject.addProjectToBookmarks",
      projectTreeProvider.addProjectToBookmarksTreeButton,
      projectTreeProvider
    ),
    vscode.commands.registerCommand(
      "obsProject.updatePackage",
      projectTreeProvider.updatePackage,
      projectTreeProvider
    ),
    vscode.commands.registerCommand(
      "obsProject.removeBookmark",
      projectTreeProvider.removeBookmark,
      projectTreeProvider
    ),
    vscode.commands.registerCommand(
      "obsProject.getProjectFromUri",
      projectTreeProvider.getProjectFromUri,
      projectTreeProvider
    ),
    vscode.workspace.registerTextDocumentContentProvider(
      UriScheme,
      projectTreeProvider
    ),

    vscode.commands.registerCommand(
      "obsRepository.addRepositoryFromDistro",
      repoTreeProvider.addRepositoryFromDistro,
      repoTreeProvider
    ),
    vscode.commands.registerCommand(
      "obsRepository.removeRepository",
      repoTreeProvider.removeRepository,
      repoTreeProvider
    ),
    vscode.commands.registerCommand(
      "obsProject.showPackageFileContents",
      projectTreeProvider.showPackageFileContents,
      projectTreeProvider
    )
  ].forEach(disposable => context.subscriptions.push(disposable));

  await accountManager.promptForUninmportedAccountsInOscrc();
  await accountManager.promptForNotPresentAccountPasswords();
}

// this method is called when your extension is deactivated
export function deactivate() {}
