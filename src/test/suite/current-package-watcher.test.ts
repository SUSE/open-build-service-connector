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
import { ModifiedPackage } from "open-build-service-api";
import { sleep } from "open-build-service-api/lib/util";
import { join } from "path";
import { createSandbox, match } from "sinon";
import * as vscode from "vscode";
import {
  CurrentPackageWatcher,
  CurrentPackageWatcherImpl,
  EDITOR_CHANGE_DELAY_MS,
  EMPTY_CURRENT_PACKAGE
} from "../../current-package-watcher";
import { createTestTempDir } from "../../ui-tests/util";
import { isUri } from "../../util";
import {
  AccountMapInitializer,
  createFakeWorkspaceFolder,
  createStubbedTextEditor,
  FakeAccountManager,
  FakeVscodeWorkspace,
  FakeWatcherType
} from "./fakes";
import { ProjectBookmarkManagerFixture } from "./project-bookmarks.test";
import { fakeAccount1, fakeApi1ValidAcc } from "./test-data";
import {
  castToAsyncFunc,
  createStubbedObsFetchers,
  createStubbedVscodeWindow,
  testLogger
} from "./test-utils";
import { safeRmRf } from "./utilities";

class CurrentPackageWatcherFixture extends ProjectBookmarkManagerFixture {
  public fakeAccountManager?: FakeAccountManager;

  public currentPackageWatcher: CurrentPackageWatcher | undefined = undefined;

  public sandbox = createSandbox();

  public vscodeWindow = createStubbedVscodeWindow(this.sandbox);

  public vscodeWorkspace = new FakeVscodeWorkspace(this.sandbox);

  public obsFetchers = createStubbedObsFetchers(this.sandbox);

  public getPackageFsWatchers(): FakeWatcherType[] {
    return this.vscodeWorkspace.fakeWatchers.filter((w) =>
      typeof w.globPattern !== "string"
        ? /* project fs watchers include the .osc folder in the pattern */
          w.globPattern.pattern.indexOf(".osc") === -1
        : false
    );
  }

  public async createCurrentPackageWatcher(
    initialAccountMap?: AccountMapInitializer,
    activeTextEditor?: vscode.TextEditor,
    visibleTextEditors: vscode.TextEditor[] = []
  ): Promise<CurrentPackageWatcher> {
    await this.createProjectBookmarkManager({ initialAccountMap });
    this.vscodeWindow.activeTextEditor = activeTextEditor;
    this.vscodeWindow.visibleTextEditors = visibleTextEditors;
    this.currentPackageWatcher = await CurrentPackageWatcherImpl.createCurrentPackageWatcher(
      this.fakeAccountManager!,
      testLogger,
      this.projectBookmarkManager!,
      this.vscodeWindow,
      this.vscodeWorkspace,
      this.obsFetchers
    );

    if (activeTextEditor !== undefined) {
      await sleep(1.5 * EDITOR_CHANGE_DELAY_MS);
    }

    this.disposables.push(this.currentPackageWatcher);

    return this.currentPackageWatcher;
  }
}

type TestCtx = Context & { fixture: CurrentPackageWatcherFixture };

