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

import { expect } from "chai";
import { promises as fsPromises } from "fs";
import { afterEach, beforeEach, Context, describe, it, xit } from "mocha";
import { rmRf, sleep } from "open-build-service-api/lib/util";
import { tmpdir } from "os";
import { join, sep } from "path";
import { createSandbox, match } from "sinon";
import * as vscode from "vscode";
import {
  ActivePackageWatcher,
  EDITOR_CHANGE_DELAY_MS
} from "../../active-package-watcher";
import { isUri } from "../../util";
import {
  AccountMapInitializer,
  createFakeWorkspaceFolder,
  createStubbedTextEditor,
  FakeAccountManager
} from "./fakes";
import { fakeAccount1, fakeApi1ValidAcc } from "./test-data";
import {
  castToAsyncFunc,
  createStubbedVscodeWindow,
  createStubbedVscodeWorkspace,
  LoggingFixture,
  testLogger
} from "./test-utils";

class ActivePackageWatcherFixture extends LoggingFixture {
  public fakeAccountManager?: FakeAccountManager;

  public activePackageWatcher: ActivePackageWatcher | undefined = undefined;

  public sandbox = createSandbox();

  public vscodeWindow = createStubbedVscodeWindow(this.sandbox);

  public vscodeWorkspace = createStubbedVscodeWorkspace(this.sandbox);

  constructor(ctx: Context) {
    super(ctx);
  }

  public async createActivePackageWatcher(
    initialAccountMap?: AccountMapInitializer,
    activeTextEditor?: vscode.TextEditor,
    visibleTextEditors: vscode.TextEditor[] = []
  ): Promise<ActivePackageWatcher> {
    this.fakeAccountManager = new FakeAccountManager(initialAccountMap);
    this.vscodeWindow.activeTextEditor = activeTextEditor;
    this.vscodeWindow.visibleTextEditors = visibleTextEditors;
    this.activePackageWatcher = await ActivePackageWatcher.createActivePackageWatcher(
      this.fakeAccountManager,
      testLogger,
      this.vscodeWindow,
      this.vscodeWorkspace
    );

    return this.activePackageWatcher;
  }

  public afterEach(ctx: Context) {
    super.afterEach(ctx);
    this.fakeAccountManager?.dispose();
    this.activePackageWatcher?.dispose();
    this.sandbox.restore();
  }
}

type TestCtx = Context & { fixture: ActivePackageWatcherFixture };

