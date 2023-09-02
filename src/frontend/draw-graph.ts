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

import * as GitgraphJS from "@gitgraph/js";
import {
  commitKeyToBranchName,
  commitWithChildrenFromJson,
  getBranchName,
  MessageType,
  ReceivedHistoryReceivedMsg,
  SendHistoryReceivedMsg,
  StartFetchingHistoryMsg
} from "../history-graph-common";

interface Message {
  type: MessageType;
  payload?: any;
}

interface VSCode {
  postMessage<T extends Message = Message>(message: T): void;
  getState(): any;
  setState(state: any): void;
}

declare function acquireVsCodeApi(): VSCode;

const getGraphTemplate = (): ReturnType<typeof GitgraphJS.templateExtend> => {
  const graphContainerCss = window.getComputedStyle(
    document.getElementById("graph-container")!
  );
  const font = graphContainerCss.font;
  const fontSize = parseInt(graphContainerCss.fontSize.replace("px", ""));

  const [foregroundColor, backgroundColor] = [
    "foreground",
    "background"
  ].map((color) =>
    graphContainerCss.getPropertyValue(`--vscode-editor-${color}`)
  );
  const lineWidth = Math.ceil(fontSize / 10);
  const commitSpacing = 3 * fontSize;
  const dotSize = Math.ceil(fontSize * 0.75);
  const branchSpacing = 2 * fontSize;
  const arrowSize = Math.ceil(fontSize * 0.5);

  return GitgraphJS.templateExtend(GitgraphJS.TemplateName.Metro, {
    arrow: { size: arrowSize, color: foregroundColor },
    branch: {
      label: {
        font,
        strokeColor: foregroundColor,
        bgColor: backgroundColor
      },
      lineWidth,
      spacing: branchSpacing,
      color: foregroundColor
    },
    commit: {
      spacing: commitSpacing,
      dot: {
        size: dotSize,
        strokeWidth: lineWidth,
        strokeColor: foregroundColor,
        font
      },
      message: {
        // we add the author & hash ourselves, as we cannot make gitgraph.js
        // omit the email
        displayHash: false,
        displayAuthor: false,
        font,
        color: foregroundColor
      }
    }
  });
};

const drawSequentialHistoryGraph = (data: SendHistoryReceivedMsg): void => {
  const branchMap = new Map<string, GitgraphJS.Branch>();

  const graphContainer = document.getElementById("graph-container")!;
  graphContainer.innerHTML = "";

  const template = getGraphTemplate();
  const graph = GitgraphJS.createGitgraph(graphContainer, {
    template
  });
  graph.clear();

  data.parentlessCommits.forEach((c) => {
    const branchName = getBranchName(c);
    branchMap.set(branchName, graph.branch(branchName));
  });

  const sortedCommits = data.commitMapInitializer
    .map(([, commit]) => commit)
    .sort((c1, c2) =>
      c1.commitTime.getTime() < c2.commitTime.getTime()
        ? -1
        : c1.commitTime.getTime() > c2.commitTime.getTime()
        ? 1
        : 0
    );

  for (const commit of sortedCommits) {
    const commitOpts = {
      // We create the commit message ourselves here completely using the hash,
      // commitMessage and userId not relying on gitgraph.js
      // The issue with gitgraph.js is that it will use the hash to uniquely
      // identify commits (the revisionHash is not guaranteed to be unique
      // across branches though, so thereby we'd get two commits inside one)
      // Furthermore, we do not have the user's email addresses at this point
      // (and don't really want to fetch them), and as we cannot tell gitgraphjs
      // to *not* include the email, we just append the userId as well
      subject: [`r${commit.revision}`, commit.commitMessage, commit.userId]
        .filter((s) => s !== undefined && s !== "")
        .join(" - ")
    };

    if (commit.parentCommits.length > 1) {
      const branchNames = commit.parentCommits.map((parentKey) =>
        commitKeyToBranchName(parentKey)
      );

      const branches = branchNames
        .map((branchName) => branchMap.get(branchName))
        .filter((b) => b !== undefined) as GitgraphJS.Branch[];
      branches.slice(1).map((b) => {
        branches[0].merge({ branch: b, commitOptions: commitOpts });
      });
    } else {
      const branchName = getBranchName(commit);
      let branch = branchMap.get(branchName);
      if (branch === undefined) {
        branch = graph.branch(branchName);
        branchMap.set(branchName, branch);
      }

      branch.commit(commitOpts);
    }
  }
};

function isReceivedHistoryReceivedMsg(
  msg: any
): msg is ReceivedHistoryReceivedMsg {
  return (
    msg !== undefined &&
    msg.commitMapInitializer !== undefined &&
    msg.parentlessCommits !== undefined &&
    msg.type === MessageType.HistoryReceived
  );
}

function convertMessagePayload(msg: any): SendHistoryReceivedMsg | undefined {
  if (!isReceivedHistoryReceivedMsg(msg)) {
    return undefined;
  }

  const { commitMapInitializer, parentlessCommits, ...rest } = msg;
  return {
    ...rest,
    parentlessCommits: parentlessCommits.map((c) =>
      commitWithChildrenFromJson(c)
    ),
    commitMapInitializer: commitMapInitializer.map(([k, commit]) => [
      k,
      commitWithChildrenFromJson(commit)
    ])
  };
}

function main(): void {
  const vscode = acquireVsCodeApi();

  const redrawGraph = (): void => {
    const oldState = convertMessagePayload(vscode.getState());
    if (oldState !== undefined) {
      drawSequentialHistoryGraph(oldState);
    }
  };
  redrawGraph();

  let oldTheme = document.body.className;
  const observer = new MutationObserver(() => {
    if (document.body.className !== oldTheme) {
      oldTheme = document.body.className;
      redrawGraph();
    }
  });
  observer.observe(document.body, { attributes: true });

  window.addEventListener(
    "message",
    (
      event: MessageEvent<ReceivedHistoryReceivedMsg | StartFetchingHistoryMsg>
    ) => {
      const graphContainer = document.getElementById("graph-container")!;
      switch (event.data.type) {
        case MessageType.StartFetch:
          graphContainer.innerHTML = `Fetching history of ${event.data.projectName}/${event.data.name}`;
          break;

        case MessageType.HistoryReceived: {
          const data = convertMessagePayload(event.data);
          if (data === undefined) {
            break;
          }
          drawSequentialHistoryGraph(data);
          vscode.setState(data);
          break;
        }

        default:
          console.error("Received an invalid message: ", event.data);
      }
    }
  );
}

main();
