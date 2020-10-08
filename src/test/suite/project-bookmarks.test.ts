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

import * as assert from "assert";
import { expect } from "chai";
import { promises as fsPromises } from "fs";
import { afterEach, beforeEach, Context, describe, it } from "mocha";
import { Project } from "open-build-service-api";
import { join } from "path";
import { createSandbox, match, SinonStub } from "sinon";
import * as vscode from "vscode";
import { ApiUrl } from "../../accounts";
import {
  BookmarkState,
  packageBookmarkFromPackage,
  projectBookmarkFromProject
} from "../../bookmarks";
import {
  ChangedObject,
  ChangeType,
  ProjectBookmarkManager,
  RefreshBehavior
} from "../../project-bookmarks";
import { AccountMapInitializer, FakeAccountManager } from "./fakes";
import * as td from "./test-data";
import {
  castToAsyncFunc,
  createStubbedObsFetchers,
  LoggingFixture,
  testLogger
} from "./test-utils";
import { getTmpPrefix, safeRmRf } from "./utilities";

export class ProjectBookmarkManagerFixture extends LoggingFixture {
  public globalStorageUri: vscode.Uri | undefined;

  public readonly sandbox = createSandbox();

  public projectBookmarkManager?: ProjectBookmarkManager;
  public fakeAccountManager?: FakeAccountManager;

  public readonly mockMemento = {
    get: this.sandbox.stub(),
    update: this.sandbox.stub()
  };

  public readonly obsFetchers = createStubbedObsFetchers(this.sandbox);

  public async createProjectBookmarkManager({
    initialAccountMap,
    initialBookmarks = []
  }: {
    initialAccountMap?: AccountMapInitializer;
    initialBookmarks?: [ApiUrl, Project[]][];
  } = {}): Promise<ProjectBookmarkManager> {
    // in case there is a projectBookmarkManager, dispose it, so that the
    // commands are unregistered
    this.projectBookmarkManager?.dispose();

    this.mockMemento.get.returns(
      initialBookmarks.map(([apiUrl, proj]) => [
        apiUrl,
        proj.map((p) => projectBookmarkFromProject(p))
      ])
    );
    this.fakeAccountManager = new FakeAccountManager(initialAccountMap);
    this.projectBookmarkManager = await ProjectBookmarkManager.createProjectBookmarkManager(
      {
        globalState: this.mockMemento as vscode.Memento,
        globalStorageUri: this.globalStorageUri
      } as vscode.ExtensionContext,
      this.fakeAccountManager!,
      testLogger,
      this.obsFetchers
    );

    this.disposables.push(this.projectBookmarkManager, this.fakeAccountManager);

    return this.projectBookmarkManager;
  }

  public async beforeEach(): Promise<void> {
    const prefix = join(getTmpPrefix(), "obs-connector");
    this.globalStorageUri = vscode.Uri.file(await fsPromises.mkdtemp(prefix));
  }

  public async afterEach(ctx: Context) {
    this.sandbox.restore();
    assert(this.globalStorageUri !== undefined);
    await safeRmRf(this.globalStorageUri.fsPath);

    super.afterEach(ctx);
    this.dispose();
  }
}

export function setupFetchProjectMocks(
  proj: Project,
  fetchers: {
    fetchFileContents: SinonStub;
    fetchPackage: SinonStub;
    fetchProject: SinonStub;
  }
): void {
  const { packages: pkgs, ...rest } = proj;

  const meta = rest.meta ?? {
    name: rest.name,
    description: rest.name,
    title: rest.name
  };

  fetchers.fetchProject
    .withArgs(
      match({ url: rest.apiUrl }),
      rest.name,
      match({ fetchPackageList: false })
    )
    .resolves({
      apiUrl: rest.apiUrl,
      meta,
      name: rest.name
    });
  fetchers.fetchProject
    .withArgs(
      match({ url: rest.apiUrl }),
      rest.name,
      match({ fetchPackageList: true })
    )
    .resolves({
      apiUrl: rest.apiUrl,
      meta,
      name: rest.name,
      packages: (pkgs ?? []).map((pkg) => {
        const { name, apiUrl, projectName } = pkg;
        return { name, apiUrl, projectName };
      })
    });

  if (pkgs !== undefined) {
    pkgs.forEach((pkg) => {
      const { files, ...rest } = pkg;
      fetchers.fetchPackage
        .withArgs(match.any, proj.name, pkg.name, match.any)
        .resolves({ ...rest, files: files ?? [] });
    });
  }
}

