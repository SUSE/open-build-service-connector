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
import { randomBytes } from "crypto";
import { promises as fsPromises } from "fs";
import { afterEach, beforeEach, describe, it } from "mocha";
import { tmpdir } from "os";
import { join } from "path";
import { cwd } from "process";
import * as vscode from "vscode";
import {
  assert,
  ErrorPageDocumentProvider,
  ERROR_PAGE_URI,
  SET_LAST_ERROR_COMMAND
} from "../../assert";
import { GET_LOGFILE_PATH_COMMAND } from "../../extension";
import { safeUnlink } from "../../util";
import { castToAsyncFunc, LoggingFixture, testLogger } from "./test-utils";

class ErrorPageDocumentProviderFixture extends LoggingFixture {
  public errorPageProvider: ErrorPageDocumentProvider;
  public tempfile?: string;
  public logfileCmdDisposable?: vscode.Disposable;

  public constructor(ctx: Mocha.Context) {
    super(ctx);
    this.errorPageProvider = new ErrorPageDocumentProvider(testLogger);
    this.disposables.push(this.errorPageProvider);
  }

  public async beforeEach() {
    const randStr = randomBytes(16).toString("hex");
    const tempfile = join(tmpdir(), "obs-connector-tempfile-".concat(randStr));
    await fsPromises.writeFile(tempfile, "");
    this.tempfile = tempfile;

    this.logfileCmdDisposable = vscode.commands.registerCommand(
      GET_LOGFILE_PATH_COMMAND,
      () => tempfile
    );
    this.disposables.push(this.logfileCmdDisposable);
  }

  public async afterEach(ctx: Mocha.Context) {
    super.afterEach(ctx);
    if (this.tempfile === undefined) {
      throw new Error("you forgot to call beforeEach!");
    }

    await safeUnlink(this.tempfile);
    this.dispose();
  }
}

type ErrorPageTestCtx = Mocha.Context & {
  fixture: ErrorPageDocumentProviderFixture;
};

describe("ErrorPageDocumentProvider", () => {
  beforeEach(async function () {
    this.fixture = new ErrorPageDocumentProviderFixture(this);
    await this.fixture.beforeEach();
  });

  afterEach(function () {
    return this.fixture.afterEach(this);
  });

  describe("provideTextDocumentContent", () => {
    const msg = "Whoopsie!";
    const occurenceTime = new Date(0);
    const stack = new Error(msg).stack;

    const msgRegExp = new RegExp(`message: ${msg}`, "i");

    it(
      "shows the default error",
      castToAsyncFunc<ErrorPageTestCtx>(async function () {
        const page = await this.fixture.errorPageProvider.provideTextDocumentContent(
          ERROR_PAGE_URI
        );

        page.should.match(/message: no error/i);
        page.should.not.match(/stack:/);
        page.should.not.match(/recorded on/);
      })
    );

    it(
      "shows the last error",
      castToAsyncFunc<ErrorPageTestCtx>(async function () {
        await ErrorPageDocumentProvider.setLastErrorCommand({ msg });

        const page = await this.fixture.errorPageProvider.provideTextDocumentContent(
          ERROR_PAGE_URI
        );

        page.should.match(msgRegExp);
        page.should.not.match(/stack:/);
        page.should.not.match(/recorded on:/);
      })
    );

    it(
      "shows the last error with a stack",
      castToAsyncFunc<ErrorPageTestCtx>(async function () {
        await ErrorPageDocumentProvider.setLastErrorCommand({ msg, stack });

        const page = await this.fixture.errorPageProvider.provideTextDocumentContent(
          ERROR_PAGE_URI
        );

        page.should.match(msgRegExp);
        page.should.match(/stack:/);
        page.should.not.match(/recorded on:/);
      })
    );

    it(
      "shows the last error with a occurrence time",
      castToAsyncFunc<ErrorPageTestCtx>(async function () {
        await ErrorPageDocumentProvider.setLastErrorCommand({
          msg,
          occurenceTime
        });

        const page = await this.fixture.errorPageProvider.provideTextDocumentContent(
          ERROR_PAGE_URI
        );

        page.should.match(msgRegExp);
        page.should.not.match(/stack:/);
        page.should.match(/recorded on:.*1970/);
      })
    );

    it(
      "shows an error setLastError is invoked without a parameter",
      castToAsyncFunc<ErrorPageTestCtx>(async function () {
        await vscode.commands.executeCommand(SET_LAST_ERROR_COMMAND, undefined);
        const page = await this.fixture.errorPageProvider.provideTextDocumentContent(
          ERROR_PAGE_URI
        );

        page.should.match(
          /message: command.*invoked without the parameter 'lastError'/i
        );
        page.should.match(/stack:/);
        page.should.match(/recorded on:/);
      })
    );

    it(
      "does not die when the logfile is not present",
      castToAsyncFunc<ErrorPageTestCtx>(async function () {
        await safeUnlink(this.fixture.tempfile);

        const page = await this.fixture.errorPageProvider.provideTextDocumentContent(
          ERROR_PAGE_URI
        );

        page.should.match(/message: no error/i);
        page.should.not.match(/stack:/);
        page.should.not.match(/recorded on:/);
        page.should.match(/could not read logfile/i);
      })
    );

    it(
      "does not die when the logfile's path cannot be retrieved",
      castToAsyncFunc<ErrorPageTestCtx>(async function () {
        this.fixture.logfileCmdDisposable?.dispose();

        const disp = vscode.commands.registerCommand(
          GET_LOGFILE_PATH_COMMAND,
          () => undefined
        );

        const page = await this.fixture.errorPageProvider.provideTextDocumentContent(
          ERROR_PAGE_URI
        );

        disp.dispose();

        page.should.match(/message: no error/i);
        page.should.not.match(/stack:/);
        page.should.not.match(/recorded on:/);
        page.should.match(/could not read logfile/i);
      })
    );

    it(
      "errors out if the logfile path get command is not defined",
      castToAsyncFunc<ErrorPageTestCtx>(async function () {
        this.fixture.logfileCmdDisposable?.dispose();

        await this.fixture.errorPageProvider
          .provideTextDocumentContent(ERROR_PAGE_URI)
          .should.be.rejectedWith(/command.*not found/i);
      })
    );

    it(
      "throws an error if the uri scheme is invalid",
      castToAsyncFunc<ErrorPageTestCtx>(async function () {
        await this.fixture.errorPageProvider
          .provideTextDocumentContent(vscode.Uri.file(cwd()))
          .should.be.rejectedWith(/invalid uri scheme/i);
      })
    );
  });
});

describe("#assert", () => {
  it("does nothing if the condition is true", () => {
    expect(assert(true)).to.equal(undefined);
  });

  it("does throws an error if the condition is false", () => {
    // it would be nice to also test the opening of the error page, but that is
    // unfortunately pretty hard, as we'd have to mock out a whole lot of
    // vscode's API
    expect(() => assert(false)).to.throw(/assertion failed/i);
  });
});
