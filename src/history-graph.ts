/**
 * Copyright (c) 2021 SUSE LLC
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
import { Commit, Connection, Package, Revision } from "open-build-service-api";
import { resolve } from "path";
import * as vscode from "vscode";
import { AccountManager } from "./accounts";
import { ConnectionListenerLoggerBase } from "./base-components";
import {
  CurrentPackage,
  CurrentPackageWatcher
} from "./current-package-watcher";
import {
  DEFAULT_OBS_FETCHERS,
  ObsFetchers,
  VscodeWindow
} from "./dependency-injection";
import {
  commitToCommitWithHashes,
  CommitWithChildren,
  getCommitKey,
  isCommitWithChildren,
  MessageType,
  SendHistoryReceivedMsg,
  StartFetchingHistoryMsg
} from "./history-graph-common";

function addChildCommits(
  commit: Commit | CommitWithChildren,
  childCommitKey: string | undefined,
  commitMap: Map<string, CommitWithChildren>
): CommitWithChildren {
  if (isCommitWithChildren(commit)) {
    if (childCommitKey !== undefined) {
      commit.childCommits.push(childCommitKey);
    }
    commitMap.set(getCommitKey(commit), commit);
    return commit;
  } else {
    const { parentCommits } = commit;
    (parentCommits ?? []).map((p) => {
      commitMap.set(
        getCommitKey(p),
        addChildCommits(p, getCommitKey(commit), commitMap)
      );
    });
    const res = {
      ...commitToCommitWithHashes(commit),
      childCommits: childCommitKey === undefined ? [] : [childCommitKey]
    };
    commitMap.set(getCommitKey(res), res);
    return res;
  }
}

function findCommitKeysWithoutParent(
  commitMap: Map<string, CommitWithChildren>
): string[] {
  const parentlessCommitKeys = [];
  for (const [key, commit] of commitMap.entries()) {
    if (commit.parentCommits.length === 0) {
      parentlessCommitKeys.push(key);
    }
  }

  return parentlessCommitKeys;
}

function headToHistoryMsg(head: Commit): SendHistoryReceivedMsg {
  const commitMap = new Map<string, CommitWithChildren>();
  addChildCommits(head, undefined, commitMap);

  const res = {
    commitMapInitializer: [...commitMap.entries()],
    // we found the commit hashes from the same map from which we get() them, so
    // they *must* be there => asserting this is fine
    parentlessCommits: findCommitKeysWithoutParent(commitMap).map(
      /* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */
      (c) => commitMap.get(c)!
    )
  };

  return { type: MessageType.HistoryReceived, ...res };
}

/** Directory where the frontend scripts reside */
const SCRIPTS_DIR = vscode.Uri.file(resolve(__dirname, "..", "media", "html"));

/**
 * Class that provides a webview that renders the history of a OBS package
 * across branches.
 */
