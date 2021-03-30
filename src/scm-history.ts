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

import { IVSCodeExtLogger } from "@vscode-logging/logger";
import {
  fetchHistory,
  ModifiedPackage,
  Package,
  Revision
} from "open-build-service-api";
import * as vscode from "vscode";
import { AccountManager } from "./accounts";
import { assert } from "./assert";
import { ConnectionListenerLoggerBase } from "./base-components";
import { cmdPrefix } from "./constants";
import {
  CurrentPackage,
  CurrentPackageWatcher,
  isModifiedPackage
} from "./current-package-watcher";

export class HistoryRootTreeElement extends vscode.TreeItem {
  public contextValue = "historyRoot";

  constructor(pkg: Package) {
    super(
      `${pkg.projectName}/${pkg.name}`,
      vscode.TreeItemCollapsibleState.Expanded
    );
  }
}

export class CommitTreeElement extends vscode.TreeItem {
  public contextValue = "commit";

  public iconPath = new vscode.ThemeIcon("git-commit");

  constructor(public readonly rev: Revision) {
    super(
      `${rev.revision}: ${
        rev.commitMessage === undefined
          ? "no commit message available"
          : rev.commitMessage.split("\n")[0]
      }`,
      vscode.TreeItemCollapsibleState.None
    );
    this.command = {
      arguments: [this],
      command: OPEN_COMMIT_DOCUMENT_COMMAND,
      title: "Show commit info"
    };
  }
}

function isCommitTreeElement(elem: vscode.TreeItem): elem is CommitTreeElement {
  return elem.contextValue === "commit";
}

function isHistoryRootTreeElement(
  elem: vscode.TreeItem
): elem is HistoryRootTreeElement {
  return elem.contextValue === "historyRoot";
}

type HistoryTreeItem = CommitTreeElement | HistoryRootTreeElement;

const cmdId = "scmHistory";

export const OBS_REVISION_FILE_SCHEME = "vscodeObsCommit";

export function fsPathFromObsRevisionUri(uri: vscode.Uri): string | undefined {
  return uri.scheme === OBS_REVISION_FILE_SCHEME
    ? uri.with({ scheme: "file", query: "" }).fsPath
    : undefined;
}

export const OPEN_COMMIT_DOCUMENT_COMMAND = `${cmdPrefix}.${cmdId}.openCommitDocument`;

