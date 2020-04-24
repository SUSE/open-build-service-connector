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

import { afterEach, beforeEach, describe, it, Context } from "mocha";
import { ApiUrl } from "../../accounts";
import { WorkspaceToProjectMatcher } from "../../workspace";
import {
  FakeActiveAccounts,
  makeFakeEvent,
  testLogger,
  LoggingFixture
} from "./test-utils";

class WorkspaceToProjectMatcherFixture extends LoggingFixture {
  public readonly fakeActiveAccounts = makeFakeEvent<ApiUrl[]>();

  constructor(ctx: Context) {
    super();
    super.beforeEach(ctx);
  }

  public async createWorkspaceToProjectMatcher(): Promise<
    WorkspaceToProjectMatcher
  > {
    const [
      ws2Proj,
      delayedInit
    ] = WorkspaceToProjectMatcher.createWorkspaceToProjectMatcher(
      new FakeActiveAccounts(),
      this.fakeActiveAccounts.event,
      testLogger
    );
    await delayedInit(ws2Proj);
    return ws2Proj;
  }

  public afterEach(ctx: Context) {
    super.afterEach(ctx);
  }
}

describe("WorkspaceToProjectMatcher", () => {
    this.fixture = new WorkspaceToProjectMatcherFixture(this);
  beforeEach(function () {
  });

  afterEach(function () {
    this.fixture.afterEach();
  });

  describe("#createWorkspaceToProjectMatcher", () => {
    it("");
  });

  describe("#getProjectForTextdocument", () => {});
});
