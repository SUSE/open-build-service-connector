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
import { promises as fsPromises } from "fs";
import {
  addAndDeleteFilesFromPackage,
  commit,
  FileState,
  ModifiedPackage,
  pathExists,
  PathType
} from "open-build-service-api";
import { basename, dirname, join, sep } from "path";
import { Logger } from "pino";
import * as vscode from "vscode";
import { AccountManager } from "./accounts";
import { ActivePackageWatcher } from "./active-package-watcher";
import { ConnectionListenerLoggerBase } from "./base-components";
import { cmdPrefix, ignoreFocusOut } from "./constants";
import { logAndReportExceptions } from "./decorators";
import { EmptyDocumentForDiffProvider } from "./empty-file-provider";

interface LineChange {
  readonly originalStartLineNumber: number;
  readonly originalEndLineNumber: number;
  readonly modifiedStartLineNumber: number;
  readonly modifiedEndLineNumber: number;
}

const cmdId = "obsScm";

export const REVERT_CHANGE_COMMAND = `${cmdPrefix}.${cmdId}.revertChange`;

export const COMMIT_CHANGES_COMMAND = `${cmdPrefix}.${cmdId}.commitChanges`;

export const ADD_FILE_COMMAND = `${cmdPrefix}.${cmdId}.addFile`;

export const REMOVE_FILE_COMMAND = `${cmdPrefix}.${cmdId}.removeFile`;

export const DISCARD_CHANGES_COMMAND = `${cmdPrefix}.${cmdId}.discardChanges`;

export const SHOW_DIFF_COMMAND = `${cmdPrefix}.${cmdId}.showDiff`;

export const SHOW_DIFF_FROM_URI_COMMAND = `${cmdPrefix}.${cmdId}.showDiffFromUri`;

export const ADD_CHANGELOG_ENTRY_COMMAND = `${cmdPrefix}.${cmdId}.addChangelogEntry`;

/**
 * URI scheme for to get the file contents at HEAD for files under version
 * control.
 */
export const OBS_FILE_AT_HEAD_SCHEME = "vscodeObsFileAtHead";

export function fsPathFromFileAtHeadUri(uri: vscode.Uri): string | undefined {
  return uri.scheme === OBS_FILE_AT_HEAD_SCHEME
    ? uri.with({ scheme: "file" }).fsPath
    : undefined;
}

export const fileAtHeadUri = {
  URI_SCHEME: OBS_FILE_AT_HEAD_SCHEME,
  getFsPath: fsPathFromFileAtHeadUri
};