describe("ActivePackageWatcher", () => {
  beforeEach(function () {
    this.fixture = new ActivePackageWatcherFixture(this);
  });

  afterEach(function () {
    this.fixture.afterEach(this);
  });

  describe("no package open", () => {
    it(
      "has no package set as the default",
      castToAsyncFunc<TestCtx>(async function () {
        const watcher = await this.fixture.createActivePackageWatcher();
        expect(watcher.activePackage).to.be.undefined;
      })
    );

    it(
      "has no package set as the default",
      castToAsyncFunc<TestCtx>(async function () {
        const watcher = await this.fixture.createActivePackageWatcher();

        const spy = this.fixture.sandbox.spy();
        watcher.onDidChangeActivePackage(spy);
        expect(watcher.activePackage).to.be.undefined;

        this.fixture.vscodeWindow.onDidChangeActiveTextEditorEmiter.fire(
          undefined
        );

        expect(watcher.activePackage).to.be.undefined;
        spy.should.have.callCount(0);
      })
    );

    it(
      "does not fire the event when a TextEditor is opened without a package",
      castToAsyncFunc<TestCtx>(async function () {
        const watcher = await this.fixture.createActivePackageWatcher();

        const spy = this.fixture.sandbox.spy();
        watcher.onDidChangeActivePackage(spy);

        await this.fixture.vscodeWindow.onDidChangeActiveTextEditorEmiter.fire(
          createStubbedTextEditor(
            this.fixture.sandbox,
            vscode.Uri.file("/path/to/something")
          )
        );

        expect(watcher.activePackage).to.be.undefined;
        spy.should.have.callCount(0);
      })
    );
  });

  describe("locally checked out package", () => {
    const projectName = "test-project";
    const packageName = "test-package";
    let tmpDir: string;

    const basePkg = {
      name: packageName,
      projectName,
      apiUrl: fakeAccount1.apiUrl
    };

    beforeEach(async function () {
      tmpDir = await fsPromises.mkdtemp(
        `${process.env.TMPDIR ?? tmpdir()}${sep}obs-connector`
      );
      const tmpDirUri = vscode.Uri.file(tmpDir);
      await fsPromises.mkdir(join(tmpDir, ".osc"));
      await Promise.all(
        [
          { fname: ".osc/_apiurl", contents: fakeAccount1.apiUrl },
          { fname: ".osc/_project", contents: projectName },
          { fname: ".osc/_files", contents: "<directory />" },
          { fname: ".osc/_osclib_version", contents: "1.0" },
          { fname: ".osc/_package", contents: packageName },
          { fname: "foo", contents: "foo" }
        ].map(({ fname, contents }) =>
          fsPromises.writeFile(join(tmpDir, fname), contents)
        )
      );

      this.fooFileEditor = createStubbedTextEditor(
        this.fixture.sandbox,
        vscode.Uri.file(join(tmpDir, "foo"))
      );

      this.fixture.vscodeWorkspace.getWorkspaceFolder
        .withArgs(
          match((v) => isUri(v) && v.toString() === tmpDirUri.toString())
        )
        .returns(createFakeWorkspaceFolder(tmpDirUri));
    });

    afterEach(() => rmRf(tmpDir));

    it(
      "finds a locally checked out package",
      castToAsyncFunc<TestCtx>(async function () {
        const watcher = await this.fixture.createActivePackageWatcher([
          [fakeAccount1.apiUrl, fakeApi1ValidAcc]
        ]);

        const spy = this.fixture.sandbox.spy();

        watcher.onDidChangeActivePackage(spy);

        await this.fixture.vscodeWindow.onDidChangeActiveTextEditorEmiter.fire(
          this.fooFileEditor
        );

        await sleep(1.5 * EDITOR_CHANGE_DELAY_MS);

        spy.should.have.callCount(1);
        spy.should.have.been.calledOnceWithExactly(watcher.activePackage);

        expect(watcher.activePackage).to.deep.include(basePkg);
      })
    );

    it(
      "ads the locally checked out package on launch into the registered packages",
      castToAsyncFunc<TestCtx>(async function () {
        const watcher = await this.fixture.createActivePackageWatcher(
          [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
          this.fooFileEditor,
          [this.fooFileEditor]
        );

        const spy = this.fixture.sandbox.spy();

        watcher.onDidChangeActivePackage(spy);

        spy.should.have.callCount(0);

        expect(watcher.activePackage).to.deep.include(basePkg);
      })
    );

    it(
      "does not fire the event for untracked URI schemes",
      castToAsyncFunc<TestCtx>(async function () {
        const watcher = await this.fixture.createActivePackageWatcher([
          [fakeAccount1.apiUrl, fakeApi1ValidAcc]
        ]);

        const spy = this.fixture.sandbox.spy();

        watcher.onDidChangeActivePackage(spy);

        await this.fixture.vscodeWindow.onDidChangeActiveTextEditorEmiter.fire(
          createStubbedTextEditor(
            this.fixture.sandbox,
            vscode.Uri.file(join(tmpDir, "foo")).with({ scheme: "someScheme" })
          )
        );

        await sleep(1.5 * EDITOR_CHANGE_DELAY_MS);
        expect(watcher.activePackage).to.be.undefined;
        spy.should.have.callCount(0);
      })
    );

    it(
      "registers when a file changes in the package",
      castToAsyncFunc<TestCtx>(async function () {
        const watcher = await this.fixture.createActivePackageWatcher(
          [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
          this.fooFileEditor,
          [this.fooFileEditor]
        );

        const spy = this.fixture.sandbox.spy();

        watcher.onDidChangeActivePackage(spy);

        const apiUrlPath = join(tmpDir, ".osc", "_apiurl");
        await fsPromises.unlink(apiUrlPath);
        await this.fixture.vscodeWorkspace.watcher.onDidChangeEmitter.fire(
          vscode.Uri.file(apiUrlPath)
        );

        this.fixture.vscodeWorkspace.watcher.dispose.should.have.callCount(1);
        spy.should.have.callCount(1);
        spy.should.have.been.calledOnceWith(undefined);
        expect(watcher.activePackage).to.equal(undefined);
      })
    );

    it(
      "does not add broken packages",
      castToAsyncFunc<TestCtx>(async function () {
        const apiUrlPath = join(tmpDir, ".osc", "_apiurl");
        await fsPromises.unlink(apiUrlPath);

        const watcher = await this.fixture.createActivePackageWatcher(
          [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
          this.fooFileEditor,
          [this.fooFileEditor]
        );
        expect(watcher.activePackage).to.equal(undefined);
      })
    );

    it(
      "does not emit an event when the package is unchanged",
      castToAsyncFunc<TestCtx>(async function () {
        const watcher = await this.fixture.createActivePackageWatcher(
          [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
          this.fooFileEditor,
          [this.fooFileEditor]
        );

        expect(watcher.activePackage).to.deep.include(basePkg);
        const spy = this.fixture.sandbox.spy();
        watcher.onDidChangeActivePackage(spy);

        await this.fixture.vscodeWorkspace.watcher.onDidChangeEmitter.fire(
          vscode.Uri.file(join(tmpDir, ".osc"))
        );
        spy.should.have.callCount(0);
        expect(watcher.activePackage).to.deep.include(basePkg);
      })
    );

    xit(
      "discards the package if it does not belong to a workspace",
      castToAsyncFunc<TestCtx>(async function () {
        const watcher = await this.fixture.createActivePackageWatcher(
          [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
          this.fooFileEditor,
          [this.fooFileEditor]
        );

        expect(watcher.activePackage).to.deep.include(basePkg);

        this.fixture.vscodeWorkspace.getWorkspaceFolder.reset();
        this.fixture.vscodeWorkspace.getWorkspaceFolder.returns(undefined);

        const spy = this.fixture.sandbox.spy();
        watcher.onDidChangeActivePackage(spy);

        await watcher.reloadCurrentPackage();

        spy.should.have.callCount(1);
        spy.should.have.been.calledOnceWithExactly(undefined);
        expect(watcher.activePackage).to.equal(undefined);
      })
    );

    it(
      "does not register packages that do not belong to a workspace",
      castToAsyncFunc<TestCtx>(async function () {
        this.fixture.vscodeWorkspace.getWorkspaceFolder.reset();
        this.fixture.vscodeWorkspace.getWorkspaceFolder.returns(undefined);
        const watcher = await this.fixture.createActivePackageWatcher(
          [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
          this.fooFileEditor,
          [this.fooFileEditor]
        );

        expect(watcher.activePackage).to.equal(undefined);
      })
    );

    describe("#reloadCurrentPackage", () => {
      it(
        "does nothing if no editor is open",
        castToAsyncFunc<TestCtx>(async function () {
          const watcher = await this.fixture.createActivePackageWatcher(
            [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
            this.fooFileEditor,
            [this.fooFileEditor]
          );
          const spy = this.fixture.sandbox.spy();
          watcher.onDidChangeActivePackage(spy);

          this.fixture.vscodeWindow.activeTextEditor = undefined;
          await watcher.reloadCurrentPackage();

          spy.should.have.callCount(0);
        })
      );

      it(
        "reloads the current package and emits the event if it changed",
        castToAsyncFunc<TestCtx>(async function () {
          const watcher = await this.fixture.createActivePackageWatcher(
            [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
            this.fooFileEditor,
            [this.fooFileEditor]
          );
          expect(watcher.activePackage).to.not.equal(undefined);

          const spy = this.fixture.sandbox.spy();
          watcher.onDidChangeActivePackage(spy);

          // add a file
          await fsPromises.writeFile(
            join(tmpDir, "bar"),
            "nothing really in here"
          );

          await watcher.reloadCurrentPackage();

          spy.should.have.callCount(1);
          spy.should.have.been.calledOnceWith(match(basePkg));
          spy.should.have.been.calledOnceWithExactly(watcher.activePackage);

          expect(watcher.activePackage)
            .to.have.property("filesInWorkdir")
            .that.is.an("array")
            .and.has.length(2);
          const fnames = watcher.activePackage?.filesInWorkdir.map(
            (f) => f.name
          );
          expect(fnames).to.include.a.thing.that.equals("bar");
          expect(fnames).to.include.a.thing.that.equals("foo");
        })
      );

      it(
        "removes the current package if it got destroyed",
        castToAsyncFunc<TestCtx>(async function () {
          const watcher = await this.fixture.createActivePackageWatcher(
            [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
            this.fooFileEditor,
            [this.fooFileEditor]
          );
          expect(watcher.activePackage).to.not.equal(undefined);

          const spy = this.fixture.sandbox.spy();
          watcher.onDidChangeActivePackage(spy);

          // add a file
          await fsPromises.unlink(join(tmpDir, ".osc", "_apiurl"));

          await watcher.reloadCurrentPackage();

          spy.should.have.callCount(1);
          spy.should.have.been.calledOnceWith(undefined);
          expect(watcher.activePackage).to.equal(undefined);
        })
      );

      it(
        "does not emit an event if the current package is unchanged",
        castToAsyncFunc<TestCtx>(async function () {
          const watcher = await this.fixture.createActivePackageWatcher(
            [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
            this.fooFileEditor,
            [this.fooFileEditor]
          );
          expect(watcher.activePackage).to.not.equal(undefined);

          const spy = this.fixture.sandbox.spy();
          watcher.onDidChangeActivePackage(spy);

          await watcher.reloadCurrentPackage();

          spy.should.have.callCount(0);
          expect(watcher.activePackage).to.deep.include(basePkg);
        })
      );
    });

    describe("#dispose", () => {
      it(
        "disposes of the filewatcher when disposing of the class",
        castToAsyncFunc<TestCtx>(async function () {
          const watcher = await this.fixture.createActivePackageWatcher(
            [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
            this.fooFileEditor,
            [this.fooFileEditor]
          );

          expect(watcher.activePackage).to.not.equal(undefined);
          this.fixture.vscodeWorkspace.watcher.dispose.should.have.callCount(0);

          watcher.dispose();
          this.fixture.vscodeWorkspace.watcher.dispose.should.have.callCount(1);
        })
      );
    });
  });
});
