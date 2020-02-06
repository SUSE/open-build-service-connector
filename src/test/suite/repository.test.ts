import { logger, createStubbedVscodeWindow, makeFakeEvent } from "./test-utils";
import { describe, it, beforeEach, afterEach } from "mocha";
import { createSandbox } from "sinon";
import { RepositoryTreeProvider } from "../../repository";
import { VscodeWindow } from "../../vscode-dep";
import { ApiAccountMapping } from "../../accounts";
import * as obs_ts from "obs-ts";

class RepositoryTreeProviderFixture {
  public readonly fakeCurrentConnection = makeFakeEvent<ApiAccountMapping>();
  public readonly fakeActiveProject = makeFakeEvent<
    obs_ts.Project | undefined
  >();

  public readonly sandbox = createSandbox();

  public readonly mockMemento = {
    get: this.sandbox.stub(),
    update: this.sandbox.stub()
  };

  public readonly vscodeWindow: VscodeWindow = createStubbedVscodeWindow(
    this.sandbox
  );

  public createRepositoryTreeProvider(): RepositoryTreeProvider {
    return new RepositoryTreeProvider(
      this.fakeActiveProject.event,
      this.fakeCurrentConnection.event,
      logger,
      this.vscodeWindow
    );
  }

  public tearDown() {
    this.sandbox.restore();
  }
}

describe("RepositoryTreeProvider", () => {
  beforeEach(function() {
    this.fixture = new RepositoryTreeProviderFixture();
  });

  afterEach(function() {
    this.fixture.tearDown();
  });

  describe("#getChildren", () => {});
});
