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

import * as assert from "assert";
import {
  Arch,
  BaseRepository,
  Connection,
  fetchProjectMeta,
  modifyProjectMeta,
  Path,
  Project,
  updateCheckedOutProject
} from "open-build-service-api";
import { Logger } from "pino";
import * as vscode from "vscode";
import { AccountManager, ValidAccount } from "./accounts";
import { ConnectionListenerLoggerBase } from "./base-components";
import { cmdPrefix } from "./constants";
import { logAndReportExceptions } from "./decorators";
import { GET_INSTANCE_INFO_COMMAND, ObsInstance } from "./instance-info";
import { deepCopyProperties, promptUserForProjectName } from "./util";
import { VscodeWindow } from "./vscode-dep";
import { ActiveProjectWatcher } from "./workspace";

/** All architectures known by OBS in general */
const ALL_ARCHES: Arch[] = Object.keys(Arch) as Arch[];

const cmdId = "obsRepository";

export const REMOVE_ARCH_COMMAND = `${cmdPrefix}.${cmdId}.removeArchitectureFromRepo`;

export const ADD_ARCH_COMMAND = `${cmdPrefix}.${cmdId}.addArchitecturesToRepo`;

export const REMOVE_PATH_COMMAND = `${cmdPrefix}.${cmdId}.removePathFromRepo`;

export const ADD_PATH_COMMAND = `${cmdPrefix}.${cmdId}.addPathToRepo`;

export const ADD_REPOSITORY_COMMAND = `${cmdPrefix}.${cmdId}.addRepositoryFromDistro`;

export const REMOVE_REPOSITORY_COMMAND = `${cmdPrefix}.${cmdId}.removeRepository`;

/**
 * This class represents the root element of the repository tree.
 */
class RepositoryRootTreeElement extends vscode.TreeItem {
  public readonly contextValue = "repositoryRoot";

  public readonly iconPath = new vscode.ThemeIcon("repo");

  constructor(public readonly repository: BaseRepository) {
    super(repository.name, vscode.TreeItemCollapsibleState.Collapsed);
  }
}

function isRepositoryRootElement(
  treeElement: RepositoryElement
): treeElement is RepositoryRootTreeElement {
  return treeElement.contextValue === "repositoryRoot";
}

/** Root element of the paths of a Repository */
class RepositoryPathRootTreeElement extends vscode.TreeItem {
  public readonly contextValue = "pathRoot";

  constructor(public readonly repository: BaseRepository) {
    super(
      "Paths",
      repository.path === undefined || repository.path.length === 0
        ? vscode.TreeItemCollapsibleState.None
        : vscode.TreeItemCollapsibleState.Collapsed
    );
  }
}

function isRepositoryPathRootElement(
  treeElement: RepositoryElement
): treeElement is RepositoryPathRootTreeElement {
  return treeElement.contextValue === "pathRoot";
}

/** An entry in the RepositoryTree representing a path entry. */
class RepositoryPathTreeElement extends vscode.TreeItem {
  public readonly contextValue = "repositoryPath";

  constructor(
    public readonly path: Path,
    public readonly repository: BaseRepository
  ) {
    super(
      `${path.project}/${path.repository}`,
      vscode.TreeItemCollapsibleState.None
    );
  }
}

function isRepositoryPathElement(
  treeElement: RepositoryElement
): treeElement is RepositoryPathTreeElement {
  return treeElement.contextValue === "repositoryPath";
}

/**
 * This element represents the node which children are all architectures of the
 * repository.
 */
class RepositoryArchRootTreeElement extends vscode.TreeItem {
  public readonly contextValue = "architectureRoot";

  constructor(public readonly repository: BaseRepository) {
    super(
      "Architectures",
      repository.arch === undefined || repository.arch.length === 0
        ? vscode.TreeItemCollapsibleState.None
        : vscode.TreeItemCollapsibleState.Collapsed
    );
  }
}

function isRepositoryArchRootElement(
  treeElement: RepositoryElement
): treeElement is RepositoryArchRootTreeElement {
  return treeElement.contextValue === "architectureRoot";
}

/** This class represents a single architecture of a repository */
class RepositoryArchTreeElement extends vscode.TreeItem {
  public readonly contextValue = "architecture";

  constructor(
    public readonly architecture: Arch,
    public readonly repository: BaseRepository
  ) {
    super(architecture, vscode.TreeItemCollapsibleState.None);
  }
}