type FixtureContext = {
  fixture: ProjectBookmarkManagerFixture;
} & Context;

describe("ProjectBookmarkManager", () => {
  beforeEach(async function () {
    const fixture = new ProjectBookmarkManagerFixture(this);
    await fixture.beforeEach();
    this.fixture = fixture;
  });

  afterEach(async function () {
    await this.fixture.afterEach(this);
  });

  describe("#addProjectToBookmarks", () => {
    it(
      "adds the project to the cache after fetching it",
      castToAsyncFunc<FixtureContext>(async function () {
        const mgr = await this.fixture.createProjectBookmarkManager({
          initialAccountMap: [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]]
        });

        setupFetchProjectMocks(td.fooProj, this.fixture.obsFetchers);

        await mgr.addProjectToBookmarks(td.fooProj);

        await mgr
          .getBookmarkedProject(td.fooProj.apiUrl, td.fooProj.name)
          .should.eventually.deep.include({
            ...td.fooProj,
            packages: [],
            state: BookmarkState.Ok
          });

        this.fixture.obsFetchers.fetchProject.should.have.been.calledOnce;
        this.fixture.obsFetchers.fetchPackage.should.have.callCount(0);
        this.fixture.obsFetchers.fetchFileContents.should.have.callCount(0);
      })
    );

    it(
      "marks the added project as broken if fetching fails",
      castToAsyncFunc<FixtureContext>(async function () {
        const mgr = await this.fixture.createProjectBookmarkManager({
          initialAccountMap: [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]]
        });

        this.fixture.obsFetchers.fetchProject.throws(new Error("Barf"));

        await mgr.addProjectToBookmarks(td.fooProj);

        await mgr
          .getBookmarkedProject(
            td.fooProj.apiUrl,
            td.fooProj.name,
            RefreshBehavior.Always
          )
          .should.eventually.deep.include({
            ...td.fooProj,
            packages: [],
            state: BookmarkState.RemoteGone
          });

        this.fixture.obsFetchers.fetchProject.should.have.been.calledOnce;
        this.fixture.obsFetchers.fetchPackage.should.have.callCount(0);
        this.fixture.obsFetchers.fetchFileContents.should.have.callCount(0);
      })
    );

    it(
      "adds the project but does add its packages",
      castToAsyncFunc<FixtureContext>(async function () {
        const mgr = await this.fixture.createProjectBookmarkManager({
          initialAccountMap: [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]]
        });

        setupFetchProjectMocks(
          td.fooProjWithPackages,
          this.fixture.obsFetchers
        );

        await mgr.addProjectToBookmarks(td.fooProj);

        await mgr
          .getBookmarkedProject(td.fooProj.apiUrl, td.fooProj.name)
          .should.eventually.deep.include({
            ...td.fooProj,
            packages: [],
            state: BookmarkState.Ok
          });

        this.fixture.obsFetchers.fetchProject.should.have.been.calledOnce;
        this.fixture.obsFetchers.fetchPackage.should.have.callCount(0);
        this.fixture.obsFetchers.fetchFileContents.should.have.callCount(0);
      })
    );

    it(
      "adds the project and returns its explicitly added packages",
      castToAsyncFunc<FixtureContext>(async function () {
        const mgr = await this.fixture.createProjectBookmarkManager({
          initialAccountMap: [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]],
          initialBookmarks: [[td.fakeAccount1.apiUrl, [td.fooProj]]]
        });

        setupFetchProjectMocks(
          td.fooProjWithPackages,
          this.fixture.obsFetchers
        );

        await mgr.addProjectToBookmarks({
          ...td.fooProj,
          packages: [td.packages[0]]
        });

        const projBookmark = await mgr.getBookmarkedProject(
          td.fooProj.apiUrl,
          td.fooProj.name
        );

        expect(projBookmark).to.deep.include({
          ...td.fooProj,
          state: BookmarkState.Ok
        });
        expect(projBookmark?.packages).to.be.an("array").and.have.length(1);
        expect(projBookmark?.packages?.[0]).to.deep.include({
          ...td.packages[0],
          state: BookmarkState.Ok,
          checkoutPath: undefined
        });

        this.fixture.obsFetchers.fetchProject.should.have.been.calledOnce;
        this.fixture.obsFetchers.fetchPackage.should.have.been.calledOnce;
        this.fixture.obsFetchers.fetchPackage.should.have.been.calledOnceWith(
          td.fakeApi1ValidAcc.connection,
          td.fooProj.name,
          td.packages[0].name,
          match.any
        );
        this.fixture.obsFetchers.fetchFileContents.should.have.callCount(0);
      })
    );

    it(
      "adds a package when called a second time with the package",
      castToAsyncFunc<FixtureContext>(async function () {
        const mgr = await this.fixture.createProjectBookmarkManager({
          initialAccountMap: [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]]
        });

        setupFetchProjectMocks(
          td.fooProjWithPackages,
          this.fixture.obsFetchers
        );

        await mgr.addProjectToBookmarks({
          ...td.fooProj,
          packages: []
        });

        await mgr
          .getBookmarkedProject(td.fooProj.apiUrl, td.fooProj.name)
          .should.eventually.deep.include({
            ...td.fooProj,
            packages: [],
            state: BookmarkState.Ok
          });

        await mgr.addProjectToBookmarks({
          ...td.fooProj,
          packages: [td.packages[0]]
        });

        const projBkmrk = await mgr.getBookmarkedProject(
          td.fooProj.apiUrl,
          td.fooProj.name
        );

        expect(projBkmrk).to.deep.include({
          ...td.fooProj,
          state: BookmarkState.Ok
        });

        expect(projBkmrk?.packages).to.be.an("array").and.have.length(1);
        expect(projBkmrk?.packages?.[0]).to.deep.include({
          ...td.packages[0],
          state: BookmarkState.Ok,
          checkoutPath: undefined
        });

        this.fixture.obsFetchers.fetchProject.should.have.been.calledTwice;
        this.fixture.obsFetchers.fetchPackage.should.have.been.calledOnce;
        this.fixture.obsFetchers.fetchPackage.should.have.been.calledOnceWith(
          match.any,
          td.fooProj.name,
          td.packages[0].name,
          match.any
        );
        this.fixture.obsFetchers.fetchFileContents.should.have.callCount(0);
      })
    );

    it(
      "adds the project and returns its explicitly added packages and the packages files",
      castToAsyncFunc<FixtureContext>(async function () {
        const mgr = await this.fixture.createProjectBookmarkManager({
          initialAccountMap: [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]]
        });

        setupFetchProjectMocks(
          td.barProjWithPackages,
          this.fixture.obsFetchers
        );

        await mgr.addProjectToBookmarks(td.barProjWithPackagesWithoutFiles);

        await mgr
          .getBookmarkedProject(
            td.barProjWithPackages.apiUrl,
            td.barProjWithPackages.name
          )
          .should.eventually.deep.include({
            ...td.barProj,
            packages: [
              {
                ...td.barPkgWithFiles,
                state: BookmarkState.Ok,
                checkoutPath: undefined
              }
            ],
            state: BookmarkState.Ok
          });

        this.fixture.obsFetchers.fetchProject.should.have.been.calledOnce;
        this.fixture.obsFetchers.fetchPackage.should.have.been.calledOnce;
        this.fixture.obsFetchers.fetchFileContents.should.have.callCount(0);
      })
    );
  });

  describe("#getBookmarkedProject", () => {
    it(
      "does not duplicate packages if the metadata cache has a slightly different package",
      castToAsyncFunc<FixtureContext>(async function () {
        const mgr = await this.fixture.createProjectBookmarkManager({
          initialAccountMap: [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]]
        });

        setupFetchProjectMocks(
          td.fooProjWithPackages,
          this.fixture.obsFetchers
        );

        await mgr.addProjectToBookmarks(td.fooProjWithPackages);

        await mgr
          .getBookmarkedProject(td.fooProj.apiUrl, td.fooProj.name)
          .should.eventually.have.property("packages")
          .that.is.an("array")
          .and.has.length(2);

        await mgr.addProjectToBookmarks({
          ...td.fooProj,
          packages: [
            td.packages[0],
            {
              ...td.packages[1],
              meta: { description: "description", title: "a title" }
            }
          ]
        });

        await mgr
          .getBookmarkedProject(td.fooProj.apiUrl, td.fooProj.name)
          .should.eventually.have.property("packages")
          .that.is.an("array")
          .and.has.length(2);

        // this.fixture.obsFetchers.fetchProject.should.have.been.calledOnce;
        // this.fixture.obsFetchers.fetchPackage.should.have.callCount(0);
        // this.fixture.obsFetchers.fetchFileContents.should.have.callCount(0);
      })
    );
  });

  describe("#removeProjectFromBookmarks", () => {
    it(
      "removes a project",
      castToAsyncFunc<FixtureContext>(async function () {
        const mgr = await this.fixture.createProjectBookmarkManager({
          initialAccountMap: [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]],
          initialBookmarks: [[td.fakeAccount1.apiUrl, [td.fooProj]]]
        });

        await mgr.removeProjectFromBookmarks(td.fooProj);

        await mgr
          .getBookmarkedProject(td.fooProj.apiUrl, td.fooProj.name)
          .should.eventually.equal(undefined);

        this.fixture.obsFetchers.fetchProject.should.callCount(0);
        this.fixture.obsFetchers.fetchPackage.should.callCount(0);
        this.fixture.obsFetchers.fetchFileContents.should.have.callCount(0);
      })
    );

    it(
      "does nothing if no projects are bookmarked",
      castToAsyncFunc<FixtureContext>(async function () {
        const mgr = await this.fixture.createProjectBookmarkManager({
          initialAccountMap: [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]]
        });

        await mgr.removeProjectFromBookmarks(td.fooProj);

        await mgr
          .getBookmarkedProject(td.fooProj.apiUrl, td.fooProj.name)
          .should.eventually.equal(undefined);
      })
    );

    it(
      "does nothing if the project is not bookmarked",
      castToAsyncFunc<FixtureContext>(async function () {
        const mgr = await this.fixture.createProjectBookmarkManager({
          initialAccountMap: [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]],
          initialBookmarks: [[td.fakeAccount1.apiUrl, [td.fooProj]]]
        });

        await mgr.removeProjectFromBookmarks(td.barProj);

        await mgr
          .getBookmarkedProject(
            td.fooProj.apiUrl,
            td.fooProj.name,
            RefreshBehavior.Never
          )
          .should.eventually.deep.include(td.fooProj);

        await mgr
          .getBookmarkedProject(td.barProj.apiUrl, td.barProj.name)
          .should.eventually.equal(undefined);
      })
    );
  });

  describe("#getAllBookmarkedProjects", () => {
    it(
      "returns nothing if no parameter is passed",
      castToAsyncFunc<FixtureContext>(async function () {
        const mgr = await this.fixture.createProjectBookmarkManager();

        await mgr.getAllBookmarkedProjects().should.eventually.equal(undefined);
      })
    );

    it(
      "returns the bookmarked projects",
      castToAsyncFunc<FixtureContext>(async function () {
        const mgr = await this.fixture.createProjectBookmarkManager({
          initialAccountMap: [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]],
          initialBookmarks: [[td.fakeAccount1.apiUrl, [td.fooProj, td.barProj]]]
        });

        setupFetchProjectMocks(td.fooProj, this.fixture.obsFetchers);
        setupFetchProjectMocks(td.barProj, this.fixture.obsFetchers);

        const bookmarks = await mgr.getAllBookmarkedProjects(
          td.fakeAccount1.apiUrl
        );
        expect(bookmarks).to.be.an("array").and.have.length(2);

        [td.fooProj, td.barProj].forEach((proj) => {
          expect(
            bookmarks.find((bookmark) => bookmark.name === proj.name)
          ).to.deep.include(proj);
        });
      })
    );

    it(
      "returns an empty array when no bookmarks exist",
      castToAsyncFunc<FixtureContext>(async function () {
        const mgr = await this.fixture.createProjectBookmarkManager({
          initialAccountMap: [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]]
        });

        const bookmarks = await mgr.getAllBookmarkedProjects(
          td.fakeAccount1.apiUrl
        );
        expect(bookmarks).to.be.an("array").and.have.length(0);
      })
    );
  });

  describe("#addPackageToBookmarks", () => {
    it(
      "adds the package's parent project if the it does not exist",
      castToAsyncFunc<FixtureContext>(async function () {
        const mgr = await this.fixture.createProjectBookmarkManager({
          initialAccountMap: [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]]
        });

        setupFetchProjectMocks(
          td.barProjWithPackages,
          this.fixture.obsFetchers
        );

        await mgr.addPackageToBookmarks(td.barPkgWithFiles);

        await mgr
          .getBookmarkedProject(
            td.barPkgWithFiles.apiUrl,
            td.barPkgWithFiles.projectName
          )
          .should.eventually.deep.include(td.barProj);
        await mgr
          .getBookmarkedPackage(
            td.barPkgWithFiles.apiUrl,
            td.barPkgWithFiles.projectName,
            td.barPkgWithFiles.name
          )
          .should.eventually.deep.include(td.barPkgWithFiles);
      })
    );

    it(
      "adds a package to an existing project",
      castToAsyncFunc<FixtureContext>(async function () {
        const mgr = await this.fixture.createProjectBookmarkManager({
          initialAccountMap: [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]],
          initialBookmarks: [[td.fakeAccount1.apiUrl, [td.barProj]]]
        });

        setupFetchProjectMocks(
          td.barProjWithPackages,
          this.fixture.obsFetchers
        );
        await mgr.addPackageToBookmarks(td.barPkgWithFiles);

        await mgr
          .getBookmarkedPackage(
            td.barProj.apiUrl,
            td.barProj.name,
            td.barPkgWithFiles.name
          )
          .should.eventually.deep.equal(
            packageBookmarkFromPackage(td.barPkgWithFiles)
          );
      })
    );

    it(
      "injects a package into an existing project",
      castToAsyncFunc<FixtureContext>(async function () {
        const mgr = await this.fixture.createProjectBookmarkManager({
          initialAccountMap: [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]],
          initialBookmarks: [
            [
              td.fakeAccount1.apiUrl,
              [{ ...td.fooProj, packages: [td.packages[0]] }]
            ]
          ]
        });

        setupFetchProjectMocks(
          td.fooProjWithPackages,
          this.fixture.obsFetchers
        );
        await mgr.addPackageToBookmarks(td.packages[1]);

        await mgr
          .getBookmarkedPackage(
            td.fooProj.apiUrl,
            td.fooProj.name,
            td.packages[1].name
          )
          .should.eventually.deep.equal(
            packageBookmarkFromPackage({ ...td.packages[1], files: [] })
          );
      })
    );
  });

  describe("#getBookmarkedPackage", () => {
    it(
      "returns undefined when one of the mandatory parameters is missing",
      castToAsyncFunc<FixtureContext>(async function () {
        const mgr = await this.fixture.createProjectBookmarkManager();

        await mgr.getBookmarkedPackage().should.eventually.equal(undefined);
      })
    );

    it(
      "returns undefined when the project cannot be found",
      castToAsyncFunc<FixtureContext>(async function () {
        const mgr = await this.fixture.createProjectBookmarkManager();

        await mgr
          .getBookmarkedPackage(
            td.fooProj.apiUrl,
            td.fooProj.name,
            td.packages[0].name
          )
          .should.eventually.equal(undefined);
      })
    );

    it(
      "returns the package directly if it is already known",
      castToAsyncFunc<FixtureContext>(async function () {
        const mgr = await this.fixture.createProjectBookmarkManager({
          initialAccountMap: [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]],
          initialBookmarks: [[td.fakeAccount1.apiUrl, [td.fooProjWithPackages]]]
        });

        setupFetchProjectMocks(
          td.fooProjWithPackages,
          this.fixture.obsFetchers
        );

        await mgr
          .getBookmarkedPackage(
            td.fooProj.apiUrl,
            td.fooProj.name,
            td.packages[0].name
          )
          .should.eventually.deep.include(
            packageBookmarkFromPackage(td.packages[0])
          );

        this.fixture.obsFetchers.fetchProject.should.have.been.calledOnce;
        this.fixture.obsFetchers.fetchPackage.should.have.callCount(
          td.fooProjWithPackages.packages!.length
        );
      })
    );
  });

  describe("#removePackageFromBookmarks", () => {
    it(
      "does nothing when the packages' parent project is not bookmarked",
      castToAsyncFunc<FixtureContext>(async function () {
        const mgr = await this.fixture.createProjectBookmarkManager({
          initialAccountMap: [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]]
        });
        const listener = this.fixture.sandbox.stub();
        mgr.onBookmarkUpdate(listener);

        await mgr.removePackageFromBookmarks(td.barPkg);

        listener.should.have.callCount(0);
      })
    );

    it(
      "does nothing when the packages' parent project bookmark has no packages",
      castToAsyncFunc<FixtureContext>(async function () {
        const mgr = await this.fixture.createProjectBookmarkManager({
          initialAccountMap: [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]],
          initialBookmarks: [[td.fakeAccount1.apiUrl, [td.fooProj]]]
        });
        const listener = this.fixture.sandbox.stub();
        mgr.onBookmarkUpdate(listener);

        await mgr.removePackageFromBookmarks(td.packages[1]);

        listener.should.have.callCount(0);
      })
    );

    it(
      "does nothing when the packages' parent project bookmark does not include this package",
      castToAsyncFunc<FixtureContext>(async function () {
        const mgr = await this.fixture.createProjectBookmarkManager({
          initialAccountMap: [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]],
          initialBookmarks: [[td.fakeAccount1.apiUrl, [td.fooProjWithPackages]]]
        });
        const listener = this.fixture.sandbox.stub();
        mgr.onBookmarkUpdate(listener);

        await mgr.removePackageFromBookmarks({
          name: "unknown",
          apiUrl: td.fakeAccount1.apiUrl,
          projectName: td.fooProj.name
        });

        listener.should.have.callCount(0);
      })
    );

    it(
      "removes the package from the project",
      castToAsyncFunc<FixtureContext>(async function () {
        const mgr = await this.fixture.createProjectBookmarkManager({
          initialAccountMap: [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]],
          initialBookmarks: [[td.fakeAccount1.apiUrl, [td.fooProjWithPackages]]]
        });
        // const listener = this.fixture.sandbox.stub();
        // mgr.onBookmarkUpdate(listener);

        await mgr
          .getBookmarkedPackage(
            td.packages[1].apiUrl,
            td.packages[1].projectName,
            td.packages[1].name,
            RefreshBehavior.Never
          )
          .should.eventually.deep.include(td.packages[1]);

        await mgr.removePackageFromBookmarks(td.packages[1]);

        await mgr
          .getBookmarkedPackage(
            td.packages[1].apiUrl,
            td.packages[1].projectName,
            td.packages[1].name
          )
          .should.eventually.equal(undefined);
      })
    );
  });

  describe("onBookmarkUpdate", () => {
    describe("Project updates", () => {
      it(
        "fires when a project is added",
        castToAsyncFunc<FixtureContext>(async function () {
          const mgr = await this.fixture.createProjectBookmarkManager({
            initialAccountMap: [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]]
          });

          const listener = this.fixture.sandbox.stub();
          mgr.onBookmarkUpdate(listener);

          await mgr.addProjectToBookmarks(td.fooProj);

          listener.should.have.been.calledOnce;
          listener.should.have.been.calledOnceWith(
            match({
              changedObject: ChangedObject.Project,
              changeType: ChangeType.Add,
              element: match({
                ...td.fooProj,
                state: BookmarkState.Ok
              })
            })
          );
        })
      );

      it(
        "fires when a project is removed",
        castToAsyncFunc<FixtureContext>(async function () {
          const mgr = await this.fixture.createProjectBookmarkManager({
            initialAccountMap: [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]]
          });

          setupFetchProjectMocks(td.fooProj, this.fixture.obsFetchers);
          await mgr.addProjectToBookmarks(td.fooProj);

          const listener = this.fixture.sandbox.stub();
          mgr.onBookmarkUpdate(listener);

          await mgr.removeProjectFromBookmarks(td.fooProj);

          listener.should.have.been.calledOnce;
          listener.should.have.been.calledOnceWith(
            match({
              changedObject: ChangedObject.Project,
              changeType: ChangeType.Remove,
              element: match({
                ...td.fooProj,
                state: BookmarkState.Ok
              })
            })
          );
        })
      );

      it(
        "fires when a project is modified",
        castToAsyncFunc<FixtureContext>(async function () {
          const mgr = await this.fixture.createProjectBookmarkManager({
            initialAccountMap: [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]],
            initialBookmarks: [[td.fakeAccount1.apiUrl, [td.barProj]]]
          });
          const listener = this.fixture.sandbox.stub();
          mgr.onBookmarkUpdate(listener);

          setupFetchProjectMocks(
            td.barProjWithPackages,
            this.fixture.obsFetchers
          );
          await mgr.addProjectToBookmarks(td.barProjWithPackagesWithoutFiles);

          listener.should.have.been.calledOnce;
          listener.should.have.been.calledOnceWith(
            match({
              changedObject: ChangedObject.Project,
              changeType: ChangeType.Modify,
              element: match(td.barProj)
            })
          );
        })
      );
    });

    describe("Package updates", () => {
      it(
        "fires when a package is added",
        castToAsyncFunc<FixtureContext>(async function () {
          const mgr = await this.fixture.createProjectBookmarkManager({
            initialAccountMap: [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]],
            initialBookmarks: [[td.fakeAccount1.apiUrl, [td.fooProj]]]
          });

          const listener = this.fixture.sandbox.stub();
          mgr.onBookmarkUpdate(listener);

          await mgr.addPackageToBookmarks(td.packages[0]);

          listener.should.have.been.calledOnce;

          listener.should.have.been.calledOnceWith(
            match({
              changedObject: ChangedObject.Package,
              changeType: ChangeType.Add,
              element: {
                ...td.packages[0],
                files: [],
                state: BookmarkState.Ok
              }
            })
          );
        })
      );

      it(
        "fires when a package is modified",
        castToAsyncFunc<FixtureContext>(async function () {
          const mgr = await this.fixture.createProjectBookmarkManager({
            initialAccountMap: [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]],
            initialBookmarks: [
              [td.fakeAccount1.apiUrl, [td.fooProjWithPackages]]
            ]
          });

          const listener = this.fixture.sandbox.stub();
          mgr.onBookmarkUpdate(listener);

          await mgr.addPackageToBookmarks({
            ...td.packages[0],
            files: [td.fileA]
          });

          listener.should.have.been.calledOnce;

          listener.should.have.been.calledOnceWith(
            match({
              changedObject: ChangedObject.Package,
              changeType: ChangeType.Modify,
              element: {
                ...td.packages[0],
                files: [td.fileA],
                state: BookmarkState.Ok
              }
            })
          );
        })
      );

      it(
        "fires when a package is deleted",
        castToAsyncFunc<FixtureContext>(async function () {
          const mgr = await this.fixture.createProjectBookmarkManager({
            initialAccountMap: [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]],
            initialBookmarks: [
              [td.fakeAccount1.apiUrl, [td.fooProjWithPackages]]
            ]
          });

          const listener = this.fixture.sandbox.stub();
          mgr.onBookmarkUpdate(listener);

          await mgr.removePackageFromBookmarks(td.packages[0]);

          listener.should.have.been.calledOnce;
          listener.should.have.been.calledOnceWith(
            match({
              changedObject: ChangedObject.Package,
              changeType: ChangeType.Remove,
              element: match(td.packages[0])
            })
          );
        })
      );
    });
  });
});
