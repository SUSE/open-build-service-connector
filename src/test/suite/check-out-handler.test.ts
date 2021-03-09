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

import * as assert from "assert";
import { expect } from "chai";
import { promises as fsPromises } from "fs";
import { afterEach, beforeEach, describe, it, xit } from "mocha";
import { Connection, pathExists, PathType } from "open-build-service-api";
import { join } from "path";
import { createSandbox, match } from "sinon";
import * as vscode from "vscode";
import {
  BookmarkedPackageTreeElement,
  BookmarkedProjectTreeElement
} from "../../bookmark-tree-view";
import { BookmarkState } from "../../bookmarks";
import { CheckOutHandler } from "../../check-out-handler";
import { RemotePackageFileContentProvider } from "../../package-file-contents";
import { AccountMapInitializer, FakeAccountManager } from "./fakes";
import {
  barPkg,
  barPkgWithFiles,
  barProj,
  fakeAccount1,
  fakeApi1ValidAcc,
  fileA
} from "./test-data";
import {
  castToAsyncFunc,
  createStubbedObsFetchers,
  createStubbedVscodeWindow,
  LoggingFixture,
  testLogger
} from "./test-utils";
import { getTmpPrefix, safeRmRf } from "./utilities";

class CheckOutHandlerFixture extends LoggingFixture {
  public fakeAccountManager?: FakeAccountManager;
  public readonly sandbox = createSandbox();
  public readonly vscodeWindow = createStubbedVscodeWindow(this.sandbox);
  public readonly obsFetchers = createStubbedObsFetchers(this.sandbox);
  public readonly executeCommand = this.sandbox.stub();
  public tmpPath?: string;

  public createCheckOutHandler(
    initialAccountMap?: AccountMapInitializer
  ): CheckOutHandler {
    this.fakeAccountManager = new FakeAccountManager(initialAccountMap);

    const checkOutHandler = new CheckOutHandler(
      this.fakeAccountManager,
      testLogger,
      this.vscodeWindow,
      this.obsFetchers,
      this.executeCommand
    );
    this.disposables.push(checkOutHandler, this.fakeAccountManager);
    return checkOutHandler;
  }

  public async beforeEach(): Promise<void> {
    const prefix = join(getTmpPrefix(), "obs-connector");
    this.tmpPath = await fsPromises.mkdtemp(prefix);
  }

  public async afterEach(ctx: Mocha.Context): Promise<void> {
    assert(this.tmpPath !== undefined);
    await safeRmRf(this.tmpPath);
    this.tmpPath = undefined;

    this.sandbox.restore();
    this.dispose();
    super.afterEach(ctx);
  }
}

type TestCtx = Mocha.Context & {
  fixture: CheckOutHandlerFixture;
  expectedCheckOutPath?: string;
};

