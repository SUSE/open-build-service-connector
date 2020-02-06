import { promises as fsPromises } from "fs";
import { join } from "path";
import * as pino from "pino";
import * as vscode from "vscode";
import { AccountManager } from "./accounts";
import { ProjectTreeProvider, UriScheme } from "./project-view";
import { RepositoryTreeProvider } from "./repository";
import { WorkspaceToProjectMatcher } from "./workspace";

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

  const accountManager = new AccountManager(logger);

  const [
    ws2Proj,
    delayedInit
  ] = WorkspaceToProjectMatcher.createWorkspaceToProjectMatcher(
    accountManager.onConnectionChange,
    logger
  );

  const projectTreeProvider = new ProjectTreeProvider(
    ws2Proj.onDidChangeActiveProject,
    accountManager.onConnectionChange,
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

  await accountManager.initializeMapping();
  await delayedInit(ws2Proj);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "obsAccount.importAccountsFromOsrc",
      accountManager.importAccountsFromOsrc,
      accountManager
    )
  );

  [
    vscode.commands.registerCommand(
      "obsAccount.setAccountPassword",
      accountManager.interactivelySetAccountPassword,
      accountManager
    ),
    vscode.commands.registerCommand(
      "obsAccount.removeAccount",
      accountManager.removeAccountPassword,
      accountManager
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
    ),

    accountManager
  ].forEach(disposable => context.subscriptions.push(disposable));

  await accountManager.promptForUninmportedAccount();
  await accountManager.promptForNotPresentAccountPasswords();
}

// this method is called when your extension is deactivated
export function deactivate() {}
