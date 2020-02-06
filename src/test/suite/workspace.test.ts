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
