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

import { expect } from "chai";
import { afterEach, beforeEach, Context, describe, it } from "mocha";
import { Commit } from "open-build-service-api";
import { join } from "path";
import { createSandbox } from "sinon";
import { HistoryGraph } from "../../history-graph";
import {
  commitKeyToBranchName,
  commitToCommitWithHashes,
  CommitWithChildren,
  commitWithChildrenFromJson,
  CommitWithHashes,
  getBranchName,
  getCommitKey,
  isCommitWithChildren,
  isCommitWithHashes
} from "../../history-graph-common";
import {
  AccountMapInitializer,
  createFakeWebviewView,
  FakeAccountManager,
  FakeCurrentPackageWatcher
} from "./fakes";
import {
  castToAsyncFunc,
  castToFunc,
  createStubbedObsFetchers,
  createStubbedVscodeWindow,
  LoggingFixture,
  testLogger
} from "./test-utils";

class HistoryGraphFixture extends LoggingFixture {
  public currentPackageWatcher = new FakeCurrentPackageWatcher();
  public accountManager?: FakeAccountManager;

  public sandbox = createSandbox();

  public readonly obsFetchers = createStubbedObsFetchers(this.sandbox);
  public readonly vscodeWindow = createStubbedVscodeWindow(this.sandbox);
  public readonly fakeWebViewDisposable = { dispose: this.sandbox.stub() };

  public createHistoryGraph(
    initialAccountMap?: AccountMapInitializer
  ): HistoryGraph {
    this.accountManager = new FakeAccountManager(initialAccountMap);

    this.vscodeWindow.registerWebviewViewProvider
      .onCall(0)
      .returns(this.fakeWebViewDisposable);

    const historyGraph = HistoryGraph.createHistoryGraph(
      this.currentPackageWatcher,
      this.accountManager,
      testLogger,
      this.obsFetchers,
      this.vscodeWindow
    );
    this.disposables.push(historyGraph);
    return historyGraph;
  }

  public afterEach(ctx: Context): void {
    super.afterEach(ctx);
    this.sandbox.reset();
    console.log(this.disposables);
    this.dispose();
  }
}

type TestCtx = Context & { fixture: HistoryGraphFixture };

describe("HistoryGraph", () => {
  beforeEach(function () {
    const fixture = new HistoryGraphFixture(this);
    this.fixture = fixture;
  });

  afterEach(function () {
    this.fixture.afterEach(this);
  });

  describe("#createHistoryGraph", () => {
    it(
      "creates a new HistoryGraph",
      castToFunc<TestCtx>(function () {
        this.fixture.createHistoryGraph();
        this.fixture.vscodeWindow.registerWebviewViewProvider.should.have.callCount(
          1
        );
      })
    );
  });

  describe("#resolveWebviewView", () => {
    it(
      "creates a new webview with the settings applied",
      castToAsyncFunc<TestCtx>(async function () {
        const graph = this.fixture.createHistoryGraph([]);

        const { webviewView } = createFakeWebviewView(this.fixture.sandbox);

        await graph.resolveWebviewView(webviewView);
        webviewView.webview.options.should.deep.include({
          enableScripts: true
        });
        expect(webviewView.webview.options.localResourceRoots).to.have.lengthOf(
          1
        );
        expect(
          webviewView.webview.options.localResourceRoots![0].fsPath
        ).to.match(new RegExp(join("media", "html")));
        webviewView.webview.html.should.match(
          new RegExp('<div id="graph-container"></div>')
        );
      })
    );
  });
});

describe("CommitWithHashes", () => {
  const commitCommon = {
    projectName: "bar",
    packageName: "foo",
    files: [],
    revisionHash: "uiaeasdf",
    revision: 1
  };
  const cmtWithChildren: CommitWithChildren = {
    ...commitCommon,
    parentCommits: ["baz"],
    childCommits: ["foo"],
    commitTime: new Date(1000)
  };
  const cmtWithHashes: CommitWithHashes = {
    ...commitCommon,
    parentCommits: ["bar"],
    commitTime: new Date(100)
  };
  const cmt: Commit = {
    ...commitCommon,
    commitTime: new Date(1337),
    parentCommits: undefined
  };
  const cmtWithParent: Commit = {
    ...commitCommon,
    commitTime: new Date(2674),
    parentCommits: [cmt]
  };

  describe("#commitWithChildrenFromJson", () => {
    it("reproduces a json dumped commit", () => {
      commitWithChildrenFromJson(
        JSON.parse(JSON.stringify(cmtWithChildren))
      ).should.deep.equal(cmtWithChildren);
    });
  });

  describe("#isCommitWithHashes", () => {
    it("correctly identifies a CommitWithHashes", () => {
      isCommitWithHashes(cmtWithHashes).should.equal(true);
    });

    it("correctly identifies a CommitWithChildren", () => {
      isCommitWithHashes(cmtWithChildren).should.equal(false);
    });

    it("correctly identifies a Commit", () => {
      isCommitWithHashes(cmt).should.equal(false);
    });
  });

  describe("#isCommitWithChildren", () => {
    it("correctly identifies a CommitWithHashes", () => {
      isCommitWithChildren(cmtWithHashes).should.equal(false);
    });

    it("correctly identifies a CommitWithChildren", () => {
      isCommitWithChildren(cmtWithChildren).should.equal(true);
    });

    it("correctly identifies a Commit", () => {
      isCommitWithChildren(cmt).should.equal(false);
    });
  });

  describe("#commitToCommitWithHashes", () => {
    it("leaves a CommitWithHashes untouched", () => {
      commitToCommitWithHashes(cmtWithHashes).should.equal(cmtWithHashes);
    });

    it("leaves a CommitWithChildren untouched", () => {
      commitToCommitWithHashes(cmtWithChildren).should.equal(cmtWithChildren);
    });

    it("converts a Commit", () => {
      commitToCommitWithHashes(cmt).should.deep.equal({
        ...commitCommon,
        commitTime: new Date(1337),
        parentCommits: []
      });
      commitToCommitWithHashes(cmtWithParent).should.deep.equal({
        ...commitCommon,
        commitTime: new Date(2674),
        parentCommits: [getCommitKey(cmt)]
      });
    });
  });

  describe("#getCommitKey", () => {
    it("creates a unique commit key", () => {
      getCommitKey(cmt).should.deep.equal("bar/foo@uiaeasdf");
    });
  });

  describe("#getBranchName", () => {
    it("creates a unique branch name", () => {
      getBranchName(cmt).should.deep.equal("bar/foo");
    });
  });

  describe("commitKeyToBranchName", () => {
    it("reconstructs the branch name from a commit key", () => {
      commitKeyToBranchName(getCommitKey(cmt)).should.deep.equal(
        getBranchName(cmt)
      );
    });
  });
});