export class PackageScmHistoryTree
  extends ConnectionListenerLoggerBase
  implements
    vscode.TreeDataProvider<HistoryTreeItem>,
    vscode.TextDocumentContentProvider {
  private commitToUri(rev: Revision): vscode.Uri | undefined {
    return this.currentPackage === undefined
      ? undefined
      : vscode.Uri.file(this.currentPackage.path).with({
          scheme: OBS_REVISION_FILE_SCHEME,
          query: rev.revisionHash
        });
  }

  public static async createPackageScmHistoryTree(
    currentPackageWatcher: CurrentPackageWatcher,
    accountManager: AccountManager,
    logger: IVSCodeExtLogger
  ): Promise<PackageScmHistoryTree> {
    const historyTree = new PackageScmHistoryTree(
      currentPackageWatcher,
      accountManager,
      logger
    );
    await historyTree.setCurrentPackage(currentPackageWatcher.currentPackage);
    return historyTree;
  }

  public onDidChangeTreeData: vscode.Event<HistoryTreeItem | undefined>;

  private onDidChangeTreeDataEmitter: vscode.EventEmitter<
    HistoryTreeItem | undefined
  > = new vscode.EventEmitter();

  private currentPackage: ModifiedPackage | undefined = undefined;
  private currentHistory: readonly Revision[] | undefined = undefined;

  private constructor(
    currentPackageWatcher: CurrentPackageWatcher,
    accountManager: AccountManager,
    logger: IVSCodeExtLogger
  ) {
    super(accountManager, logger);
    this.onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

    this.disposables.push(
      this.onDidChangeTreeDataEmitter,
      currentPackageWatcher.onDidChangeCurrentPackage(
        this.setCurrentPackage,
        this
      ),
      vscode.commands.registerCommand(
        OPEN_COMMIT_DOCUMENT_COMMAND,
        this.openCommitDocument,
        this
      ),
      vscode.workspace.registerTextDocumentContentProvider(
        OBS_REVISION_FILE_SCHEME,
        this
      )
    );
  }

  public provideTextDocumentContent(
    uri: vscode.Uri,
    token: vscode.CancellationToken
  ): string | undefined {
    const rev = this.commitFromUri(uri);

    if (token.isCancellationRequested || rev === undefined) {
      return undefined;
    }
    let content = `r${rev.revision} | ${
      rev.userId ?? "unknown user"
    } | ${rev.commitTime.toString()} | ${rev.revisionHash}`;
    if (rev.version !== undefined) {
      content = content.concat(" | ", rev.version);
    }
    if (rev.requestId !== undefined) {
      content = content.concat(" | rq", rev.requestId.toString());
    }
    content = content.concat(
      `
`,
      rev.commitMessage ?? "No commit message available"
    );

    return content;
  }

  public getTreeItem(element: HistoryTreeItem): vscode.TreeItem {
    return element;
  }

  public getChildren(element?: HistoryTreeItem): HistoryTreeItem[] {
    if (this.currentPackage === undefined) {
      return [];
    }
    if (element === undefined) {
      return [new HistoryRootTreeElement(this.currentPackage)];
    }

    assert(isHistoryRootTreeElement(element));
    if (this.currentHistory === undefined) {
      this.logger.error("currentPackage is set, but no history is present");
      return [];
    }
    return this.currentHistory.map(
      (_rev, index, hist) =>
        new CommitTreeElement(hist[hist.length - 1 - index])
    );
  }

  private commitFromUri(uri: vscode.Uri): Revision | undefined {
    if (uri.scheme !== OBS_REVISION_FILE_SCHEME) {
      throw new Error(
        `cannot extract a Revision from the uri '${uri.toString()}', invalid scheme: ${
          uri.scheme
        }, expected ${OBS_REVISION_FILE_SCHEME}`
      );
    }

    if (this.currentHistory === undefined) {
      this.logger.error(
        "commit document was requested but no currentHistory is set"
      );
      return undefined;
    }

    const revisionHash = uri.query;

    return this.currentHistory.find((rev) => rev.revisionHash === revisionHash);
  }

  private async openCommitDocument(element?: vscode.TreeItem): Promise<void> {
    if (element === undefined || !isCommitTreeElement(element)) {
      return;
    }
    const uri = this.commitToUri(element.rev);
    if (uri === undefined) {
      this.logger.error(
        "Could not get an uri from the element with the revision: %s",
        element.rev
      );
      return;
    }
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: false });
  }

  private async setCurrentPackage(curPkg: CurrentPackage): Promise<void> {
    const pkg = curPkg.currentPackage;
    if (pkg === undefined || !isModifiedPackage(pkg)) {
      this.logger.debug(
        "setCurrentPackage called without the pkg parameter or the package %s/%s is not a ModifiedPackage (= not checked out)",
        pkg?.projectName,
        pkg?.name
      );
      return;
    }
    const con = this.activeAccounts.getConfig(pkg.apiUrl)?.connection;
    if (con === undefined) {
      this.logger.error(
        "cannot fetch history for %s/%s: no account is configured for the API %s",
        pkg.projectName,
        pkg.name,
        pkg.apiUrl
      );
      return;
    }

    try {
      this.currentHistory = await fetchHistory(con, pkg);
      this.currentPackage = pkg;
      this.onDidChangeTreeDataEmitter.fire(undefined);
    } catch (err) {
      this.logger.error(
        "Failed to load history of %s/%s from %s, got error: %s",
        pkg.projectName,
        pkg.name,
        pkg.apiUrl,
        (err as Error).toString()
      );
    }
  }
}
