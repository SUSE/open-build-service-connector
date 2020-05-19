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

const mockFs = require("mock-fs");

import { Context, describe } from "mocha";
import { Project } from "open-build-service-api";
import * as vscode from "vscode";
import { ApiUrl } from "../../accounts";
import { ProjectBookmarkManager } from "../../project-bookmarks";
import { AccountMapInitializer } from "./fakes";
import { ProjectViewFixture } from "./project-view.test";
import { testLogger } from "./test-utils";

export const globalStoragePath: string = "/tmp/mocked_path/";

export class ProjectBookmarkManagerFixture extends ProjectViewFixture {
  public projectBookmarkManager?: ProjectBookmarkManager;

  public readonly mockMemento = {
    get: this.sandbox.stub(),
    update: this.sandbox.stub()
  };

  constructor(ctx: Context) {
    super(ctx);
    mockFs({ globalStoragePath: mockFs.directory() });
  }

  public async createBookmarkedProjectsTreeProvider(
    initialAccountMap?: AccountMapInitializer,
    initialBookmarks: [ApiUrl, Project[]][] = []
  ): Promise<ProjectBookmarkManager> {
    // in case there is a projectBookmarkManager, dispose it, so that the
    // commands are unregistered
    this.projectBookmarkManager?.dispose();

    this.mockMemento.get.returns(initialBookmarks);
    this.createFakeAccountManager(initialAccountMap);
    this.projectBookmarkManager = await ProjectBookmarkManager.createProjectBookmarkManager(
      {
        globalState: this.mockMemento as vscode.Memento,
        globalStoragePath
      } as vscode.ExtensionContext,
      this.fakeAccountManager!,
      testLogger
    );

    this.disposables.push(this.projectBookmarkManager);

    return this.projectBookmarkManager;
  }

  public afterEach(ctx: Context) {
    mockFs.restore();
    super.afterEach(ctx);
  }
}

// class ProjectTreeFixture extends ProjectBookmarkManagerFixture {
//   public readonly sandbox = createSandbox();

//   public readonly mockMemento = {
//     get: this.sandbox.stub(),
//     update: this.sandbox.stub()
//   };

//   constructor(ctx: Context) {
//     super(ctx);
//   }

//   public createProjectTreeProvider(
//     initialBookmarks: [ApiUrl, Project[]][] = []
//   ): ProjectBookmarkManager {
//     this.mockMemento.get.returns(initialBookmarks);

//     const bookmarkMngr = await ProjectBookmarkManager.createProjectBookmarkManager(
//       this.mockMemento,
//       testLogger
//     );

//     this.disposables.push(bookmarkMngr);

//     return bookmarkMngr;
//   }

//   public afterEach(ctx: Context) {
//     this.sandbox.restore();

//     super.afterEach(ctx);
//   }
// }

type FixtureContext = {
  fixture: ProjectBookmarkManagerFixture;
} & Context;

describe("ProjectBookmarkManager", () => {
  describe("#", () => {});
});