export class HistoryGraph
  extends ConnectionListenerLoggerBase
  implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private lastMsg?: SendHistoryReceivedMsg;

  /**
   * Sends the supplied message to the currently active webview, if it exists.
   */
  private async sendMsgToWebview(
    msg: StartFetchingHistoryMsg | SendHistoryReceivedMsg
  ): Promise<void> {
    if (this.view === undefined) {
      return;
    }
    await this.view.webview.postMessage(msg);
  }

  /** */
  public static createHistoryGraph(
    currentPackageWatcher: CurrentPackageWatcher,
    accMngr: AccountManager,
    logger: IVSCodeExtLogger,
    obsFetchers: ObsFetchers = DEFAULT_OBS_FETCHERS,
    vscodeWindow: VscodeWindow = vscode.window
  ): HistoryGraph {
    const histGraph = new HistoryGraph(accMngr, logger, obsFetchers);

    histGraph.disposables.push(
      vscodeWindow.registerWebviewViewProvider(
        "packageScmHistoryTree",
        histGraph
      ),
      currentPackageWatcher.onDidChangeCurrentPackage(function (
        this: HistoryGraph,
        newCurPkg: CurrentPackage
      ): void {
        if (newCurPkg.currentPackage !== undefined) {
          const { name, projectName, apiUrl } = newCurPkg.currentPackage;
          const con = this.activeAccounts.getConfig(apiUrl)?.connection;
          if (con !== undefined) {
            this.renderGraph(con, { name, projectName, apiUrl })
              .then()
              .catch((err) => {
                this.logger.error(
                  "Tried to render the history graph of the package %s/%s from %s, but got the following error: %s",
                  projectName,
                  name,
                  apiUrl,
                  (err as Error).toString()
                );
                this.logger.trace(
                  "Stack trace of the previous error: %s",
                  (err as Error).stack
                );
              });
          }
        }
      },
      histGraph)
    );

    return histGraph;
  }

  protected constructor(
    accountManager: AccountManager,
    extLogger: IVSCodeExtLogger,
    protected readonly obsFetchers: ObsFetchers
  ) {
    super(accountManager, extLogger);
  }

  public async renderGraph(con: Connection, pkg: Package): Promise<void> {
    if (this.view === undefined) {
      return;
    }
    await this.sendMsgToWebview({
      type: MessageType.StartFetch,
      projectName: pkg.projectName,
      name: pkg.name
    });
    let history: Commit | undefined;
    try {
      history = await this.obsFetchers.fetchHistoryAcrossLinks(con, pkg);
    } catch (err) {
      this.logger.error(
        "Tried to fetch the history across links of %s/%s from %s, but got the error: %s",
        pkg.projectName,
        pkg.name,
        pkg.apiUrl,
        (err as Error).toString()
      );
    }
    if (history === undefined) {
      this.logger.trace(
        "history is undefined, trying to fetch the history without branches"
      );
      let unbranchedHistory: readonly Revision[];
      try {
        unbranchedHistory = await this.obsFetchers.fetchHistory(con, pkg);
      } catch (err) {
        this.logger.error(
          "Tried to fetch the history of %s/%s from %s, but got the error: %s",
          pkg.projectName,
          pkg.name,
          pkg.apiUrl,
          (err as Error).toString()
        );
        return;
      }

      let head: Commit | undefined;

      for (let i = unbranchedHistory.length - 1; i >= 0; i--) {
        head = {
          ...unbranchedHistory[i],
          parentCommits: head === undefined ? undefined : [head],
          // these are actually not the correct values, but we don't use them
          // for rendering so any valid type will do
          files: []
        };
      }

      history = head;
    }

    if (history === undefined) {
      this.logger.trace(
        "Could not retrieve the history across links and also not the direct history, aborting"
      );
      return;
    }
    this.lastMsg = headToHistoryMsg(history);

    this.view.show(true);
    await this.sendMsgToWebview(this.lastMsg);
  }

  public async resolveWebviewView(
    webviewView: vscode.WebviewView
  ): Promise<void> {
    this.view = webviewView;

    const scriptUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(SCRIPTS_DIR, "draw-graph.js")
    );
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [SCRIPTS_DIR]
    };
    webviewView.webview.html = `<!DOCTYPE html>
<html lang="en">
	<head>
		<meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy"
      content="default-src 'self' ${webviewView.webview.cspSource} https://*;
        script-src ${
          webviewView.webview.cspSource
        } https: 'unsafe-inline' 'unsafe-eval';
        style-src ${webviewView.webview.cspSource} https: 'unsafe-inline';
        img-src ${webviewView.webview.cspSource} 'self' https://* blob: data:;
        font-src 'self' ${webviewView.webview.cspSource} https://* blob: data:;
        connect-src 'self' https://* wss://*;
        worker-src 'self' https://* blob: data:">
		<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
		<title>OBS history log</title>
	</head>
	<body>
    <div id="graph-container"></div>
    <!-- define exports ourselves for Typescript -->
    <script>var exports = {"__esModule": true};</script>
    <script src="${scriptUri.toString()}"></script>
	</body>
</html>
`;
    if (this.lastMsg !== undefined) {
      await this.sendMsgToWebview(this.lastMsg);
    }
  }
}
