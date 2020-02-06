"use strict";

import { promises as fsPromises } from "fs";
import { join } from "path";
import * as pino from "pino";
import * as vscode from "vscode";
import { AccountManager } from "./accounts";
import { ProjectTreeProvider, scheme } from "./project-view";
import { RepositoryTreeProvider } from "./repository";

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  const showCollapseAll = true;

  await fsPromises.mkdir(context.logPath, { recursive: true });
  const dest = pino.destination(
    join(context.logPath, `vscode-obs.${new Date().getTime()}.log`)
  );
  const logger = pino(
    {
      level: vscode.workspace
        .getConfiguration("vscode-obs")
        .get<pino.Level>("logLevel", "info")
    },
    dest
  );

  const accountManager = new AccountManager(logger);

  const projectTreeProvider = new ProjectTreeProvider(
    context.globalState,
    accountTreeProvider.onConnectionChange
  );

  await accountTreeProvider.initAccounts();

  const accountTree = vscode.window.createTreeView("accountTree", {
    showCollapseAll,
    treeDataProvider: accountTreeProvider
  });

  const projectTree = vscode.window.createTreeView("projectTree", {
    showCollapseAll,
    treeDataProvider: projectTreeProvider
  });

  const repoTreeProvider = new RepositoryTreeProvider(
    projectTree.onDidChangeSelection
  );
  const repoTree = vscode.window.createTreeView("repositoryTree", {
    showCollapseAll,
    treeDataProvider: repoTreeProvider
  });

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "obsAccount.importAccountsFromOsrc",
      accountManager.importAccountsFromOsrc,
      accountManager
    )
  );

  vscode.commands.registerCommand(
    "obsProject.addProjectToBookmarks",
    projectTreeProvider.addProjectToBookmarksTreeButton,
    projectTreeProvider
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "obsAccount.setAccountPassword",
      accountManager.interactivelySetAccountPassword,
      accountManager
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "obsAccount.removeAccount",
      accountManager.removeAccountPassword,
      accountManager
    )
  );

  vscode.commands.registerCommand(
    "obsProject.removeBookmark",
    projectTreeProvider.removeBookmark,
    projectTreeProvider
  );

  await accountManager.promptForUninmportedAccount();
  await accountManager.promptForNotPresentAccountPasswords();

  context.subscriptions.push(accountManager);
}

// this method is called when your extension is deactivated
export function deactivate() {}