export class PackageScm extends ConnectionListenerLoggerBase
  implements vscode.QuickDiffProvider, vscode.TextDocumentContentProvider {
  private activePackage: ModifiedPackage | undefined;

  private curScm: vscode.SourceControl | undefined;

  private scmDisposable: vscode.Disposable | undefined;

  constructor(
    private readonly activePackageWatcher: ActivePackageWatcher,
    accountManager: AccountManager,
    logger: Logger
  ) {
    super(accountManager, logger);

    this.disposables.push(
      this.activePackageWatcher.onDidChangeActivePackage(function (
        this: PackageScm,
        _modPkg
      ) {
        this.updateScm();
      },
      this),
      this.activePackageWatcher,
      vscode.commands.registerCommand(
        REVERT_CHANGE_COMMAND,
        this.revertChange,
        this
      ),
      vscode.commands.registerCommand(
        COMMIT_CHANGES_COMMAND,
        this.commitChanges,
        this
      ),
      vscode.commands.registerCommand(SHOW_DIFF_COMMAND, this.showDiff, this),
      vscode.commands.registerCommand(
        SHOW_DIFF_FROM_URI_COMMAND,
        this.showDiffFromUri,
        this
      ),
      vscode.commands.registerCommand(ADD_FILE_COMMAND, this.addFile, this),
      vscode.commands.registerCommand(
        REMOVE_FILE_COMMAND,
        this.removeFile,
        this
      ),
      vscode.commands.registerCommand(
        DISCARD_CHANGES_COMMAND,
        this.discardChanges,
        this
      ),
      vscode.commands.registerCommand(
        ADD_CHANGELOG_ENTRY_COMMAND,
        this.addChangelogEntryMenu,
        this
      ),
      vscode.workspace.registerTextDocumentContentProvider(
        OBS_FILE_AT_HEAD_SCHEME,
        this
      )
    );
    this.updateScm();
  }

  public provideOriginalResource(
    uri: vscode.Uri,
    token: vscode.CancellationToken
  ): vscode.Uri | undefined {
    return token.isCancellationRequested
      ? undefined
      : this.getUriOfOriginalResource(uri);
  }

  public provideTextDocumentContent(
    uri: vscode.Uri,
    token: vscode.CancellationToken
  ): Promise<string | undefined> {
    if (uri.scheme !== OBS_FILE_AT_HEAD_SCHEME) {
      throw new Error(
        `Invalid uri scheme '${uri.scheme}', expected ${OBS_FILE_AT_HEAD_SCHEME}`
      );
    }

    const path = this.getPathOfOriginalResource(uri);
    return token.isCancellationRequested
      ? Promise.resolve(undefined)
      : fsPromises.readFile(path, { encoding: "utf-8" });
  }

  public dispose() {
    this.scmDisposable?.dispose();
    super.dispose();
  }

  @logAndReportExceptions(true)
  private async addChangelogEntryMenu(): Promise<void> {
    if (this.curScm === undefined) {
      this.logger.error(
        "addChangelogEntry was invoked without an active SourceControl"
      );
      return;
    }
    let msg: string | undefined = this.curScm.inputBox.value;
    if (msg === "") {
      msg = await vscode.window.showInputBox({
        prompt: "Enter a changelog entry",
        ignoreFocusOut,
        validateInput: (cur) =>
          cur === "" ? "Changelog entry must not be empty" : undefined
      });
      if (msg === undefined) {
        this.logger.error("User did not provide a changelog entry, aborting.");
        return;
      }
    }
    assert(msg !== undefined);

    await this.addChangelogEntry(msg);
  }

  private async addChangelogEntry(msg: string): Promise<void> {
    if (this.activePackage === undefined) {
      throw new Error(
        `Cannot add a changelog entry, no package is currently active`
      );
    }
    const acc = this.activeAccounts.getConfig(this.activePackage.apiUrl)
      ?.account;
    if (
      acc === undefined ||
      acc.realname === undefined ||
      acc.email === undefined
    ) {
      throw new Error(
        `Cannot add a changelog entry, need a properly configured account (with email and real name)`
      );
    }

    if (msg === undefined) {
      this.logger.info("changelog entry requested with an empty message");
    }

    const fmtOptions = {
      locale: "en-US",
      calendar: "gregory",
      numberingSystem: "latn",
      timeZone: "UTC",
      hourCycle: "h24",
      hour12: false,
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short"
    };
    const [
      weekday,
      ,
      month,
      ,
      day,
      ,
      year,
      ,
      hour,
      ,
      minute,
      ,
      second,
      ,
      tzName
    ] = new Intl.DateTimeFormat("en-US", fmtOptions).formatToParts(new Date());

    assert(
      weekday.type === "weekday" &&
        month.type === "month" &&
        day.type === "day" &&
        year.type === "year" &&
        minute.type === "minute" &&
        second.type === "second" &&
        tzName.type === "timeZoneName"
    );

    const entry = `-------------------------------------------------------------------
${weekday.value} ${month.value} ${day.value} ${hour.value}:${minute.value}:${second.value} ${tzName.value} ${year.value} - ${acc.realname} <${acc.email}>

${msg}

`;

    const standardChangesFile = join(
      this.activePackage.path,
      `${this.activePackage.name}.changes`
    );
    let changesFile: string | undefined = standardChangesFile;
    if (!(await pathExists(standardChangesFile, PathType.File))) {
      changesFile = undefined;
      const dentries = await fsPromises.readdir(this.activePackage.path, {
        withFileTypes: true
      });
      for (const dentry of dentries) {
        if (dentry.isFile && dentry.name.match(/\.changes$/)) {
          changesFile = join(this.activePackage.path, dentry.name);
          this.logger.debug("Using non-standard changes file: %s", changesFile);
          break;
        }
      }
    }

    const oldContents =
      changesFile === undefined
        ? undefined
        : await fsPromises.readFile(changesFile);
    const fd = await fsPromises.open(changesFile ?? standardChangesFile, "w");
    try {
      await fd.write(entry);
      oldContents !== undefined ? await fd.write(oldContents) : undefined;
    } finally {
      await fd.close();
    }
  }

  private getPathOfOriginalResource(uri: vscode.Uri): string {
    const pathUri = uri.with({ scheme: "file" });
    return join(dirname(pathUri.fsPath), ".osc", basename(pathUri.fsPath));
  }

  private getUriOfOriginalResource(uri: vscode.Uri): vscode.Uri | undefined {
    if (this.activePackage === undefined) {
      return undefined;
    }
    const splitPath = uri.fsPath.split(sep);
    const matchingFile = this.activePackage.files.find(
      (f) => f.name === splitPath[splitPath.length - 1]
    );

    if (matchingFile === undefined) {
      return undefined;
    }
    return uri.with({ scheme: OBS_FILE_AT_HEAD_SCHEME });
  }

  private async showDiffFromUri(uri?: vscode.Uri): Promise<void> {
    if (uri === undefined) {
      return;
    }
    assert(
      this.activePackage !== undefined,
      "A package must be currently active"
    );

    const fname = basename(uri.fsPath);
    const fileState = this.activePackage.filesInWorkdir.find(
      (f) => f.name === fname
    )!.state;

    if (fileState === FileState.ToBeAdded) {
      await vscode.commands.executeCommand(
        "vscode.diff",
        EmptyDocumentForDiffProvider.buildUri(uri.fsPath),
        uri,
        `${fname} (New File)`
      );
    } else {
      const orig = this.getUriOfOriginalResource(uri);
      if (orig === undefined) {
        this.logger.error(
          "Could not get uri of the original resource of %s",
          uri
        );
        return;
      }

      if (
        fileState === FileState.Missing ||
        fileState === FileState.ToBeDeleted
      ) {
        await vscode.commands.executeCommand(
          "vscode.diff",
          orig,
          EmptyDocumentForDiffProvider.buildUri(uri.fsPath),
          `${fname} (${
            fileState === FileState.ToBeDeleted ? "to be deleted" : "missing"
          })`
        );
      } else {
        await vscode.commands.executeCommand(
          "vscode.diff",
          orig,
          uri,
          `${fname} (Working Tree)`
        );
      }
    }
  }

  private async addFile(
    ...resourceStates: vscode.SourceControlResourceState[]
  ): Promise<void> {
    const filesToAdd = resourceStates.map((state) =>
      basename(state.resourceUri.fsPath)
    );
    assert(
      this.activePackage !== undefined,
      "A package must be currently active"
    );
    await addAndDeleteFilesFromPackage(this.activePackage, [], filesToAdd);
  }

  private async removeFile(
    ...resourceStates: vscode.SourceControlResourceState[]
  ): Promise<void> {
    const filesToDelete = resourceStates.map((state) =>
      basename(state.resourceUri.fsPath)
    );
    assert(
      this.activePackage !== undefined,
      "A package must be currently active"
    );
    await addAndDeleteFilesFromPackage(this.activePackage, filesToDelete, []);
  }

  private async discardChanges(
    ...resourceStates: vscode.SourceControlResourceState[]
  ): Promise<void> {
    await Promise.all(
      resourceStates.map(async (resourceState) => {
        const matchingEditors = vscode.window.visibleTextEditors.filter(
          (editor) =>
            editor.document.uri.toString() ===
            resourceState.resourceUri.toString()
        );
        const uriAtHead = this.getUriOfOriginalResource(
          resourceState.resourceUri
        );
        if (uriAtHead === undefined) {
          this.logger.error(
            "Could not get uri of the original file of the file %s from %s/%s",
            basename(resourceState.resourceUri.fsPath),
            this.activePackage?.projectName,
            this.activePackage?.name
          );
          return;
        }

        // if the document is not open, then just overwrite the file contents
        if (matchingEditors.length === 0) {
          await fsPromises.copyFile(
            this.getPathOfOriginalResource(uriAtHead),
            resourceState.resourceUri.fsPath
          );
        } else {
          const origContent = await this.provideTextDocumentContent(
            resourceState.resourceUri.with({ scheme: OBS_FILE_AT_HEAD_SCHEME }),
            { isCancellationRequested: false } as vscode.CancellationToken
          );
          if (origContent === undefined) {
            this.logger.error(
              "could not get original content for the file %s from %s/%s",
              resourceState.resourceUri.fsPath,
              this.activePackage?.projectName,
              this.activePackage?.name
            );
            return;
          }

          await Promise.all(
            matchingEditors.map(async (editor) => {
              await editor.edit((builder) =>
                builder.replace(
                  new vscode.Range(0, 0, editor.document.lineCount, 0),
                  origContent
                )
              );
              await editor.document.save();
            })
          );
        }
      })
    );
  }

  private async showDiff(
    ...resourceStates: vscode.SourceControlResourceState[]
  ): Promise<void> {
    await Promise.all(
      resourceStates.map(async (resourceState) => {
        await this.showDiffFromUri(resourceState.resourceUri);
      })
    );
  }

  private async revertChange(
    uri?: vscode.Uri,
    changes?: LineChange[],
    index?: number
  ): Promise<void> {
    if (uri === undefined || changes === undefined || index === undefined) {
      // FIXME: use the active editor and revert all changes instead maybe?
      this.logger.error(
        "Command revertChange cannot be executed without all mandatory arguments."
      );
      return;
    }

    assert(
      changes.length >= index,
      `Must have received at least ${index} line changes, but got only ${changes.length}`
    );
    const change = changes[index];

    if (this.activePackage === undefined) {
      this.logger.error(
        "Revert of the line change [%d:%d] in %s was requested, but no activePackage exists",
        change.modifiedStartLineNumber,
        change.modifiedEndLineNumber,
        uri.fsPath
      );
      return;
    }

    // the change is just a set of lines being deleted
    const isDeletion = change.modifiedEndLineNumber === 0;
    // the change is just the addition of lines
    const isAddition = change.originalEndLineNumber === 0;

    assert(
      !(isDeletion && isAddition),
      "LineChange must be an Addition or a Deletion, but cannot be both at once"
    );

    const matchingEditors = vscode.window.visibleTextEditors.filter(
      (editor) => editor.document.uri.toString() === uri.toString()
    );
    // FIXME: why do we get more than 1 here??
    // if (matchingEditors.length !== 1) {
    //   this.logger.error(
    //     "Expected to find 1 matching text editor for this Uri (%s) but got %d",
    //     uri.toString(),
    //     matchingEditors.length
    //   );
    //   return;
    // }
    const matchingEditor = matchingEditors[0];

    let success: boolean;
    if (isAddition) {
      success = await matchingEditor.edit((editBuilder) =>
        editBuilder.delete(
          new vscode.Range(
            change.modifiedStartLineNumber - 1,
            0,
            // FIXME: what to do at the end of the file?
            change.modifiedEndLineNumber,
            0
          )
        )
      );
    } else {
      const origDocument = await vscode.workspace.openTextDocument(
        this.getUriOfOriginalResource(uri)!
      );

      const origContent = origDocument.getText(
        new vscode.Range(
          change.originalStartLineNumber - 1,
          0,
          change.originalEndLineNumber,
          0
        )
      );

      success = await matchingEditor.edit((editBuilder) =>
        isDeletion
          ? editBuilder.insert(
              // for deletions change.modifiedStartLineNumber is the line
              // *after* which the content needs to be inserted
              new vscode.Position(change.modifiedStartLineNumber, 0),
              origContent
            )
          : editBuilder.replace(
              new vscode.Range(
                change.modifiedStartLineNumber - 1,
                0,
                change.modifiedEndLineNumber,
                0
              ),
              origContent
            )
      );
    }

    if (!success) {
      this.logger.error(
        "Reverting the line change [%d:%d] in %s failed",
        change.modifiedStartLineNumber,
        change.modifiedEndLineNumber,
        uri.fsPath
      );
    }
  }

  private async commitChanges(scm?: vscode.SourceControl): Promise<void> {
    if (this.activePackage === undefined) {
      this.logger.error("Cannot commit changes: no activePackage is set");
      return;
    }

    const con = this.activeAccounts.getConfig(this.activePackage.apiUrl)
      ?.connection;
    if (con === undefined) {
      this.logger.error(
        "Cannot commit changes: no connection for the API '%s' exists",
        this.activePackage.apiUrl
      );
      return;
    }

    const commitMsg = scm?.inputBox.value;
    if (commitMsg === undefined || commitMsg === "") {
      {
        const commitAnyway = await vscode.window.showInformationMessage(
          "No commit message provided, commit anyway?",
          "Yes",
          "No"
        );
        if (commitAnyway === undefined || commitAnyway === "No") {
          this.logger.debug(
            "No commit message provided and user decided to not commit the changes"
          );
          return;
        }
      }
    }

    await commit(con, this.activePackage, commitMsg);
    if (this.curScm?.inputBox.value !== undefined) {
      this.curScm.inputBox.value = "";
    }

    // this.updateScm(await readInModifiedPackageFromDir(this.activePackage.path));
  }

  private updateScm(): void {
    this.curScm?.dispose();
    this.activePackage = this.activePackageWatcher.activePackage;

    if (this.activePackageWatcher.activePackage !== undefined) {
      this.curScm = this.scmFromModifiedPackage(
        this.activePackageWatcher.activePackage
      );
    }
  }

  private scmFromModifiedPackage(pkg: ModifiedPackage): vscode.SourceControl {
    const obsScm = vscode.scm.createSourceControl(
      "obs",
      "OBS package " + pkg.projectName + "/" + pkg.name
    );

    const untrackedFiles = obsScm.createResourceGroup(
      "untracked",
      "untracked files"
    );
    untrackedFiles.hideWhenEmpty = true;
    untrackedFiles.resourceStates = pkg.filesInWorkdir
      .filter((f) => f.state === FileState.Untracked)
      .map((f) => ({ resourceUri: vscode.Uri.file(join(pkg.path, f.name)) }));

    // const removedFiles = obsScm.createResourceGroup(
    //   "deleted",
    //   "removed files"
    // );
    // untrackedFiles.resourceStates = pkg.filesInWorkdir
    //   .filter((f) => f.state === FileState.ToBeDeleted)
    //   .map((f) => ({ resourceUri: vscode.Uri.file(join(pkg.path, f.name)) }));

    const changed = obsScm.createResourceGroup("changes", "Changed files");

    changed.resourceStates = pkg.filesInWorkdir
      .filter(
        (f) =>
          f.state !== FileState.Unmodified && f.state !== FileState.Untracked
      )
      .map((f) => {
        const resourceUri = vscode.Uri.file(join(pkg.path, f.name));
        return {
          command: {
            arguments: [resourceUri],
            command: SHOW_DIFF_FROM_URI_COMMAND,
            title: "Show the diff to HEAD"
          },
          decorations: {
            faded: f.state === FileState.Missing,
            strikeThrough: f.state === FileState.ToBeDeleted
          },
          resourceUri
        };
      });

    obsScm.quickDiffProvider = this;
    obsScm.inputBox.placeholder = "Commit message";
    obsScm.acceptInputCommand = {
      command: COMMIT_CHANGES_COMMAND,
      title: "commit the current changes"
    };

    return obsScm;
  }
}
