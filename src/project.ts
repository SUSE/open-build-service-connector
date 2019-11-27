import * as assert from "assert";
import { getProject, Project } from "obs-ts";
import * as vscode from "vscode";
import { AccountStorage, ApiAccountMapping, ApiUrl } from "./accounts";

const projectBookmarkStorageKey: string = "vscodeObs.ProjectTree.Projects";

export class ObsServerTreeElement extends vscode.TreeItem {
  public contextValue = "ObsServer";

  constructor(public account: AccountStorage) {
    super(account.accountName, vscode.TreeItemCollapsibleState.Collapsed);
  }
}

export function isObsServerTreeElement(
  treeItem: ProjectTreeItem
): treeItem is ObsServerTreeElement {
  return treeItem.contextValue === "ObsServer";
}

export class ProjectTreeElement extends vscode.TreeItem {
  public contextValue = "project";

  constructor(
    public readonly project: Project,
    public readonly account: AccountStorage
  ) {
    super(project.name, vscode.TreeItemCollapsibleState.Collapsed);
  }
}

export function isProjectTreeElement(
  treeItem: ProjectTreeItem
): treeItem is ProjectTreeElement {
  return (treeItem as ProjectTreeElement).project !== undefined;
}

class PackageTreeElement extends vscode.TreeItem {}
class FileTreeElement extends vscode.TreeItem {}

export type ProjectTreeItem =
  | ObsServerTreeElement
  | ProjectTreeElement
  | PackageTreeElement
  | FileTreeElement;

export function getProjectOfTreeItem(
  treeItem: ProjectTreeItem
): Project | undefined {
  if (isObsServerTreeElement(treeItem)) {
    return undefined;
  }
  if (isProjectTreeElement(treeItem)) {
    return treeItem.project;
  }
  return undefined;
}

export class ProjectTreeProvider
  implements vscode.TreeDataProvider<ProjectTreeItem> {
  public onDidChangeTreeData: vscode.Event<ProjectTreeItem | undefined>;

  private bookmarkedProjects: Map<ApiUrl, string[]>;

  private currentConnections: ApiAccountMapping;

  private onDidChangeTreeDataEmitter: vscode.EventEmitter<
    ProjectTreeItem | undefined
  > = new vscode.EventEmitter<ProjectTreeItem | undefined>();

  constructor(
    public globalState: vscode.Memento,
    onAccountChange: vscode.Event<ApiAccountMapping>
  ) {
    this.onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
    this.bookmarkedProjects = new Map(
      globalState.get<Array<[ApiUrl, string[]]>>(projectBookmarkStorageKey, [])
    );
    this.currentConnections = {
      defaultApi: undefined,
      mapping: new Map()
    };

    onAccountChange(curCon => {
      this.currentConnections = curCon;
      this.refresh();
    }, this);
  }

  public async removeBookmark(element?: ProjectTreeItem): Promise<void> {
    // do nothing if the command was somehow invoked on the wrong tree item
    if (element === undefined || !isProjectTreeElement(element)) {
      // FIXME: log this
      return;
    }
    const apiUrl = element.account.apiUrl;
    const projects = this.bookmarkedProjects.get(apiUrl);
    if (projects === undefined) {
      // FIXME: log this
      return;
    }
    this.bookmarkedProjects.set(
      apiUrl,
      projects.filter(projName => projName !== element.project.name)
    );
    await this.saveBookmarkedProjects();
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
      if (this.currentConnections.mapping.size === 0) {
        return Promise.resolve([]);
      } else if (this.currentConnections.mapping.size === 1) {
        const accounts = [...this.currentConnections.mapping.values()];
        assert(accounts.length === 1);
        return this.getProjectTreeElements(accounts[0][0]);
      } else {
        const accounts = [...this.currentConnections.mapping.values()];
        return Promise.resolve(
          accounts.map(([acc, _]) => {
            return new ObsServerTreeElement(acc);
          })
        );
      }
    }

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

    if (projectName === undefined) {
      return;
    }
    await this.addProjectToBookmarks(projectName, server.account);
  }

  private async saveBookmarkedProjects(): Promise<void> {
    await this.globalState.update(projectBookmarkStorageKey, [
      ...this.bookmarkedProjects.entries()
    ]);
    this.refresh();
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

    // Project has already been added
    if (
      curAccountBookmarks!.find(projName => projectName === projName) !==
      undefined
    ) {
      return;
    }

    // Try to fetch the project, if we get an error, don't add it (unless the
    // user really wants it...)
    try {
      await getProject(
        this.currentConnections.mapping.get(account.apiUrl)![1]!,
        projectName
      );
    } catch (err) {
      const selected = await vscode.window.showErrorMessage(
        `Adding a bookmark of the project ${projectName} for the account ${account.accountName} failed with: ${err}.`,
        "Add anyway",
        "Cancel"
      );
      if (selected === undefined || selected === "Cancel") {
        return;
      }
      assert(selected === "Add anyway");
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

    return projects === undefined
      ? Promise.resolve([])
      : Promise.all(
          projects.map(
            async proj =>
              new ProjectTreeElement(
                // FIXME: handle failures
                await getProject(
                  // FIXME: handle failure
                  this.currentConnections.mapping.get(account.apiUrl)![1]!,
                  proj
                ),
                account
              )
          )
        );
  }
}
