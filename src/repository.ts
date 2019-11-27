import * as assert from "assert";
import { Arch, BaseRepository, Path, Project } from "obs-ts";
import * as vscode from "vscode";
import { getProjectOfTreeItem, ProjectTreeItem } from "./project";

class RepositoryRootElement extends vscode.TreeItem {
  public contextValue = "repositoryRoot";

  constructor(public repository: Repository) {
    super(repository.name, vscode.TreeItemCollapsibleState.Collapsed);
  }
}

function isRepositoryRootElement(
  treeElement: RepositoryElement
): treeElement is RepositoryRootElement {
  return treeElement.contextValue === "repositoryRoot";
}

class RepositoryPathRootElement extends vscode.TreeItem {
  public contextValue = "pathRoot";

  constructor(public paths: Path[]) {
    super("Paths", vscode.TreeItemCollapsibleState.Collapsed);
  }
}

function isRepositoryPathRootElement(
  treeElement: RepositoryElement
): treeElement is RepositoryPathRootElement {
  return treeElement.contextValue === "pathRoot";
}

class RepositoryPathElement extends vscode.TreeItem {
  public contextValue = "repositoryPath";

  constructor(public path: Path) {
    super(
      `${path.project}/${path.repository}`,
      vscode.TreeItemCollapsibleState.None
    );
  }
}

class RepositoryArchRootElement extends vscode.TreeItem {
  public contextValue = "architectureRoot";

  constructor(public architectures: Arch[]) {
    super("Architectures", vscode.TreeItemCollapsibleState.Collapsed);
  }
}

function isRepositoryArchRootElement(
  treeElement: RepositoryElement
): treeElement is RepositoryArchRootElement {
  return treeElement.contextValue === "architectureRoot";
}

class RepositoryArchElement extends vscode.TreeItem {
  public contextValue = "architecture";

  constructor(public architecture: Arch) {
    super(architecture, vscode.TreeItemCollapsibleState.None);
  }
}

type RepositoryElement =
  | RepositoryRootElement
  | RepositoryPathRootElement
  | RepositoryPathElement
  | RepositoryArchRootElement
  | RepositoryArchElement;

export class RepositoryTreeProvider
  implements vscode.TreeDataProvider<RepositoryElement> {
  public onDidChangeTreeData: vscode.Event<RepositoryElement | undefined>;

  public project: Project | undefined;

  private onDidChangeTreeDataEmitter: vscode.EventEmitter<
    RepositoryElement | undefined
  > = new vscode.EventEmitter<RepositoryElement | undefined>();

  constructor(
    onProjectSelection: vscode.Event<
      vscode.TreeViewSelectionChangeEvent<ProjectTreeItem>
    >
  ) {
    this.onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
    this.project = undefined;

    onProjectSelection(selectedProj => {
      const items = selectedProj.selection;
      // FIXME: this should really be just one or none at all
      if (items.length === 1) {
        this.project = getProjectOfTreeItem(items[0]);
      }
      this.refresh();
    }, this);
  }

  public refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  public getTreeItem(element: RepositoryElement): vscode.TreeItem {
    return element;
  }

  public getChildren(
    element?: RepositoryElement
  ): Thenable<RepositoryElement[]> {
    if (this.project === undefined) {
      return Promise.resolve([]);
    }

    if (element === undefined) {
      return Promise.resolve(
        this.project.repositories.map(repo => new RepositoryRootElement(repo))
      );
    }

    if (isRepositoryRootElement(element)) {
      return Promise.resolve([
        new RepositoryPathRootElement(element.repository.path),
        new RepositoryArchRootElement(element.repository.arch)
      ]);
    }

    if (isRepositoryPathRootElement(element)) {
      return Promise.resolve(
        element.paths.map(path => new RepositoryPathElement(path))
      );
    }

    if (isRepositoryArchRootElement(element)) {
      return Promise.resolve(
        element.architectures.map(arch => new RepositoryArchElement(arch))
      );
    }
    return Promise.resolve([]);
  }
}
