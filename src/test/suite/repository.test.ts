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

import { afterEach, beforeEach, describe } from "mocha";
import * as obs_ts from "obs-ts";
import { createSandbox } from "sinon";
import { ApiUrl, ActiveAccounts } from "../../accounts";
import { RepositoryTreeProvider } from "../../repository";
import { VscodeWindow } from "../../vscode-dep";
import {
  createStubbedVscodeWindow,
  testLogger,
  makeFakeEvent,
  FakeActiveAccounts
} from "./test-utils";

class RepositoryTreeProviderFixture {
  public readonly fakeAccountChange = makeFakeEvent<ApiUrl[]>();
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

  public createRepositoryTreeProvider(
    activeAccounts: ActiveAccounts = new FakeActiveAccounts()
  ): RepositoryTreeProvider {
    return new RepositoryTreeProvider(
      this.fakeActiveProject.event,
      activeAccounts,
      this.fakeAccountChange.event,
      testLogger,
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
