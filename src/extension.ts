"use strict";

import { assert } from "console";
import * as vscode from "vscode";

import { AccountTreeProvider } from "./accounts";
import { ProjectTreeProvider } from "./project";
import { RepositoryTreeProvider } from "./repository";

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  const showCollapseAll = true;

  const accountTreeProvider = new AccountTreeProvider(context.globalState);

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

  vscode.commands.registerCommand(
    "obsAccount.importAccountsFromOsrc",
    accountTreeProvider.importAccountsFromOsrc,
    accountTreeProvider
  );
  vscode.commands.registerCommand(
    "obsAccount.modifyAccountProperty",
    accountTreeProvider.modifyAccountProperty,
    accountTreeProvider
  );
  vscode.commands.registerCommand(
    "obsAccount.removeAccount",
    accountTreeProvider.removeAccount,
    accountTreeProvider
  );

  vscode.commands.registerCommand(
    "obsProject.addProjectToBookmarks",
    projectTreeProvider.addProjectToBookmarksTreeButton,
    projectTreeProvider
  );

  vscode.commands.registerCommand(
    "obsProject.removeBookmark",
    projectTreeProvider.removeBookmark,
    projectTreeProvider
  );

  const unimportedAccountsPresent = await accountTreeProvider.unimportedAccountsPresent();

  if (unimportedAccountsPresent) {
    const importAccounts = "Import accounts now";
    const neverShowAgain = "Never show this message again";
    const selected = await vscode.window.showInformationMessage(
      "There are accounts in your oscrc configuration file, that have not been imported into Visual Studio Code. Would you like to import them?",
      importAccounts,
      neverShowAgain
    );
    if (selected !== undefined) {
      if (selected === importAccounts) {
        await accountTreeProvider.importAccountsFromOsrc();
      } else {
        // TODO: flick a configuration option here
        assert(selected === neverShowAgain);
      }
    }
  }

  //  context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() {}