describe("CurrentPackageWatcher", () => {
  beforeEach(async function () {
    const fixture = new CurrentPackageWatcherFixture(this);
    await fixture.beforeEach();
    this.fixture = fixture;
  });

  afterEach(async function () {
    await this.fixture.afterEach(this);
  });

  describe("no package open", () => {
    it(
      "has no package set as the default",
      castToAsyncFunc<TestCtx>(async function () {
        const watcher = await this.fixture.createCurrentPackageWatcher();
        expect(watcher.currentPackage).to.deep.equal(EMPTY_CURRENT_PACKAGE);
      })
    );

    it(
      "sets no package if the active editor changes to undefined",
      castToAsyncFunc<TestCtx>(async function () {
        const watcher = await this.fixture.createCurrentPackageWatcher();

        const spy = this.fixture.sandbox.spy();
        watcher.onDidChangeCurrentPackage(spy);
        expect(watcher.currentPackage).to.deep.equal(EMPTY_CURRENT_PACKAGE);

        this.fixture.vscodeWindow.onDidChangeActiveTextEditorEmiter.fire(
          undefined
        );

        expect(watcher.currentPackage).to.deep.equal(EMPTY_CURRENT_PACKAGE);
        spy.should.have.callCount(0);
      })
    );

    it(
      "does not fire the event when a TextEditor is opened without a package",
      castToAsyncFunc<TestCtx>(async function () {
        const watcher = await this.fixture.createCurrentPackageWatcher();

        const spy = this.fixture.sandbox.spy();
        watcher.onDidChangeCurrentPackage(spy);

        await this.fixture.vscodeWindow.onDidChangeActiveTextEditorEmiter.fire(
          createStubbedTextEditor(
            this.fixture.sandbox,
            vscode.Uri.file("/path/to/something")
          )
        );

        expect(watcher.currentPackage).to.deep.equal(EMPTY_CURRENT_PACKAGE);
        spy.should.have.callCount(0);
      })
    );
  });

  describe("locally checked out package", () => {
    const projectName = "test-project";
    const packageName = "test-package";
    let tmpDir: string;

    type LocalFileCtx = TestCtx & {
      fooFileEditor: ReturnType<typeof createStubbedTextEditor>;
    };

    const basePkg = {
      name: packageName,
      projectName,
      apiUrl: fakeAccount1.apiUrl
    };
    const baseProj = {
      name: projectName,
      apiUrl: fakeAccount1.apiUrl
    };

    const getBasePkg = () => ({ ...basePkg, path: tmpDir });

    beforeEach(async function () {
      tmpDir = await createTestTempDir();
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
      this.fixture.obsFetchers.fetchPackage
        .withArgs(
          match(fakeApi1ValidAcc.connection),
          projectName,
          packageName,
          match({ retrieveFileContents: match.bool })
        )
        .resolves({ basePkg, files: [], meta: { title: "", description: "" } });
      this.fixture.obsFetchers.fetchProject
        .withArgs(
          match(fakeApi1ValidAcc.connection),
          projectName,
          match({ fetchPackageList: true })
        )
        .resolves({
          ...baseProj,
          meta: { name: projectName, title: "", description: "" },
          packages: [basePkg]
        });
    });

    afterEach(() => safeRmRf(tmpDir));

    it(
      "finds a locally checked out package",
      castToAsyncFunc<LocalFileCtx>(async function () {
        const watcher = await this.fixture.createCurrentPackageWatcher([
          [fakeAccount1.apiUrl, fakeApi1ValidAcc]
        ]);

        const spy = this.fixture.sandbox.spy();

        watcher.onDidChangeCurrentPackage(spy);

        await this.fixture.vscodeWindow.onDidChangeActiveTextEditorEmiter.fire(
          this.fooFileEditor
        );

        await sleep(1.5 * EDITOR_CHANGE_DELAY_MS);

        spy.should.have.callCount(1);
        spy.should.have.been.calledOnceWithExactly(watcher.currentPackage);

        expect(watcher.currentPackage.currentPackage).to.deep.include(
          getBasePkg()
        );
        expect(watcher.currentPackage.currentProject).to.deep.include(baseProj);
        testLogger.info("%s", watcher.currentPackage.currentFilename);
        expect(watcher.currentPackage.currentFilename).to.deep.equal(
          this.fooFileEditor.document.fileName
        );
      })
    );

    it(
      "ads the locally checked out package on launch into the registered packages",
      castToAsyncFunc<LocalFileCtx>(async function () {
        const watcher = await this.fixture.createCurrentPackageWatcher(
          [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
          this.fooFileEditor,
          [this.fooFileEditor]
        );

        const spy = this.fixture.sandbox.spy();

        watcher.onDidChangeCurrentPackage(spy);

        spy.should.have.callCount(0);

        expect(watcher.currentPackage.currentPackage).to.deep.include(
          getBasePkg()
        );
      })
    );

    // FIXME
    xit(
      "does not fire the event for untracked URI schemes",
      castToAsyncFunc<LocalFileCtx>(async function () {
        const watcher = await this.fixture.createCurrentPackageWatcher([
          [fakeAccount1.apiUrl, fakeApi1ValidAcc]
        ]);

        const spy = this.fixture.sandbox.spy();

        watcher.onDidChangeCurrentPackage(spy);

        await this.fixture.vscodeWindow.onDidChangeActiveTextEditorEmiter.fire(
          createStubbedTextEditor(
            this.fixture.sandbox,
            vscode.Uri.file(join(tmpDir, "foo")).with({ scheme: "someScheme" })
          )
        );

        await sleep(1.5 * EDITOR_CHANGE_DELAY_MS);
        expect(watcher.currentPackage).to.deep.equal(EMPTY_CURRENT_PACKAGE);
        spy.should.have.callCount(0);
      })
    );

    it(
      "registers when a file changes in the package",
      castToAsyncFunc<LocalFileCtx>(async function () {
        const watcher = await this.fixture.createCurrentPackageWatcher(
          [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
          this.fooFileEditor,
          [this.fooFileEditor]
        );

        const spy = this.fixture.sandbox.spy();

        watcher.onDidChangeCurrentPackage(spy);

        const apiUrlPath = join(tmpDir, ".osc", "_apiurl");
        await fsPromises.unlink(apiUrlPath);
        await Promise.all(
          this.fixture
            .getPackageFsWatchers()
            .map((w) => w.onDidChangeEmitter.fire(vscode.Uri.file(apiUrlPath)))
        );

        // FIXME: should the file system watcher be disposed if the package is invalid?
        this.fixture
          .getPackageFsWatchers()
          .forEach((w) => w.dispose.should.have.callCount(1));

        spy.should.have.callCount(1);
        spy.should.have.been.calledOnceWith(EMPTY_CURRENT_PACKAGE);
        expect(watcher.currentPackage).to.equal(EMPTY_CURRENT_PACKAGE);
      })
    );

    it(
      "does not add broken packages",
      castToAsyncFunc<LocalFileCtx>(async function () {
        const apiUrlPath = join(tmpDir, ".osc", "_apiurl");
        await fsPromises.unlink(apiUrlPath);

        const watcher = await this.fixture.createCurrentPackageWatcher(
          [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
          this.fooFileEditor,
          [this.fooFileEditor]
        );
        expect(watcher.currentPackage).to.equal(EMPTY_CURRENT_PACKAGE);
      })
    );

    // FIXME
    xit(
      "does not emit an event when the package is unchanged",
      castToAsyncFunc<LocalFileCtx>(async function () {
        const watcher = await this.fixture.createCurrentPackageWatcher(
          [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
          this.fooFileEditor,
          [this.fooFileEditor]
        );

        expect(watcher.currentPackage.currentPackage).to.deep.include(
          getBasePkg()
        );
        const spy = this.fixture.sandbox.spy();
        watcher.onDidChangeCurrentPackage(spy);

        await Promise.all(
          this.fixture
            .getPackageFsWatchers()
            .map((w) =>
              w.onDidChangeEmitter.fire(vscode.Uri.file(join(tmpDir, ".osc")))
            )
        );

        spy.should.have.callCount(0);
        expect(watcher.currentPackage.currentPackage).to.deep.include(
          getBasePkg()
        );
      })
    );

    xit(
      "discards the package if it does not belong to a workspace",
      castToAsyncFunc<LocalFileCtx>(async function () {
        const watcher = await this.fixture.createCurrentPackageWatcher(
          [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
          this.fooFileEditor,
          [this.fooFileEditor]
        );

        expect(watcher.currentPackage).to.deep.include(getBasePkg());

        this.fixture.vscodeWorkspace.getWorkspaceFolder.reset();
        this.fixture.vscodeWorkspace.getWorkspaceFolder.returns(undefined);

        const spy = this.fixture.sandbox.spy();
        watcher.onDidChangeCurrentPackage(spy);

        await watcher.reloadCurrentPackage();

        spy.should.have.callCount(1);
        spy.should.have.been.calledOnceWithExactly(undefined);
        expect(watcher.currentPackage).to.equal(undefined);
      })
    );

    it(
      "does not register packages that do not belong to a workspace",
      castToAsyncFunc<LocalFileCtx>(async function () {
        this.fixture.vscodeWorkspace.getWorkspaceFolder.reset();
        this.fixture.vscodeWorkspace.getWorkspaceFolder.returns(undefined);
        const watcher = await this.fixture.createCurrentPackageWatcher(
          [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
          this.fooFileEditor,
          [this.fooFileEditor]
        );

        expect(watcher.currentPackage).to.equal(EMPTY_CURRENT_PACKAGE);
      })
    );

    describe("#reloadCurrentPackage", () => {
      // FIXME
      xit(
        "does nothing if no editor is open",
        castToAsyncFunc<TestCtx>(async function () {
          const watcher = await this.fixture.createCurrentPackageWatcher(
            [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
            this.fooFileEditor,
            [this.fooFileEditor]
          );
          const spy = this.fixture.sandbox.spy();
          watcher.onDidChangeCurrentPackage(spy);

          this.fixture.vscodeWindow.activeTextEditor = undefined;
          await watcher.reloadCurrentPackage();

          spy.should.have.callCount(0);
        })
      );

      it(
        "reloads the current package and emits the event if it changed",
        castToAsyncFunc<TestCtx>(async function () {
          const watcher = await this.fixture.createCurrentPackageWatcher(
            [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
            this.fooFileEditor,
            [this.fooFileEditor]
          );
          expect(watcher.currentPackage).to.not.equal(undefined);

          const spy = this.fixture.sandbox.spy();
          watcher.onDidChangeCurrentPackage(spy);

          // add a file
          await fsPromises.writeFile(
            join(tmpDir, "bar"),
            "nothing really in here"
          );

          await watcher.reloadCurrentPackage();

          spy.should.have.callCount(1);
          spy.should.have.been.calledOnceWith(
            match({ currentPackage: match(getBasePkg()) })
          );
          spy.should.have.been.calledOnceWithExactly(watcher.currentPackage);

          expect(watcher.currentPackage.currentPackage)
            .to.have.property("filesInWorkdir")
            .that.is.an("array")
            .and.has.length(2);
          const fnames = (watcher.currentPackage
            ?.currentPackage as ModifiedPackage).filesInWorkdir.map(
            (f) => f.name
          );
          expect(fnames).to.include.a.thing.that.equals("bar");
          expect(fnames).to.include.a.thing.that.equals("foo");
        })
      );

      it(
        "removes the current package if it got destroyed",
        castToAsyncFunc<TestCtx>(async function () {
          const watcher = await this.fixture.createCurrentPackageWatcher(
            [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
            this.fooFileEditor,
            [this.fooFileEditor]
          );
          expect(watcher.currentPackage).to.not.equal(undefined);

          const spy = this.fixture.sandbox.spy();
          watcher.onDidChangeCurrentPackage(spy);

          // destroy the package a bit
          await fsPromises.unlink(join(tmpDir, ".osc", "_apiurl"));

          await watcher.reloadCurrentPackage();

          spy.should.have.callCount(1);
          spy.should.have.been.calledOnceWith(EMPTY_CURRENT_PACKAGE);
          expect(watcher.currentPackage).to.equal(EMPTY_CURRENT_PACKAGE);
        })
      );

      // FIXME
      xit(
        "does not emit an event if the current package is unchanged",
        castToAsyncFunc<TestCtx>(async function () {
          const watcher = await this.fixture.createCurrentPackageWatcher(
            [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
            this.fooFileEditor,
            [this.fooFileEditor]
          );
          expect(watcher.currentPackage).to.not.equal(undefined);

          const spy = this.fixture.sandbox.spy();
          watcher.onDidChangeCurrentPackage(spy);
          spy.should.have.callCount(0);

          await watcher.reloadCurrentPackage();

          spy.should.have.callCount(0);
          expect(watcher.currentPackage.currentPackage).to.deep.include(
            getBasePkg()
          );
        })
      );
    });

    describe("#dispose", () => {
      it(
        "disposes of the filewatcher when disposing of the class",
        castToAsyncFunc<TestCtx>(async function () {
          const watcher = await this.fixture.createCurrentPackageWatcher(
            [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
            this.fooFileEditor,
            [this.fooFileEditor]
          );

          expect(watcher.currentPackage).to.not.equal(undefined);
          // FIXME:
          // this.fixture.vscodeWorkspace.watcher.dispose.should.have.callCount(0);

          // watcher.dispose();
          // this.fixture.vscodeWorkspace.watcher.dispose.should.have.callCount(1);
        })
      );
    });
  });
});