function isRepositoryArchElement(
  treeElement: RepositoryElement
): treeElement is RepositoryArchTreeElement {
  return treeElement.contextValue === "architecture";
}

type RepositoryElement =
  | RepositoryRootTreeElement
  | RepositoryPathRootTreeElement
  | RepositoryPathTreeElement
  | RepositoryArchRootTreeElement
  | RepositoryArchTreeElement;

export class RepositoryTreeProvider extends ConnectionListenerLoggerBase
  implements vscode.TreeDataProvider<RepositoryElement> {
  public onDidChangeTreeData: vscode.Event<RepositoryElement | undefined>;

  public activeProject: Project | undefined;

  private onDidChangeTreeDataEmitter: vscode.EventEmitter<
    RepositoryElement | undefined
  > = new vscode.EventEmitter<RepositoryElement | undefined>();

  constructor(
    activeProjectWatcher: ActiveProjectWatcher,
    accountManager: AccountManager,
    logger: Logger,
    private readonly vscodeWindow: VscodeWindow = vscode.window
  ) {
    super(accountManager, logger);

    this.onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
    this.activeProject = activeProjectWatcher.getActiveProject().activeProject;

    this.disposables.push(
      this.onDidChangeTreeDataEmitter,
      activeProjectWatcher.onDidChangeActiveProject((activeProj) => {
        this.activeProject = activeProj.activeProject;
        this.logger.debug(
          this.activeProject
            ? `RepositoryTreeProvider was notified of the active project ${this.activeProject.name}`
            : "RepositoryTreeProvider was notified that no project is active"
        );
        this.refresh();
      }, this),
      this.onAccountChange((_apiUrls) => {
        this.refresh();
      }, this),
      vscode.commands.registerCommand(
        ADD_ARCH_COMMAND,
        this.addArchitecturesToRepo,
        this
      ),
      vscode.commands.registerCommand(
        REMOVE_ARCH_COMMAND,
        this.removeArchitectureFromRepo,
        this
      ),
      vscode.commands.registerCommand(
        REMOVE_PATH_COMMAND,
        this.removePathFromRepo,
        this
      ),
      vscode.commands.registerCommand(
        ADD_PATH_COMMAND,
        this.addPathToRepo,
        this
      ),
      vscode.commands.registerCommand(
        ADD_REPOSITORY_COMMAND,
        this.addRepositoryFromDistro,
        this
      ),
      vscode.commands.registerCommand(
        REMOVE_REPOSITORY_COMMAND,
        this.removeRepository,
        this
      ),
    );
  }

  public refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  public getTreeItem(element: RepositoryElement): vscode.TreeItem {
    return element;
  }

  @logAndReportExceptions()
  public async addRepositoryFromDistro(): Promise<void> {
    const account = this.getAccountOfCurrentProject();

    // FIXME: what should we do if we need to fetch the meta?
    if (this.activeProject!.meta === undefined) {
      this.activeProject!.meta = await fetchProjectMeta(
        account.connection,
        this.activeProject!.name
      );
    }
    assert(
      this.activeProject!.meta !== undefined,
      "The project meta must be defined at this point"
    );

    const instanceInfo = await vscode.commands.executeCommand<ObsInstance>(
      GET_INSTANCE_INFO_COMMAND,
      account.account.apiUrl
    );
    if (
      instanceInfo === undefined ||
      instanceInfo.hostedDistributions === undefined ||
      instanceInfo.hostedDistributions.length === 0
    ) {
      throw new Error(
        `Cannot add a repository from a distribution for the OBS instance '${account.account.apiUrl}': no distributions defined`
      );
    }

    const hostedDistros = instanceInfo.hostedDistributions;

    const { repository, ...rest } = this.activeProject!.meta;
    const presentRepos = deepCopyProperties(repository) ?? [];

    const distrosToAddNames = await this.vscodeWindow.showQuickPick(
      hostedDistros
        .filter(
          (distro) =>
            presentRepos.find((repo) => repo.name === distro.repositoryName) ===
            undefined
        )
        .map((distro) => distro.name),
      { canPickMany: true }
    );
    if (distrosToAddNames === undefined || distrosToAddNames.length === 0) {
      return;
    }

    distrosToAddNames.forEach((nameOfDistroToAdd) => {
      const distroInfo = hostedDistros.find(
        (hostedDistro) => hostedDistro.name === nameOfDistroToAdd
      )!;
      presentRepos.push({
        arch: distroInfo.architectures,
        name: distroInfo.repositoryName,
        path: [
          { project: distroInfo.project, repository: distroInfo.repository }
        ]
      });
    });

    const newMeta = { ...rest, repository: presentRepos };
    await modifyProjectMeta(account.connection!, newMeta);
    this.activeProject!.meta = newMeta;

    this.refresh();
  }

  @logAndReportExceptions()
  public async removeRepository(element?: RepositoryElement): Promise<void> {
    if (
      !this.activeProjectHasRepositories() ||
      element === undefined ||
      !isRepositoryRootElement(element)
    ) {
      return;
    }
    const instanceInfo = this.getAccountOfCurrentProject();

    // repository must be defined and have length >= 1
    const { repository, ...rest } = this.activeProject!.meta!;

    // FIXME: need a better comparison here
    const newRepos = repository!.filter((repo) => repo !== element.repository);

    const newMeta = { ...rest, repository: newRepos };
    await modifyProjectMeta(instanceInfo.connection!, newMeta);
    this.activeProject!.meta = newMeta;

    this.refresh();
  }

  @logAndReportExceptions()
  public removeArchitectureFromRepo(
    element?: RepositoryElement
  ): Promise<void> {
    return this.addArchOrPathToRepo("remove", "arch", element);
  }

  @logAndReportExceptions()
  public removePathFromRepo(element?: RepositoryElement): Promise<void> {
    return this.addArchOrPathToRepo("remove", "path", element);
  }

  @logAndReportExceptions()
  public addPathToRepo(element?: RepositoryElement): Promise<void> {
    return this.addArchOrPathToRepo("add", "path", element);
  }

  @logAndReportExceptions()
  public addArchitecturesToRepo(element?: RepositoryElement): Promise<void> {
    return this.addArchOrPathToRepo("add", "arch", element);
  }

  public getChildren(
    element?: RepositoryElement
  ): Thenable<RepositoryElement[]> {
    if (!this.activeProjectHasRepositories()) {
      return Promise.resolve([]);
    }

    // this is ok, the previous if ensures this
    const repos = this.activeProject!.meta!.repository!;

    if (element === undefined) {
      return Promise.resolve(
        repos.map((repo) => new RepositoryRootTreeElement(repo))
      );
    }

    if (isRepositoryRootElement(element)) {
      return Promise.resolve([
        new RepositoryPathRootTreeElement(element.repository),
        new RepositoryArchRootTreeElement(element.repository)
      ]);
    }

    if (isRepositoryPathRootElement(element)) {
      return Promise.resolve(
        element.repository.path?.map(
          (path) => new RepositoryPathTreeElement(path, element.repository)
        ) ?? []
      );
    }

    if (isRepositoryArchRootElement(element)) {
      return Promise.resolve(
        element.repository.arch?.map(
          (arch) => new RepositoryArchTreeElement(arch, element.repository)
        ) ?? []
      );
    }

    assert(false, "This code should be unreachable");
  }

  private async addArchOrPathToRepo(
    action: "add" | "remove",
    property: "arch" | "path",
    element?: RepositoryElement
  ): Promise<void> {
    let projFolder: string | undefined;
    const activeTextEditor = vscode.window.activeTextEditor;
    if (activeTextEditor === undefined) {
      this.logger.debug(
        "No text editor is active, thus cannot get the path to the project and will not update it on disk"
      );
      projFolder = undefined;
    } else {
      projFolder = vscode.workspace.getWorkspaceFolder(
        activeTextEditor.document.uri
      )?.uri.fsPath;
    }

    const typeGuard =
      action === "add"
        ? property === "arch"
          ? isRepositoryArchRootElement
          : isRepositoryPathRootElement
        : property === "arch"
        ? isRepositoryArchElement
        : isRepositoryPathElement;

    if (
      element === undefined ||
      !typeGuard(element) ||
      !this.activeProjectHasRepositories()
    ) {
      this.logger.debug(
        "Not ading an architecture because element is invalid (%s) or the active project has no _meta associated with it (%s)",
        element,
        this.activeProject
      );
      return;
    }

    const activeProj = this.activeProject!;
    const repos = activeProj.meta!.repository!;

    const account = this.activeAccounts.getConfig(activeProj.apiUrl);
    if (account === undefined) {
      const errMsg = "Cannot modify the architectures of this repository: no account is configured for the API URL ".concat(
        activeProj.apiUrl
      );
      this.logger.error(errMsg);
      await vscode.window.showErrorMessage(errMsg);
      return;
    }
    const activeCon: Connection = account.connection;

    const expectedRepoName = element.repository.name;

    const matchingRepoArr = repos.filter(
      (repo) => repo.name === expectedRepoName
    );
    assert(
      matchingRepoArr.length === 1,
      `Expected to get exactly one repository with the name ${expectedRepoName}, but got ${matchingRepoArr.length}`
    );
    const matchingRepoIndex = repos.findIndex(
      (repo) => repo.name === expectedRepoName
    );
    assert(
      matchingRepoIndex !== -1,
      `Must have found the repository with the name ${expectedRepoName}`
    );
    const matchingRepo = deepCopyProperties(repos[matchingRepoIndex]);

    if (action === "remove") {
      if (property === "arch") {
        assert(
          isRepositoryArchElement(element),
          `Element ${element} must be a RepositoryArchElement, but its contextValue is: '${element.contextValue}'`
        );
        matchingRepo.arch = matchingRepo.arch?.filter(
          (arch) => arch !== (element as RepositoryArchTreeElement).architecture
        );
      } else {
        assert(
          isRepositoryPathElement(element),
          `Element ${element} must be a RepositoryPathElement, but its contextValue is: '${element.contextValue}'`
        );
        matchingRepo.path = matchingRepo.path?.filter(
          (path) =>
            path.repository !==
              (element as RepositoryPathTreeElement).path.repository ||
            path.project !== (element as RepositoryPathTreeElement).path.project
        );
      }
    } else {
      if (property === "arch") {
        const possibleArches = new Set(Object.keys(Arch));
        if (matchingRepo.arch !== undefined && matchingRepo.arch.length > 0) {
          matchingRepo.arch.forEach((arch) => possibleArches.delete(arch));
        }

        const archesToAdd = await this.vscodeWindow.showQuickPick(
          [...possibleArches.keys()].map((arch) => arch.toLowerCase()),
          {
            canPickMany: true
          }
        );

        if (archesToAdd === undefined || archesToAdd.length === 0) {
          return;
        }

        matchingRepo.arch =
          matchingRepo.arch === undefined
            ? (archesToAdd as Arch[])
            : matchingRepo.arch.concat(archesToAdd as Arch[]);
      } else {
        const projToAdd = await promptUserForProjectName(
          account.account.apiUrl,
          "Specify a project which repository should be added",
          this.vscodeWindow
        );
        if (projToAdd === undefined) {
          return;
        }

        const projToAddMeta = await fetchProjectMeta(activeCon, projToAdd);
        if (projToAddMeta === undefined) {
          return;
        }

        if (
          projToAddMeta.repository === undefined ||
          projToAddMeta.repository.length === 0
        ) {
          throw new Error(
            `Cannot use project '${projToAdd}': it has no configured repositories`
          );
        }

        const repoToAdd = await this.vscodeWindow.showQuickPick(
          projToAddMeta.repository.map((repo) => repo.name)
        );
        if (repoToAdd === undefined) {
          return;
        }

        if (
          matchingRepo.path!.find(
            (path) =>
              path.project === projToAdd && path.repository === repoToAdd
          ) !== undefined
        ) {
          throw new Error(
            `The repository ${projToAdd}/${repoToAdd} is already present`
          );
        }

        matchingRepo.path!.push({ project: projToAdd, repository: repoToAdd });
      }
    }

    const newMeta = deepCopyProperties(activeProj.meta!);
    newMeta.repository![matchingRepoIndex] = matchingRepo;

    await modifyProjectMeta(account.connection, newMeta);
    this.activeProject!.meta = newMeta;

    if (projFolder !== undefined) {
      await updateCheckedOutProject(this.activeProject!, projFolder);
    }

    this.refresh();
  }

  /**
   * Returns `true` if the active project has one or more repositories defined.
   * If no repositories are defined or no project is active, then `false` is
   * returned instead.
   */
  private activeProjectHasRepositories(): boolean {
    return (
      this.activeProject !== undefined &&
      this.activeProject.meta !== undefined &&
      this.activeProject.meta.repository !== undefined &&
      this.activeProject.meta.repository.length > 0
    );
  }

  private getAccountOfCurrentProject(): ValidAccount {
    if (this.activeProject === undefined) {
      throw new Error("No project is active, cannot add a repository");
    }
    const account = this.activeAccounts.getConfig(this.activeProject.apiUrl);
    if (account === undefined) {
      throw new Error(
        `No account is properly configured to access the API ${this.activeProject.apiUrl}`
      );
    }

    return account;
  }
}
