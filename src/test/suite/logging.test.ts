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

import { LogLevel } from "@vscode-logging/logger";
import { afterEach, beforeEach, Context, describe, it } from "mocha";
import { createSandbox } from "sinon";
import * as vscode from "vscode";
import { DisposableBase } from "../../base-components";
import { CONFIGURATION_EXTENSION_NAME } from "../../constants";
import { LOG_LEVEL_SETTING, setupLogger } from "../../logging";
import {
  castToAsyncFunc,
  castToFunc,
  executeAndWaitForEvent
} from "./test-utils";
import { getTmpPrefix } from "./utilities";

class LoggingFixture extends DisposableBase {
  public sandbox = createSandbox();

  public getExtensionLoggerStub = this.sandbox.stub();
  public fakeLogger = { changeLevel: this.sandbox.stub() };

  public fakeContext: vscode.ExtensionContext = ({
    subscriptions: [],
    logUri: vscode.Uri.file(getTmpPrefix())
  } as unknown) as vscode.ExtensionContext;

  public initialLogLevel?: LogLevel;

  public constructor() {
    super();
    this.initialLogLevel = vscode.workspace
      .getConfiguration(CONFIGURATION_EXTENSION_NAME)
      .get(LOG_LEVEL_SETTING);
    this.getExtensionLoggerStub.onCall(0).returns(this.fakeLogger);
  }

  public async setLogLevel(logLevel: LogLevel): Promise<void> {
    await vscode.workspace
      .getConfiguration(CONFIGURATION_EXTENSION_NAME)
      .update(LOG_LEVEL_SETTING, logLevel, vscode.ConfigurationTarget.Global);
  }

  public async afterEach(): Promise<void> {
    if (this.initialLogLevel !== undefined) {
      await this.setLogLevel(this.initialLogLevel);
    }
    this.sandbox.restore();
    this.disposables.push(...this.fakeContext.subscriptions);
    this.dispose();
  }
}

type TestCtx = Context & { fixture: LoggingFixture };

describe("logging", () => {
  beforeEach(function () {
    this.fixture = new LoggingFixture();
  });
  afterEach(async function () {
    await this.fixture.afterEach();
  });

  describe("#setupLogger", () => {
    it(
      "creates a new logger",
      castToFunc<TestCtx>(function () {
        setupLogger(this.fixture.fakeContext, {
          getExtensionLoggerFunc: this.fixture.getExtensionLoggerStub
        }).should.deep.equal(this.fixture.fakeLogger);
      })
    );

    it(
      "creates a new logger in debug mode",
      castToFunc<TestCtx>(function () {
        setupLogger(this.fixture.fakeContext, {
          debugMode: true,
          getExtensionLoggerFunc: this.fixture.getExtensionLoggerStub
        }).should.deep.equal(this.fixture.fakeLogger);

        this.fixture.getExtensionLoggerStub.should.have.callCount(1);
        const options = this.fixture.getExtensionLoggerStub.getCall(0).args[0];
        options.should.deep.include({
          logPath: this.fixture.fakeContext.logUri.fsPath,
          level: "trace",
          logConsole: true,
          sourceLocationTracking: true
        });
      })
    );

    it(
      "creates a new logger in non debug mode by default",
      castToFunc<TestCtx>(function () {
        setupLogger(this.fixture.fakeContext, {
          getExtensionLoggerFunc: this.fixture.getExtensionLoggerStub
        }).should.deep.equal(this.fixture.fakeLogger);

        this.fixture.getExtensionLoggerStub.should.have.callCount(1);
        const options = this.fixture.getExtensionLoggerStub.getCall(0).args[0];
        options.should.deep.include({
          logPath: this.fixture.fakeContext.logUri.fsPath,
          level: "error"
        });
      })
    );

    it(
      "creates a new logger in non debug mode and takes the log level from the settings",
      castToAsyncFunc<TestCtx>(async function () {
        await this.fixture.setLogLevel("info");

        setupLogger(this.fixture.fakeContext, {
          getExtensionLoggerFunc: this.fixture.getExtensionLoggerStub
        }).should.deep.equal(this.fixture.fakeLogger);

        this.fixture.getExtensionLoggerStub.should.have.callCount(1);
        const options = this.fixture.getExtensionLoggerStub.getCall(0).args[0];
        options.should.deep.include({
          logPath: this.fixture.fakeContext.logUri.fsPath,
          level: "info"
        });
      })
    );

    it(
      "updates the log level when the settings change",
      castToAsyncFunc<TestCtx>(async function () {
        setupLogger(this.fixture.fakeContext, {
          getExtensionLoggerFunc: this.fixture.getExtensionLoggerStub
        }).should.deep.equal(this.fixture.fakeLogger);

        this.fixture.getExtensionLoggerStub.should.have.callCount(1);
        const options = this.fixture.getExtensionLoggerStub.getCall(0).args[0];
        options.should.deep.include({ level: "error" });

        await executeAndWaitForEvent(
          () => this.fixture.setLogLevel("info"),
          vscode.workspace.onDidChangeConfiguration
        );

        this.fixture.fakeLogger.changeLevel.should.have.callCount(1);
        this.fixture.fakeLogger.changeLevel.should.have.been.calledOnceWithExactly(
          "info"
        );
      })
    );
  });
});
