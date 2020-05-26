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
  fetchProject,
  fetchProjectMeta,
  Project,
  readInCheckedOutProject,
  updateCheckedOutProject
} from "open-build-service-api";
import { dirname, normalize, resolve } from "path";
import { Logger } from "pino";
import * as vscode from "vscode";
import { AccountManager } from "./accounts";
import { ConnectionListenerLoggerBase } from "./base-components";
import { cmdPrefix } from "./constants";
import {
  isLocalProjectTreeElement,
  LocalProjectTreeElement,
  LOCAL_PROJECT_TREE_ELEMENT_CTX_VAL
} from "./current-project-view";
import { logAndReportExceptions } from "./decorators";
import {
  OBS_PACKAGE_FILE_URI_SCHEME,
  RemotePackageFileContentProvider
} from "./package-file-contents";
import { GET_BOOKMARKED_PROJECT_COMMAND } from "./project-bookmarks";
import { ProjectTreeItem } from "./project-view";

export const UPDATE_CHECKEDOUT_PROJECT_CMD = `${cmdPrefix}.obsProject.updateCheckedOutProject`;

/** Currently active project of the current text editor window. */
export interface ActiveProject {
  /**
   * The Project belonging to the currently opened file.
   * `undefined` if the file does not belong to a Project.
   */
  readonly activeProject: Project | undefined;

  /**
   * additional properties of the [[activeProject]].
   *
   * This field must be present when [[activeProject]] is not undefined.
   */
  properties?: {
    /** True if [[activeProject]] is bookmarked. */
    readonly isBookmark: boolean;

    /** True if [[activeProject]] is checked out. */
    readonly isCheckedOut: boolean;

    /**
     * If this project is checked out, then the path to its root folder is saved
     * in this variable.
     */
    readonly checkedOutPath: string | undefined;
  };
}

function workspacesEqual(
  ws1: vscode.WorkspaceFolder,
  ws2: vscode.WorkspaceFolder
): boolean {
  return (
    ws1.name === ws2.name && ws1.uri === ws2.uri && ws1.index === ws2.index
  );
}

export interface ActiveProjectWatcher extends vscode.Disposable {
  readonly onDidChangeActiveProject: vscode.Event<ActiveProject>;

  getActiveProject(): ActiveProject;
}

