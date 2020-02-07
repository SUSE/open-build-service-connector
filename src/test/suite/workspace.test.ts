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

import { logger, makeFakeEvent } from "./test-utils";
import { describe, it, beforeEach, afterEach } from "mocha";
import { createSandbox } from "sinon";
import { WorkspaceToProjectMatcher } from "../../workspace";
import * as obs_ts from "obs-ts";
import { ApiAccountMapping } from "../../accounts";

class WorkspaceToProjectMatcherFixture {
  public readonly fakeCurrentConnection = makeFakeEvent<ApiAccountMapping>();

  public createWorkspaceToProjectMatcher(): WorkspaceToProjectMatcher {
    const [
      ws2Proj,
      delayedInit
    ] = WorkspaceToProjectMatcher.createWorkspaceToProjectMatcher(
      this.fakeCurrentConnection.event,
      logger
    );
    return ws2Proj;
  }

  public tearDown() {
    // this.fakeCurrentConnection.
  }
}

describe("WorkspaceToProjectMatcher", () => {
  beforeEach(function() {
    this.fixture = new WorkspaceToProjectMatcherFixture();
  });

  afterEach(function() {
    this.fixture.tearDown();
  });

  describe("#createWorkspaceToProjectMatcher", () => {
    it("");
  });

  describe("#getProjectForTextdocument", () => {});
});
