import * as assert from "assert";
import {
  Arch,
  BaseRepository,
  Connection,
  fetchHostedDistributions,
  getProjectMeta,
  modifyProjectMeta,
  Path,
  Project,
  updateCheckedOutProject
} from "obs-ts";
import { Logger } from "pino";
import * as vscode from "vscode";
import { ApiAccountMapping, ObsInstance } from "./accounts";
import { ConnectionListenerLoggerBase } from "./base-components";
import { deepCopyProperties, logAndReportExceptions } from "./util";

/**
 * This class represents the root element of the repository tree.
 */
class RepositoryRootElement extends vscode.TreeItem {
  public readonly contextValue = "repositoryRoot";

  constructor(public readonly repository: BaseRepository) {
    super(repository.name, vscode.TreeItemCollapsibleState.Collapsed);
  }
}

function isRepositoryRootElement(
  treeElement: RepositoryElement
): treeElement is RepositoryRootElement {
  return treeElement.contextValue === "repositoryRoot";
}

class RepositoryPathRootElement extends vscode.TreeItem {
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
): treeElement is RepositoryPathRootElement {
  return treeElement.contextValue === "pathRoot";
}

class RepositoryPathElement extends vscode.TreeItem {
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
): treeElement is RepositoryPathElement {
  return treeElement.contextValue === "repositoryPath";
}

/**
 * This element represents the node which children are all architectures of the
 * repository.
 */
class RepositoryArchRootElement extends vscode.TreeItem {
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
): treeElement is RepositoryArchRootElement {
  return treeElement.contextValue === "architectureRoot";
}

/** This class represents a single architecture of a repository */
class RepositoryArchElement extends vscode.TreeItem {
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
): treeElement is RepositoryArchElement {
  return treeElement.contextValue === "architecture";
}

type RepositoryElement =
  | RepositoryRootElement
  | RepositoryPathRootElement
  | RepositoryPathElement
  | RepositoryArchRootElement
  | RepositoryArchElement;

