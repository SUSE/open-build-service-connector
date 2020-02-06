import { existsSync } from "fs";
import {
  getProjectMeta,
  Project,
  readInCheckedOutProject,
  updateCheckedOutProject
} from "obs-ts";
import { join } from "path";
import { Logger } from "pino";
import * as vscode from "vscode";
import { ApiAccountMapping } from "./accounts";
import { ConnectionListenerLoggerBase } from "./base-components";
import { UriScheme } from "./project-view";

/** Currently active projects of this workspace. */
export interface WorkspaceProjects {
  /**
   * List of projects present in the currently opened workspace.
   * This array can be empty.
   */
  projectsInWorkspace: Project[];

  /**
   * The Project belonging to the currently opened file.
   * `undefined` if the file does not belong to a Project.
   */
  activeProject: Project | undefined;
}

export class WorkspaceToProjectMatcher extends ConnectionListenerLoggerBase {
  public static createWorkspaceToProjectMatcher(
    onConnectionChange: vscode.Event<ApiAccountMapping>,
    logger: Logger
  ): [
    WorkspaceToProjectMatcher,
    (wsMatcher: WorkspaceToProjectMatcher) => Promise<void>
  ] {
    const wsToProj = new WorkspaceToProjectMatcher(onConnectionChange, logger);

    return [wsToProj, WorkspaceToProjectMatcher.delayedInit];
  }

  private static async delayedInit(
    wsMatcher: WorkspaceToProjectMatcher
  ): Promise<void> {
    await wsMatcher.adjustWorkspaceFolders(
      vscode.workspace.workspaceFolders ?? [],
      []
    );

    // we need to call this **after** the initial mapping has been setup,
    // otherwise this won't do a thing
    wsMatcher.sendOnDidChangeActiveProjectEvent(vscode.window.activeTextEditor);
  }

  private static workspacesEqual(
    ws1: vscode.WorkspaceFolder,
    ws2: vscode.WorkspaceFolder
  ): boolean {
    return (
      ws1.name === ws2.name && ws1.uri === ws2.uri && ws1.index === ws2.index
    );
  }

  /**
   * Event that fires when the "active" [[Project]] changes.
   */
  public readonly onDidChangeActiveProject: vscode.Event<Project | undefined>;

  private currentWorkspaceFolders: vscode.WorkspaceFolder[] = [];

  private onDidChangeActiveProjectEmitter: vscode.EventEmitter<
    Project | undefined
  > = new vscode.EventEmitter<Project | undefined>();

  private workspaceProjectMapping: Map<
    vscode.WorkspaceFolder,
    Project
  > = new Map();

  private constructor(
    onConnectionChange: vscode.Event<ApiAccountMapping>,
    logger: Logger
  ) {
    super(onConnectionChange, logger);
    this.onDidChangeActiveProject = this.onDidChangeActiveProjectEmitter.event;

    vscode.workspace.onDidChangeWorkspaceFolders(
      async folderChangeEvent =>
        this.adjustWorkspaceFolders(
          folderChangeEvent.added,
          folderChangeEvent.removed
        ),
      this
    );

    vscode.window.onDidChangeActiveTextEditor(textEditor => {
      this.sendOnDidChangeActiveProjectEvent(textEditor);
    }, this);
  }

  public async getProjectForTextdocument(
    textDocument: vscode.TextDocument | undefined
  ): Promise<Project | undefined> {
    if (textDocument === undefined) {
      return undefined;
    }

    if (textDocument.uri.scheme === UriScheme) {
      // HACK: we fetch the current project via a command, which is not great...
      // => need to modularize the code more
      const proj = await vscode.commands.executeCommand<Project | undefined>(
        "obsProject.getProjectFromUri",
        textDocument.uri
      );
      return proj;
    }
    const wsFolder = vscode.workspace.getWorkspaceFolder(textDocument.uri);
    if (wsFolder !== undefined) {
      return this.workspaceProjectMapping.get(wsFolder);
    }

    return undefined;
  }

  private async adjustWorkspaceFolders(
    addedWorkspaces: ReadonlyArray<vscode.WorkspaceFolder>,
    removedWorkspaces: ReadonlyArray<vscode.WorkspaceFolder>
  ): Promise<void> {
    await Promise.all(
      addedWorkspaces.map(async ws => {
        this.currentWorkspaceFolders.push(ws);

        const proj = await this.getProjectFromWorkspace(ws);
        if (proj !== undefined) {
          this.workspaceProjectMapping.set(ws, proj);
        }
      })
    );

    removedWorkspaces.forEach(ws => {
      this.workspaceProjectMapping.delete(ws);
    });

    const newWorkspaces: vscode.WorkspaceFolder[] = [];

    this.currentWorkspaceFolders.forEach(ws => {
      if (
        removedWorkspaces.find(removedWs =>
          WorkspaceToProjectMatcher.workspacesEqual(removedWs, ws)
        ) === undefined
      ) {
        newWorkspaces.push(ws);
      }
    });
  }

  private async getProjectFromWorkspace(
    workspace: vscode.WorkspaceFolder
  ): Promise<Project | undefined> {
    if (existsSync(join(workspace.uri.fsPath, ".osc"))) {
      try {
        const proj = await readInCheckedOutProject(workspace.uri.fsPath);

        // refresh the project _meta in case our local copy is stale
        // but only if we actually have an active connection available
        const instanceInfo = this.currentConnections.mapping.get(proj.apiUrl);
        if (
          instanceInfo !== undefined &&
          instanceInfo.connection !== undefined
        ) {
          this.logger.trace(
            "Fetching the _meta for Project %s via API %s",
            proj.name,
            proj.apiUrl
          );
          proj.meta = await getProjectMeta(instanceInfo.connection, proj.name);
          await updateCheckedOutProject(proj, workspace.uri.fsPath);
        }

        return proj;
      } catch (err) {
        this.logger.trace(
          `Error reading in directory ${workspace.uri.fsPath} as an osc project, but got: ${err}`
        );
      }
    }
    return undefined;
  }

  private async sendOnDidChangeActiveProjectEvent(
    textEditor?: vscode.TextEditor
  ) {
    const proj = await this.getProjectForTextdocument(textEditor?.document);
    this.logger.trace(
      `sending onDidChangeActiveProjectEvent with project: ${proj?.name}`
    );
    this.onDidChangeActiveProjectEmitter.fire(
      await this.getProjectForTextdocument(textEditor?.document)
    );
  }
}