export class ActiveProjectWatcherImpl extends ConnectionListenerLoggerBase
  implements ActiveProjectWatcher {
  public static async createActiveProjectWatcher(
    accountManager: AccountManager,
    logger: Logger
  ): Promise<ActiveProjectWatcher> {
    const actProjWatcher = new ActiveProjectWatcherImpl(accountManager, logger);

    await actProjWatcher.adjustWorkspaceFolders(
      vscode.workspace.workspaceFolders ?? [],
      []
    );

    // we need to call this **after** the initial mapping has been setup,
    // otherwise this won't do a thing
    await actProjWatcher.sendOnDidChangeActiveProjectEvent(
      vscode.window.activeTextEditor
    );

    return actProjWatcher;
  }

  /**
   * Event that fires when the "active" [[Project]] changes.
   */
  public readonly onDidChangeActiveProject: vscode.Event<ActiveProject>;

  private activeProject: ActiveProject = {
    activeProject: undefined
  };

  private onDidChangeActiveProjectEmitter: vscode.EventEmitter<
    ActiveProject
  > = new vscode.EventEmitter<ActiveProject>();

  private readonly dotOscFsWatcher = vscode.workspace.createFileSystemWatcher(
    "**/.{osc,.osc_obs_ts}/*"
  );

  /**
   * Internal mapping between the currently open workspaces and the associated
   * projects.
   */
  private workspaceProjectMapping: Map<
    vscode.WorkspaceFolder,
    Project
  > = new Map();

  private constructor(accountManager: AccountManager, logger: Logger) {
    super(accountManager, logger);

    this.onDidChangeActiveProject = this.onDidChangeActiveProjectEmitter.event;

    this.disposables.push(
      this.dotOscFsWatcher,
      this.dotOscFsWatcher.onDidChange(this.onDotOscModification, this),
      this.dotOscFsWatcher.onDidCreate(this.onDotOscModification, this),
      this.dotOscFsWatcher.onDidDelete(this.onDotOscModification, this),
      this.onDidChangeActiveProjectEmitter,
      vscode.workspace.onDidChangeWorkspaceFolders(
        async (folderChangeEvent) =>
          this.adjustWorkspaceFolders(
            folderChangeEvent.added,
            folderChangeEvent.removed
          ),
        this
      ),
      vscode.window.onDidChangeActiveTextEditor(
        async (textEditor) =>
          this.sendOnDidChangeActiveProjectEvent(textEditor),
        this
      ),
      vscode.commands.registerCommand(
        UPDATE_CHECKEDOUT_PROJECT_CMD,
        this.updateCheckedOutProjectCommand,
        this
      )
    );
  }

  public getActiveProject(): ActiveProject {
    return this.activeProject;
  }

  @logAndReportExceptions(true)
  private async updateCheckedOutProjectCommand(
    element?: ProjectTreeItem | LocalProjectTreeElement
  ): Promise<void> {
    if (element === undefined || !isLocalProjectTreeElement(element)) {
      this.logger.error(
        "command %s called with a wrong element, expected a %s but got a %s",
        UPDATE_CHECKEDOUT_PROJECT_CMD,
        LOCAL_PROJECT_TREE_ELEMENT_CTX_VAL,
        element?.contextValue
      );
      return;
    }

    const proj = element.project;
    const acc = this.activeAccounts.getConfig(proj.apiUrl);
    if (acc === undefined) {
      throw new Error(`No account configured for the API ${proj.apiUrl}`);
    }

    const newProj = await fetchProject(acc.connection, proj.name, true);
    await updateCheckedOutProject(newProj, element.checkedOutPath);

    const projUri = vscode.Uri.file(element.checkedOutPath);
    const projWsFolder = vscode.workspace.getWorkspaceFolder(projUri);
    if (projWsFolder === undefined) {
      return;
    }

    if (
      this.activeProject.activeProject !== undefined &&
      this.activeProject.properties !== undefined &&
      this.activeProject.properties.isCheckedOut &&
      normalize(this.activeProject.properties.checkedOutPath ?? "") ===
        normalize(element.checkedOutPath)
    ) {
      this.activeProject = {
        activeProject: newProj,
        ...this.activeProject.properties
      };
    }
  }

  private async getActiveProjectForTextdocument(
    textDocument: vscode.TextDocument | undefined
  ): Promise<ActiveProject> {
    if (textDocument === undefined) {
      return { activeProject: undefined };
    }

    let activeProject: Project | undefined;
    let isBookmark: boolean = false;
    let isCheckedOut: boolean = false;
    let checkedOutPath: string | undefined;

    // this is a "virtual" textdocument, that was opened via the
    // RemotePackageFileContentProvider
    // => either it is a bookmark or it is just a random file that the user
    // wanted to view.
    if (textDocument.uri.scheme === OBS_PACKAGE_FILE_URI_SCHEME) {
      try {
        const {
          apiUrl,
          pkgFile
        } = RemotePackageFileContentProvider.uriToPackageFile(textDocument.uri);
        activeProject = await vscode.commands.executeCommand<
          Project | undefined
        >(GET_BOOKMARKED_PROJECT_COMMAND, apiUrl, pkgFile.projectName);

        if (activeProject !== undefined) {
          // this is just a bookmark => we're done
          isBookmark = true;
        } else {
          // apparently this is not a bookmark, try to fetch the project instead
          const con = this.activeAccounts.getConfig(apiUrl)?.connection;
          if (con === undefined) {
            // we have managed to open a file belonging to a Package for which we
            // don't have a connection??
            this.logger.error(
              "No connection exists for the API %s, which is required to retrieve the project for the file %s",
              apiUrl,
              textDocument.uri
            );
          } else {
            activeProject = await fetchProject(con, pkgFile.projectName, false);
          }
        }
      } catch (err) {
        this.logger.error(
          "Got the following error while trying to obtain the Project for the file %s: %s",
          textDocument.uri,
          err.toString()
        );
        // something went wrong, we'll therefore reset activeProject to
        // undefined to not send invalid data
        activeProject = undefined;
      }
    } else {
      // simple case: this is an actual file inside a workspace folder
      let wsFolder = vscode.workspace.getWorkspaceFolder(textDocument.uri);
      if (wsFolder !== undefined) {
        activeProject = this.workspaceProjectMapping.get(wsFolder);
      }
      // if we now still don't have an activeProject then either we haven't
      // opened this workspace yet or the active text editor belongs to a
      // workspace that hasn't been properly registered yet (can happen if you
      // just open a text document and don't open it permanently)
      if (activeProject === undefined) {
        wsFolder = {
          index: 0,
          name: "tmp",
          uri: vscode.Uri.file(resolve(dirname(textDocument.uri.fsPath), ".."))
        };
        activeProject = await this.getProjectFromWorkspace(wsFolder);
      }
      if (activeProject !== undefined) {
        assert(
          wsFolder !== undefined,
          "wsFolder must be defined in this branch"
        );
        isCheckedOut = true;
        checkedOutPath = wsFolder!.uri.fsPath;
        // XXX: is this really necessary?
        isBookmark =
          (await vscode.commands.executeCommand<Project | undefined>(
            GET_BOOKMARKED_PROJECT_COMMAND,
            activeProject.apiUrl,
            activeProject.name
          )) !== undefined;
      }
    }

    return activeProject === undefined
      ? { activeProject: undefined }
      : {
          activeProject,
          properties: { isBookmark, isCheckedOut, checkedOutPath }
        };
  }

  private async onDotOscModification(changedUri: vscode.Uri): Promise<void> {
    const wsFolder = vscode.workspace.getWorkspaceFolder(changedUri);
    if (wsFolder === undefined) {
      return;
    }

    // is this workspaceFolder already tracked?
    // if no => don't proceed as the adjustWorkspaceFolders function should take
    // care of that
    if (
      vscode.workspace.workspaceFolders?.find((presentFolder) =>
        workspacesEqual(presentFolder, wsFolder)
      ) === undefined
    ) {
      return;
    }

    // can we get a project from the folder?
    // yes => try to add it
    // no => remove the workspace from the mapped folders
    const proj = await this.getProjectFromWorkspace(wsFolder);
    if (proj !== undefined) {
      await this.addWorkspace(wsFolder, proj);
    } else {
      this.workspaceProjectMapping.delete(wsFolder);
    }
  }

  private async addWorkspace(
    wsFolder: vscode.WorkspaceFolder,
    proj?: Project
  ): Promise<void> {
    const projOfWs = proj ?? (await this.getProjectFromWorkspace(wsFolder));

    if (projOfWs !== undefined) {
      this.workspaceProjectMapping.set(wsFolder, projOfWs);
    }
  }

  private async adjustWorkspaceFolders(
    addedWorkspaces: ReadonlyArray<vscode.WorkspaceFolder>,
    removedWorkspaces: ReadonlyArray<vscode.WorkspaceFolder>
  ): Promise<void> {
    await Promise.all(addedWorkspaces.map((ws) => this.addWorkspace(ws)));

    removedWorkspaces.forEach((ws) => {
      this.workspaceProjectMapping.delete(ws);
    });
  }

  private async getProjectFromWorkspace(
    workspace: vscode.WorkspaceFolder
  ): Promise<Project | undefined> {
    try {
      const proj = await readInCheckedOutProject(workspace.uri.fsPath);

      // refresh the project _meta in case our local copy is stale
      // but only if we actually have an active connection available
      const activeAccount = this.activeAccounts.getConfig(proj.apiUrl);
      if (activeAccount !== undefined && proj.meta === undefined) {
        this.logger.trace(
          "Fetching the _meta for Project %s via API %s",
          proj.name,
          proj.apiUrl
        );
        proj.meta = await fetchProjectMeta(activeAccount.connection, proj.name);
        await updateCheckedOutProject(proj, workspace.uri.fsPath);
      }

      return proj;
    } catch (err) {
      this.logger.trace(
        "Error reading in directory %s as an osc project, but got: %s",
        workspace.uri.fsPath,
        err.toString()
      );
      return undefined;
    }
  }

  private async sendOnDidChangeActiveProjectEvent(
    textEditor?: vscode.TextEditor
  ) {
    this.activeProject = await this.getActiveProjectForTextdocument(
      textEditor?.document
    );
    this.logger.trace(
      "sending onDidChangeActiveProjectEvent with project: %s",
      this.activeProject.activeProject?.name
    );
    this.onDidChangeActiveProjectEmitter.fire(this.activeProject);
  }
}
