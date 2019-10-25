import * as vscode from "vscode";
import { Project } from "obs-ts";
import { CurrentConnections, AccountStorage } from "./accounts";
import { assert } from "console";
import { inspect } from "util";

type ApiUrl = string;
const projectBookmarkStorageKey: string = "vscodeObs.ProjectTree.Projects";

class ObsServerTreeElement extends vscode.TreeItem {
  public contextValue = "ObsServer";

  constructor(public account: AccountStorage) {
    super(account.accountName, vscode.TreeItemCollapsibleState.Collapsed);
  }
}

function isObsServerTreeElement(
  treeItem: ProjectTreeItem
): treeItem is ObsServerTreeElement {
  return (
    (treeItem as ObsServerTreeElement).account !== undefined &&
    treeItem.contextValue === "ObsServer"
  );
}

class ProjectTreeElement extends vscode.TreeItem {
  public contextValue = "project";

  constructor(public project: Project.Project) {
    super(project.name, vscode.TreeItemCollapsibleState.Collapsed);
  }
}

function isProjectTreeElement(
  treeItem: ProjectTreeItem
): treeItem is ProjectTreeElement {
  return (treeItem as ProjectTreeElement).project !== undefined;
}

class PackageTreeElement extends vscode.TreeItem {}
class FileTreeElement extends vscode.TreeItem {}

type ProjectTreeItem =
  | ObsServerTreeElement
  | ProjectTreeElement
  | PackageTreeElement
  | FileTreeElement;

export class ProjectTreeProvider
  implements vscode.TreeDataProvider<ProjectTreeItem> {
  public onDidChangeTreeData: vscode.Event<ProjectTreeItem | undefined>;

  private bookmarkedProjects: Map<ApiUrl, string[]>;

  private currentConnections: CurrentConnections;

  private onDidChangeTreeDataEmitter: vscode.EventEmitter<
    ProjectTreeItem | undefined
  > = new vscode.EventEmitter<ProjectTreeItem | undefined>();

  constructor(
    public globalState: vscode.Memento,
    onAccountChange: vscode.Event<CurrentConnections>
  ) {
    this.onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
    this.bookmarkedProjects = new Map(
      globalState.get<Array<[ApiUrl, string[]]>>(projectBookmarkStorageKey, [])
    );
    console.log(this.bookmarkedProjects);
    this.currentConnections = {
      connections: new Map(),
      defaultConnection: undefined
    };

    onAccountChange(curCon => {
      this.currentConnections = curCon;
      this.onDidChangeTreeDataEmitter.fire();
    }, this);
  }

  public refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  public getTreeItem(element: ProjectTreeItem): vscode.TreeItem {
    return element;
  }

  public getChildren(element?: ProjectTreeItem): Thenable<ProjectTreeItem[]> {
    // handle the top level element appropriately
    // - no accounts => nothing to show
    // - 1 account => don't show a server top level entry
    // - >1 accounts => show an entry for each server first
    if (element === undefined) {
      if (this.currentConnections.connections.size === 0) {
        return Promise.resolve([]);
      } else if (this.currentConnections.connections.size === 1) {
        const accounts = [...this.currentConnections.connections.keys()];
        assert(accounts.length === 1);
        return this.getProjectTreeElements(accounts[0]);
      } else {
        const accounts = [...this.currentConnections.connections.keys()];
        return Promise.resolve(
          accounts.map(acc => {
            return new ObsServerTreeElement(acc);
          })
        );
      }
    }

    console.log(inspect(element));
    if (isObsServerTreeElement(element)) {
      return this.getProjectTreeElements(element.account);
    }

    return Promise.resolve([]);
  }

  public async addProjectToBookmarksTreeButton(
    server?: ObsServerTreeElement
  ): Promise<void> {
    if (server === undefined) {
      return;
    }

    const projectName = await vscode.window.showInputBox({
      prompt: "Provide the name of the project that you want to add",
      validateInput: projName => {
        return /\s/.test(projName)
          ? "The project name must not contain any whitespace"
          : undefined;
      }
    });

    console.log(`projectName: ${projectName}`);

    if (projectName === undefined) {
      return;
    }
    await this.addProjectToBookmarks(projectName, server.account);
  }

  private async saveBookmarkedProjects(): Promise<void> {
    console.log([...this.bookmarkedProjects.entries()]);
    await this.globalState.update(projectBookmarkStorageKey, [
      ...this.bookmarkedProjects.entries()
    ]);
  }

  private async addProjectToBookmarks(
    projectName: string,
    account: AccountStorage
  ): Promise<void> {
    // whoops, we haven't seen this account yet...
    if (!this.bookmarkedProjects.has(account.apiUrl)) {
      this.bookmarkedProjects.set(account.apiUrl, []);
    }
    const curAccountBookmarks = this.bookmarkedProjects.get(account.apiUrl);
    assert(curAccountBookmarks !== undefined);

    console.log(curAccountBookmarks);
    // Project has already been added
    if (
      curAccountBookmarks!.find(projName => projectName === projName) !==
      undefined
    ) {
      return;
    }

    curAccountBookmarks!.push(projectName);
    this.bookmarkedProjects.set(account.apiUrl, curAccountBookmarks!);

    await this.saveBookmarkedProjects();

    this.refresh();
  }

  private getProjectTreeElements(
    account: AccountStorage
  ): Thenable<ProjectTreeElement[]> {
    const projects = this.bookmarkedProjects.get(account.apiUrl);
    console.log("projects");
    console.log(inspect(projects));

    return projects === undefined
      ? Promise.resolve([])
      : Promise.all(
          projects.map(
            async proj =>
              new ProjectTreeElement(
                // FIXME: handle failures
                await Project.getProject(
                  // FIXME: handle failure
                  this.currentConnections.connections.get(account)!,
                  proj
                )
              )
          )
        );
  }
}