export class RepositoryTreeProvider extends ConnectionListenerLoggerBase
  implements vscode.TreeDataProvider<RepositoryElement> {
  public onDidChangeTreeData: vscode.Event<RepositoryElement | undefined>;

  public activeProject: Project | undefined;

  private onDidChangeTreeDataEmitter: vscode.EventEmitter<
    RepositoryElement | undefined
  > = new vscode.EventEmitter<RepositoryElement | undefined>();

  constructor(
    onDidChangeActiveProject: vscode.Event<Project | undefined>,
    onConnectionChange: vscode.Event<ApiAccountMapping>,
    logger: Logger,
    private readonly vscodeWindow: {
      showErrorMessage: typeof vscode.window.showErrorMessage;
      showQuickPick: typeof vscode.window.showQuickPick;
      showInputBox: typeof vscode.window.showInputBox;
    } = vscode.window
  ) {
    super(onConnectionChange, logger);

    this.onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
    this.activeProject = undefined;

    onDidChangeActiveProject(activeProj => {
      this.activeProject = activeProj;
      this.logger.debug(
        activeProj
          ? `RepositoryTreeProvider was notified of the active project ${activeProj.name}`
          : "RepositoryTreeProvider was notified that no project is active"
      );
      this.refresh();
    }, this);
  }

  public refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  public getTreeItem(element: RepositoryElement): vscode.TreeItem {
    return element;
  }

  @logAndReportExceptions()
  public async addRepositoryFromDistro(): Promise<void> {
    const instanceInfo = this.getInstanceInfoOfCurrentProject();

    // FIXME: what should we do if we need to fetch the meta?
    if (this.activeProject!.meta === undefined) {
      this.activeProject!.meta = await getProjectMeta(
        instanceInfo.connection!,
        this.activeProject!.name
      );
    }
    assert(
      this.activeProject!.meta !== undefined,
      "The project meta must be defined at this point"
    );

    const hostedDistros =
      instanceInfo.hostedDistributions ??
      (await fetchHostedDistributions(instanceInfo.connection!));

    const { repository, ...rest } = this.activeProject!.meta;
    const presentRepos = deepCopyProperties(repository) ?? [];

    const distrosToAddNames = await this.vscodeWindow.showQuickPick(
      hostedDistros
        .filter(
          distro =>
            presentRepos.find(repo => repo.name === distro.repositoryName) ===
            undefined
        )
        .map(distro => distro.name),
      { canPickMany: true }
    );
    if (distrosToAddNames === undefined || distrosToAddNames.length === 0) {
      return;
    }

    distrosToAddNames.forEach(nameOfDistroToAdd => {
      const distroInfo = hostedDistros.find(
        hostedDistro => hostedDistro.name === nameOfDistroToAdd
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
    await modifyProjectMeta(instanceInfo.connection!, newMeta);
    this.activeProject!.meta = newMeta;

    this.refresh();
  }

  @logAndReportExceptions()
  public async removeRepository(element?: RepositoryElement): Promise<void> {
    if (
      !this.checkRepositoriesPresent() ||
      element === undefined ||
      !isRepositoryRootElement(element)
    ) {
      return;
    }
    const instanceInfo = this.getInstanceInfoOfCurrentProject();

    // repository must be defined and have length >= 1
    const { repository, ...rest } = this.activeProject!.meta!;

    // FIXME: need a better comparison here
    const newRepos = repository!.filter(repo => repo !== element.repository);

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

  // public async addArchitecturesToRepo(
  //   element?: RepositoryElement
  // ): Promise<void> {
  //   if (
  //     element === undefined ||
  //     !isRepositoryArchRootElement(element) ||
  //     !this.checkRepositoriesPresent()
  //   ) {
  //     this.logger.debug(
  //       "Not ading an architecture because element is invalid (%s) or the active project has no _meta associated with it (%s)",
  //       element,
  //       this.activeProject
  //     );
  //     return;
  //   }

  //   const activeProj = this.activeProject!;
  //   const repos = activeProj.meta!.repository!;

  //   const accStorageAndCon = this.currentConnections.mapping.get(
  //     activeProj.apiUrl
  //   );
  //   if (accStorageAndCon === undefined || accStorageAndCon[1] === undefined) {
  //     const errMsg = "Cannot modify the architectures of this repository: no account is configured for the API URL ".concat(
  //       activeProj.apiUrl
  //     );
  //     this.logger.error(errMsg);
  //     await vscode.window.showErrorMessage(errMsg);
  //     return;
  //   }

  //   const expectedRepoName = element.repository.name;

  //   const matchingRepoArr: BaseRepository[] | undefined = repos.filter(
  //     repo => repo.name === expectedRepoName
  //   );
  //   assert(
  //     matchingRepoArr.length === 1,
  //     `Expected to get exactly one repository with the name ${expectedRepoName}, but got ${matchingRepoArr.length}`
  //   );
  //   const matchingRepoIndex = repos.findIndex(
  //     repo => repo.name === expectedRepoName
  //   );
  //   const matchingRepo = deepCopyPropierts(repos[matchingRepoIndex]);

  //   const possibleArches = new Set(Object.keys(Arch));
  //   if (matchingRepo.arch !== undefined && matchingRepo.arch.length > 0) {
  //     matchingRepo.arch.forEach(arch => possibleArches.delete(arch));
  //   }

  //   const archesToAdd = await vscode.window.showQuickPick(
  //     [...possibleArches.keys()],
  //     {
  //       canPickMany: true
  //     }
  //   );

  //   if (archesToAdd === undefined || archesToAdd.length === 0) {
  //     return;
  //   }

  //   if (matchingRepo.arch === undefined) {
  //     matchingRepo.arch = archesToAdd as Arch[];
  //   } else {
  //     matchingRepo.arch.concat(archesToAdd as Arch[]);
  //   }

  //   const newMeta = deepCopyPropierts(activeProj.meta!);
  //   newMeta.repository![matchingRepoIndex] = matchingRepo;

  //   try {
  //     await modifyProjectMeta(accStorageAndCon[1], newMeta);
  //     this.activeProject!.meta = newMeta;
  //   } catch (err) {
  //     const errMsg = `Tried to modify the _meta of the project '${activeProj.name}', but got the error ${err}`;
  //     this.logger.error(errMsg);
  //     await vscode.window.showErrorMessage(errMsg);
  //   }
  // }

  public getChildren(
    element?: RepositoryElement
  ): Thenable<RepositoryElement[]> {
    if (!this.checkRepositoriesPresent()) {
      return Promise.resolve([]);
    }

    // this is ok, the previous if ensures this
    const repos = this.activeProject!.meta!.repository!;

    if (element === undefined) {
      return Promise.resolve(
        repos.map(repo => new RepositoryRootElement(repo))
      );
    }

    if (isRepositoryRootElement(element)) {
      return Promise.resolve([
        new RepositoryPathRootElement(element.repository),
        new RepositoryArchRootElement(element.repository)
      ]);
    }

    if (isRepositoryPathRootElement(element)) {
      return Promise.resolve(
        element.repository.path?.map(
          path => new RepositoryPathElement(path, element.repository)
        ) ?? []
      );
    }

    if (isRepositoryArchRootElement(element)) {
      return Promise.resolve(
        element.repository.arch?.map(
          arch => new RepositoryArchElement(arch, element.repository)
        ) ?? []
      );
    }

    assert(false, "This code should be unreachable");
    return Promise.resolve([]);
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
      !this.checkRepositoriesPresent()
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

    // console.log(inspect(this.currentConnections.mapping, { depth: null }));

    const instanceInfo = this.currentConnections.mapping.get(activeProj.apiUrl);
    if (instanceInfo === undefined || instanceInfo.connection === undefined) {
      const errMsg = "Cannot modify the architectures of this repository: no account is configured for the API URL ".concat(
        activeProj.apiUrl
      );
      this.logger.error(errMsg);
      await vscode.window.showErrorMessage(errMsg);
      return;
    }
    const activeCon: Connection = instanceInfo.connection;

    const expectedRepoName = element.repository.name;

    const matchingRepoArr: BaseRepository[] | undefined = repos.filter(
      repo => repo.name === expectedRepoName
    );
    assert(
      matchingRepoArr.length === 1,
      `Expected to get exactly one repository with the name ${expectedRepoName}, but got ${matchingRepoArr.length}`
    );
    const matchingRepoIndex = repos.findIndex(
      repo => repo.name === expectedRepoName
    );
    const matchingRepo = deepCopyProperties(repos[matchingRepoIndex]);

    if (action === "remove") {
      if (property === "arch") {
        assert(
          isRepositoryArchElement(element),
          `Element ${element} must be a RepositoryArchElement, but its contextValue is: '${element.contextValue}'`
        );
        matchingRepo.arch = matchingRepo.arch?.filter(
          arch => arch !== (element as RepositoryArchElement).architecture
        );
      } else {
        assert(
          isRepositoryPathElement(element),
          `Element ${element} must be a RepositoryPathElement, but its contextValue is: '${element.contextValue}'`
        );
        matchingRepo.path = matchingRepo.path?.filter(
          path =>
            path.repository !==
              (element as RepositoryPathElement).path.repository ||
            path.project !== (element as RepositoryPathElement).path.project
        );
      }
    } else {
      if (property === "arch") {
        const possibleArches = new Set(Object.keys(Arch));
        if (matchingRepo.arch !== undefined && matchingRepo.arch.length > 0) {
          matchingRepo.arch.forEach(arch => possibleArches.delete(arch));
        }

        const archesToAdd = await this.vscodeWindow.showQuickPick(
          [...possibleArches.keys()].map(arch => arch.toLowerCase()),
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
        const projToAdd = await vscode.window.showInputBox({
          prompt: "Specify a project which repository should be added",
          validateInput: path =>
            path === "" ? "Path must not be empty" : undefined
        });
        if (projToAdd === undefined) {
          return;
        }

        const projToAddMeta = await getProjectMeta(activeCon, projToAdd);
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
          projToAddMeta.repository.map(repo => repo.name)
        );
        if (repoToAdd === undefined) {
          return;
        }

        if (
          matchingRepo.path!.find(
            path => path.project === projToAdd && path.repository === repoToAdd
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

    await modifyProjectMeta(instanceInfo.connection, newMeta);
    this.activeProject!.meta = newMeta;

    if (projFolder !== undefined) {
      await updateCheckedOutProject(this.activeProject!, projFolder);
    }

    this.refresh();
  }

  private checkRepositoriesPresent(): boolean {
    return (
      this.activeProject !== undefined &&
      this.activeProject.meta !== undefined &&
      this.activeProject.meta.repository !== undefined &&
      this.activeProject.meta.repository.length > 0
    );
  }

  private getInstanceInfoOfCurrentProject(): ObsInstance {
    if (this.activeProject === undefined) {
      throw new Error("No project is active, cannot add a repository");
    }
    const instanceInfo = this.currentConnections.mapping.get(
      this.activeProject.apiUrl
    );
    if (instanceInfo === undefined || instanceInfo.connection === undefined) {
      throw new Error(
        `No account is properly configured to access the API ${this.activeProject.apiUrl}`
      );
    }

    return instanceInfo;
  }
}