describe("CheckOutHandler", () => {
  beforeEach(async function () {
    const fixture = new CheckOutHandlerFixture(this);
    await fixture.beforeEach();

    this.fixture = fixture;
  });

  afterEach(async function () {
    await this.fixture.afterEach(this);
  });

  describe("#checkOutPackageInteractively", () => {
    it(
      "does nothing if no accounts are defined",
      castToAsyncFunc<TestCtx>(async function () {
        const handler = this.fixture.createCheckOutHandler();
        await handler
          .checkOutPackageInteractively()
          .should.eventually.equal(undefined);

        await handler
          .checkOutPackageInteractively(
            RemotePackageFileContentProvider.packageFileToUri(
              fakeAccount1.apiUrl,
              fileA
            )
          )
          .should.eventually.equal(undefined);

        await handler
          .checkOutPackageInteractively(
            new BookmarkedPackageTreeElement({
              ...barPkgWithFiles,
              state: BookmarkState.Ok
            })
          )
          .should.eventually.equal(undefined);
      })
    );

    describe("check out barPkg", () => {
      beforeEach(function () {
        // HACK: checkOutPackage actually returns a ModifiedPackage, but we
        // don't use the result of that anyway (at least atm)
        this.fixture.obsFetchers.checkOutPackage.onCall(0).resolves(barPkg);
        this.fixture.vscodeWindow.withProgress.onCall(0).resolves(undefined);
        assert(this.fixture.tmpPath !== undefined);
        this.fixture.vscodeWindow.showOpenDialog
          .onCall(0)
          .resolves([vscode.Uri.file(this.fixture.tmpPath!)]);
        this.fixture.vscodeWindow.showInformationMessage
          .onCall(0)
          .resolves("No");
        this.expectedCheckOutPath = join(this.fixture.tmpPath!, barPkg.name);
      });

      const checkMocks = async function (ctx: TestCtx) {
        ctx.fixture.vscodeWindow.withProgress
          .getCall(0)
          .args[1].should.be.a("function");
        await ctx.fixture.vscodeWindow.withProgress.getCall(0).args[1]();

        ctx.fixture.obsFetchers.checkOutPackage.should.have.callCount(1);
        ctx.fixture.obsFetchers.checkOutPackage.should.have.been.calledWithMatch(
          match.instanceOf(Connection),
          barPkg.projectName,
          barPkg.name,
          ctx.expectedCheckOutPath!
        );

        ctx.fixture.vscodeWindow.withProgress.should.have.callCount(1);
        ctx.fixture.vscodeWindow.showOpenDialog.should.have.callCount(1);
        const callArgs = ctx.fixture.vscodeWindow.showOpenDialog.getCall(0)
          .args;
        expect(callArgs).to.be.a("array").and.have.lengthOf(1);
        callArgs[0].should.deep.include({
          openLabel: "Folder where the package should be checked out"
        });

        ctx.fixture.vscodeWindow.showInformationMessage.should.have.been.calledOnceWith(
          "Open the checked out Package now?"
        );
      };

      it(
        "infers the package name from a URI",
        castToAsyncFunc<TestCtx>(async function () {
          const handler = this.fixture.createCheckOutHandler([
            [fakeAccount1.apiUrl, fakeApi1ValidAcc]
          ]);
          await handler
            .checkOutPackageInteractively(
              RemotePackageFileContentProvider.packageFileToUri(
                fakeAccount1.apiUrl,
                fileA
              )
            )
            .should.eventually.equal(this.expectedCheckOutPath!);

          await checkMocks(this);
        })
      );

      it(
        "checks out the package belonging to the package bookmark element",
        castToAsyncFunc<TestCtx>(async function () {
          const handler = this.fixture.createCheckOutHandler([
            [fakeAccount1.apiUrl, fakeApi1ValidAcc]
          ]);

          await handler
            .checkOutPackageInteractively(
              new BookmarkedPackageTreeElement({
                ...barPkg,
                state: BookmarkState.Ok
              })
            )
            .should.eventually.equal(this.expectedCheckOutPath);
          await checkMocks(this);
        })
      );

      xit(
        "asks the user to provide the package name interactively",
        castToAsyncFunc<TestCtx>(async function () {
          const handler = this.fixture.createCheckOutHandler([
            [fakeAccount1.apiUrl, fakeApi1ValidAcc]
          ]);

          // we have to mock out the comboBoxInput…

          await handler
            .checkOutPackageInteractively()
            .should.eventually.equal(this.expectedCheckOutPath);
          await checkMocks(this);
        })
      );

      it(
        "opens the new folder after the check out",
        castToAsyncFunc<TestCtx>(async function () {
          const handler = this.fixture.createCheckOutHandler([
            [fakeAccount1.apiUrl, fakeApi1ValidAcc]
          ]);

          this.fixture.vscodeWindow.showInformationMessage
            .onCall(0)
            .resolves("Yes");

          await handler
            .checkOutPackageInteractively(
              new BookmarkedPackageTreeElement({
                ...barPkg,
                state: BookmarkState.Ok
              })
            )
            .should.eventually.equal(this.expectedCheckOutPath);
          await checkMocks(this);
          this.fixture.executeCommand.should.have.been.calledWithMatch(
            "vscode.openFolder",
            match(vscode.Uri.file(this.expectedCheckOutPath!))
          );
        })
      );

      it(
        "aborts if there is a folder in the way",
        castToAsyncFunc<TestCtx>(async function () {
          const handler = this.fixture.createCheckOutHandler([
            [fakeAccount1.apiUrl, fakeApi1ValidAcc]
          ]);

          await fsPromises.mkdir(this.expectedCheckOutPath!);

          await handler
            .checkOutPackageInteractively(
              new BookmarkedPackageTreeElement({
                ...barPkg,
                state: BookmarkState.Ok
              })
            )
            .should.eventually.equal(undefined);

          this.fixture.vscodeWindow.withProgress.should.have.callCount(0);
          this.fixture.vscodeWindow.showInformationMessage.should.have.callCount(
            0
          );

          this.fixture.vscodeWindow.showErrorMessage.should.have.callCount(1);
          this.fixture.vscodeWindow.showErrorMessage.should.have.been.calledWithMatch(
            `Cannot check out ${barPkg.projectName}/${barPkg.name} to ${this
              .fixture.tmpPath!}: already contains ${barPkg.name}`
          );
        })
      );
    });
  });

  describe("#checkOutProjectInteractively", () => {
    it(
      "does not fail if no accounts are configured",
      castToAsyncFunc<TestCtx>(async function () {
        const handler = this.fixture.createCheckOutHandler();
        await handler
          .checkOutProjectInteractively(
            new BookmarkedProjectTreeElement({
              ...barProj,
              packages: undefined,
              state: BookmarkState.Ok
            })
          )
          .should.eventually.equal(undefined);
      })
    );

    describe("checks out barProj", () => {
      const fakeToken = { cancellationRequested: false };
      const fakeProgress = { report: () => {} };
      beforeEach(function () {
        this.fixture.obsFetchers.checkOutProject.onCall(0).resolves(true);
        this.fixture.vscodeWindow.withProgress
          .onCall(0)
          .callsArgWith(1, fakeProgress, fakeToken);

        // this.fixture.vscodeWindow.withProgress.onCall(0).resolves(undefined);
        assert(this.fixture.tmpPath !== undefined);
        this.fixture.vscodeWindow.showOpenDialog
          .onCall(0)
          .resolves([vscode.Uri.file(this.fixture.tmpPath!)]);
        this.fixture.vscodeWindow.showInformationMessage
          .onCall(0)
          .resolves("No");
        this.expectedCheckOutPath = join(this.fixture.tmpPath!, barProj.name);
      });

      const checkMocks = async (
        ctx: TestCtx,
        {
          checkoutSucceded,
          execCmdCallCnt
        }: { checkoutSucceded?: boolean; execCmdCallCnt?: 0 | 1 } = {
          checkoutSucceded: true,
          execCmdCallCnt: 0
        }
      ) => {
        const success = checkoutSucceded ?? true;

        ctx.fixture.vscodeWindow.showOpenDialog.should.have.callCount(1);
        ctx.fixture.vscodeWindow.showOpenDialog
          .getCall(0)
          .args[0].should.include({
            openLabel: "Folder where the project should be checked out"
          });

        ctx.fixture.vscodeWindow.showInformationMessage.should.have.callCount(
          success ? 1 : 0
        );
        if (success) {
          ctx.fixture.vscodeWindow.showInformationMessage.should.have.been.calledOnceWithExactly(
            "Open the checked out project now?",
            "Yes",
            "No"
          );
        }

        ctx.fixture.vscodeWindow.withProgress.should.have.callCount(1);
        ctx.fixture.vscodeWindow.showQuickPick.should.have.callCount(0);

        ctx.fixture.obsFetchers.checkOutProject.should.have.callCount(1);
        ctx.fixture.obsFetchers.checkOutProject.should.have.been.calledWithMatch(
          match.any,
          barProj.name,
          ctx.expectedCheckOutPath!,
          match({ cancellationToken: fakeToken })
        );

        const stat = await pathExists(
          ctx.expectedCheckOutPath!,
          PathType.Directory
        );
        if (success) {
          expect(stat).to.not.equal(undefined);
        } else {
          expect(stat).to.equal(undefined);
        }

        ctx.fixture.executeCommand.should.have.callCount(execCmdCallCnt ?? 0);
      };

      it(
        "infers the project name from a bookmarked project item",
        castToAsyncFunc<TestCtx>(async function () {
          const handler = this.fixture.createCheckOutHandler([
            [fakeAccount1.apiUrl, fakeApi1ValidAcc]
          ]);

          await handler
            .checkOutProjectInteractively(
              new BookmarkedProjectTreeElement({
                ...barProj,
                packages: undefined,
                state: BookmarkState.Ok
              })
            )
            .should.eventually.equal(this.expectedCheckOutPath!);

          await checkMocks(this);
        })
      );

      it(
        "opens the checked out folder when the user wishes",
        castToAsyncFunc<TestCtx>(async function () {
          const handler = this.fixture.createCheckOutHandler([
            [fakeAccount1.apiUrl, fakeApi1ValidAcc]
          ]);

          this.fixture.vscodeWindow.showInformationMessage
            .onCall(0)
            .resolves("Yes");
          await handler
            .checkOutProjectInteractively(
              new BookmarkedProjectTreeElement({
                ...barProj,
                packages: undefined,
                state: BookmarkState.Ok
              })
            )
            .should.eventually.equal(this.expectedCheckOutPath!);

          await checkMocks(this, { execCmdCallCnt: 1 });
          this.fixture.executeCommand.should.have.been.calledWithMatch(
            "vscode.openFolder",
            match(vscode.Uri.file(this.expectedCheckOutPath!))
          );
        })
      );

      it(
        "cleans up the checkout path if the user cancels the process",
        castToAsyncFunc<TestCtx>(async function () {
          const handler = this.fixture.createCheckOutHandler([
            [fakeAccount1.apiUrl, fakeApi1ValidAcc]
          ]);

          this.fixture.obsFetchers.checkOutProject.onCall(0).resolves(false);

          await handler
            .checkOutProjectInteractively(
              new BookmarkedProjectTreeElement({
                ...barProj,
                packages: undefined,
                state: BookmarkState.Ok
              })
            )
            .should.eventually.equal(undefined);

          await checkMocks(this, { checkoutSucceded: false });
        })
      );

      it(
        "does nothing if passed a wrong context",
        castToAsyncFunc<TestCtx>(async function () {
          const handler = this.fixture.createCheckOutHandler([
            [fakeAccount1.apiUrl, fakeApi1ValidAcc]
          ]);

          await handler
            .checkOutProjectInteractively(
              new BookmarkedPackageTreeElement({
                ...barPkg,
                state: BookmarkState.Ok
              })
            )
            .should.eventually.equal(undefined);

          this.fixture.vscodeWindow.showOpenDialog.should.have.callCount(0);
          this.fixture.vscodeWindow.withProgress.should.have.callCount(0);
          this.fixture.vscodeWindow.showQuickPick.should.have.callCount(0);
          this.fixture.obsFetchers.checkOutProject.should.have.callCount(0);

          await pathExists(
            this.expectedCheckOutPath!,
            PathType.Directory
          ).should.eventually.equal(undefined);
        })
      );

      it(
        "aborts if there is already a directory in the way",
        castToAsyncFunc<TestCtx>(async function () {
          const handler = this.fixture.createCheckOutHandler([
            [fakeAccount1.apiUrl, fakeApi1ValidAcc]
          ]);

          await fsPromises.mkdir(this.expectedCheckOutPath!);

          await handler
            .checkOutProjectInteractively(
              new BookmarkedProjectTreeElement({
                ...barProj,
                packages: undefined,
                state: BookmarkState.Ok
              })
            )
            .should.eventually.equal(undefined);

          this.fixture.vscodeWindow.showOpenDialog.should.have.callCount(1);
          this.fixture.vscodeWindow.showErrorMessage.should.have.callCount(1);
          this.fixture.vscodeWindow.showErrorMessage.should.have.been.calledWithMatch(
            `Cannot check out ${barProj.name} to ${this.fixture
              .tmpPath!}: already contains ${barProj.name}`
          );
          this.fixture.vscodeWindow.withProgress.should.have.callCount(0);
          this.fixture.vscodeWindow.showQuickPick.should.have.callCount(0);
          this.fixture.obsFetchers.checkOutProject.should.have.callCount(0);
        })
      );
    });
  });
});
