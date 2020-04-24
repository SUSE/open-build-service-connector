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

import { Context } from "mocha";
import * as obs_ts from "obs-ts";
import { createSandbox } from "sinon";
import { ImportMock } from "ts-mock-imports";
import { AccountMapInitializer, FakeAccountManager } from "./fakes";
import { createStubbedVscodeWindow, LoggingFixture } from "./test-utils";

export class ProjectViewFixture extends LoggingFixture {
  public fakeAccountManager?: FakeAccountManager;

  public readonly sandbox = createSandbox();
  public readonly vscodeWindow = createStubbedVscodeWindow(this.sandbox);

  public readonly fetchProjectMock = ImportMock.mockFunction(
    obs_ts,
    "fetchProject"
  );

  public readonly fetchPackageMock = ImportMock.mockFunction(
    obs_ts,
    "fetchPackage"
  );

  // constructor(ctx: Context) {
  //   super(ctx);
  // }

  public createFakeAccountManager(
    initialAccountMap?: AccountMapInitializer
  ): void {
    this.fakeAccountManager = new FakeAccountManager(initialAccountMap);
  }

  public afterEach(ctx: Context) {
    this.sandbox.restore();
    this.fetchProjectMock.restore();
    this.fetchPackageMock.restore();

    super.afterEach(ctx);
    this.dispose();
  }
}
