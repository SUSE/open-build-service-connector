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

import { expect } from "chai";
import { afterEach, beforeEach, Context, describe, it, xit } from "mocha";
import * as obs_api from "open-build-service-api";
import { match } from "sinon";
import * as vscode from "vscode";
import { ApiUrl } from "../../accounts";
import { BaseProject } from "../../base-components";
import {
  AddBookmarkElement,
  BookmarkedPackageTreeElement,
  BookmarkedProjectsTreeProvider,
  BookmarkedProjectTreeElement,
  isBookmarkedProjectTreeElement,
  MyBookmarksElement,
  ObsServerTreeElement,
  UPDATE_PROJECT_COMMAND
} from "../../bookmark-tree-view";
import {
  BookmarkState,
  isProjectBookmark,
  packageBookmarkFromPackage,
  projectBookmarkFromProject,
  ProjectBookmarkImpl
} from "../../bookmarks";
import { GET_INSTANCE_INFO_COMMAND } from "../../instance-info";
import { SHOW_REMOTE_PACKAGE_FILE_CONTENTS_COMMAND } from "../../package-file-contents";
import { RefreshBehavior } from "../../project-bookmarks";
import {
  FileTreeElement,
  isPackageTreeElement,
  ProjectTreeElement
} from "../../project-view";
import { AccountMapInitializer } from "./fakes";
import {
  ProjectBookmarkManagerFixture,
  setupFetchProjectMocks
} from "./project-bookmarks.test";
import * as td from "./test-data";
import {
  castToAsyncFunc,
  createStubbedVscodeWindow,
  testLogger
} from "./test-utils";

class BookmarkedProjectsTreeProviderFixture extends ProjectBookmarkManagerFixture {
  public readonly vscodeWindow = createStubbedVscodeWindow(this.sandbox);

  public async createBookmarkedProjectsTreeProvider(
    initialAccountMap?: AccountMapInitializer,
    initialBookmarks: [ApiUrl, obs_api.Project[]][] = []
  ): Promise<BookmarkedProjectsTreeProvider> {
    // in case there is a projectBookmarkManager, dispose it, so that the
    // commands are unregistered
    this.projectBookmarkManager?.dispose();
    this.projectBookmarkManager = await this.createProjectBookmarkManager({
      initialAccountMap,
      initialBookmarks
    });

    const projTreeProv = new BookmarkedProjectsTreeProvider(
      this.fakeAccountManager!,
      this.projectBookmarkManager,
      testLogger,
      this.vscodeWindow,
      this.obsFetchers
    );

    this.disposables.push(
      projTreeProv,
      this.projectBookmarkManager,
      // required to get the list of projects
      vscode.commands.registerCommand(
        GET_INSTANCE_INFO_COMMAND,
        () => undefined
      )
    );

    return projTreeProv;
  }
}

type FixtureContext = {
  fixture: BookmarkedProjectsTreeProviderFixture;
} & Context;

describe("BookmarkedProjectsTreeProvider", () => {
  beforeEach(async function () {
    this.fixture = new BookmarkedProjectsTreeProviderFixture(this);
    await this.fixture.beforeEach();
  });

  afterEach(async function () {
    await this.fixture.afterEach(this);
  });

  describe("#getChildren", () => {
    describe("children of the top level element", () => {
      it(
        "returns a AddBookmark and MyBookmarks element",
        castToAsyncFunc<FixtureContext>(async function () {
          const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider();
          const children = await projectTree.getChildren(undefined);

          expect(children).to.deep.equal([
            new AddBookmarkElement(),
            new MyBookmarksElement()
          ]);
        })
      );
    });

    describe("children of MyBookmarksElement", () => {
      it(
        "returns no children, if no Accounts are present",
        castToAsyncFunc<FixtureContext>(async function () {
          const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider();
          const myBookmarksElement = new MyBookmarksElement();

          await projectTree
            .getChildren(myBookmarksElement)
            .should.eventually.deep.equal([]);
        })
      );

      it(
        "returns an empty array when no projects are bookmarked and only one account is present",
        castToAsyncFunc<FixtureContext>(async function () {
          const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
            [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]]
          );
          const myBookmarksElement = new MyBookmarksElement();

          await projectTree
            .getChildren(myBookmarksElement)
            .should.eventually.deep.equal([]);
        })
      );

      it(
        "returns an array of project bookmarks if only one account is present",
        castToAsyncFunc<FixtureContext>(async function () {
          const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
            [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]],
            [[td.fakeAccount1.apiUrl, [td.fooProj]]]
          );

          setupFetchProjectMocks(
            td.fooProjWithPackages,
            this.fixture.obsFetchers
          );

          this.fixture.obsFetchers.fetchProject.resolves(
            td.fooProjWithPackages
          );
          const myBookmarksElement = new MyBookmarksElement();

          const treeElem = await projectTree.getChildren(myBookmarksElement);
          expect(treeElem).to.be.an("array").and.have.length(1);

          expect(isBookmarkedProjectTreeElement(treeElem[0])).to.equal(true);
          (treeElem[0] as BookmarkedProjectTreeElement).project.should.deep.include(
            td.fooProj
          );
          // FIXME: we changed the attribute .project to a BaseProject so that
          //        comparing works, which makes this test obsolete
          //        => reintroduce it or drop this entirely?
          // expect(
          //   (treeElem[0] as BookmarkedProjectTreeElement).project.meta
          // ).to.not.equal(undefined);
          // .should.eventually.deep.equal([
          //             new BookmarkedProjectTreeElement(
          //     projectBookmarkFromProject({ ...td.fooProj, packages: [] })
          //   )
          // ]);

          this.fixture.obsFetchers.fetchProject.should.have.been.calledOnceWith(
            td.fakeApi1ValidAcc.connection,
            td.fooProj.name
          );
        })
      );

      it(
        "returns ObsServerTreeElements as children of the bookmark element for each Account",
        castToAsyncFunc<FixtureContext>(async function () {
          const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
            [
              [td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc],
              [td.fakeAccount2.apiUrl, td.fakeApi2ValidAcc]
            ]
          );

          const myBookmarksElement = new MyBookmarksElement();

          const children = await projectTree.getChildren(myBookmarksElement);
          children.should.contain.a.thing.that.deep.equals({
            account: td.fakeAccount1,
            collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
            contextValue: "ObsServer",
            iconPath: new vscode.ThemeIcon("server"),
            label: td.fakeAccount1.accountName
          });
          children.should.contain.a.thing.that.deep.equals({
            account: td.fakeAccount2,
            collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
            contextValue: "ObsServer",
            iconPath: new vscode.ThemeIcon("server"),
            label: td.fakeAccount2.accountName
          });
          expect(children).to.be.an("array").and.have.length(2);
        })
      );
    });

    describe("children of the ObsServer element", () => {
      it(
        "returns the list of project bookmarks for this server",
        castToAsyncFunc<FixtureContext>(async function () {
          const contextValue = "project";

          const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
            [
              [td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc],
              [td.fakeAccount2.apiUrl, td.fakeApi2ValidAcc]
            ],
            [
              [td.fakeAccount1.apiUrl, [td.fooProj, td.barProj]],
              [td.fakeAccount2.apiUrl, [td.bazProj]]
            ]
          );

          setupFetchProjectMocks(
            td.fooProjWithPackages,
            this.fixture.obsFetchers
          );
          setupFetchProjectMocks(
            td.barProjWithPackages,
            this.fixture.obsFetchers
          );

          const obsServer1Element = new ObsServerTreeElement(td.fakeAccount1);
          const bookmarks = await projectTree.getChildren(obsServer1Element);
          expect(bookmarks).to.be.an("array").and.have.length(2);
          expect(
            (bookmarks[0] as BookmarkedProjectTreeElement).project
          ).to.deep.include(td.fooProj);
          expect(
            (bookmarks[1] as BookmarkedProjectTreeElement).project
          ).to.deep.include(td.barProj);

          // .should.eventually.deep.equal([
          //   new BookmarkedProjectTreeElement(
          //     projectBookmarkFromProject()
          //   ),
          //   new BookmarkedProjectTreeElement(
          //     projectBookmarkFromProject({ ...td.barProj, packages: [] })
          //   )
          // ]);

          this.fixture.obsFetchers.fetchProject.should.have.been.calledTwice;
          this.fixture.obsFetchers.fetchProject.should.have.been.calledWith(
            td.fakeApi1ValidAcc.connection,
            td.fooProj.name,
            { fetchPackageList: false }
          );
          this.fixture.obsFetchers.fetchProject.should.have.been.calledWith(
            td.fakeApi1ValidAcc.connection,
            td.barProj.name,
            { fetchPackageList: false }
          );

          this.fixture.obsFetchers.fetchProject.reset();

          setupFetchProjectMocks(td.bazProj, this.fixture.obsFetchers);
          const obsServer2Element = new ObsServerTreeElement(td.fakeAccount2);
          const children = await projectTree.getChildren(obsServer2Element);
          expect(children).to.be.an("array").and.have.length(1);
          children[0].should.deep.include({
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
            contextValue,
            label: td.bazProj.name
          });
          (children[0] as BookmarkedProjectTreeElement).project.should.deep.include(
            td.bazProj
          );

          this.fixture.obsFetchers.fetchProject.should.have.been.calledOnceWith(
            td.fakeApi2ValidAcc.connection,
            td.bazProj.name,
            { fetchPackageList: false }
          );
          this.fixture.obsFetchers.fetchPackage.should.have.not.been.called;
        })
      );
    });

    describe("children of the Project Element", () => {
      const commonPackageEntries = {
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        contextValue: "package",
        iconPath: new vscode.ThemeIcon("package")
      };

      it(
        "returns the package list if the project has saved packages",
        castToAsyncFunc<FixtureContext>(async function () {
          const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
            [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]],
            [[td.fakeAccount1.apiUrl, [td.fooProjWithPackages, td.barProj]]]
          );

          const projElemen = new BookmarkedProjectTreeElement(
            new ProjectBookmarkImpl(td.fooProjWithPackages)
          );

          setupFetchProjectMocks(
            td.fooProjWithPackages,
            this.fixture.obsFetchers
          );

          const children = await projectTree
            .getChildren(projElemen)
            .should.eventually.be.an("array")
            .and.have.lengthOf(2);

          children.map((child: any, i: number) => {
            child.should.deep.include({
              ...commonPackageEntries,
              label: td.packages[i].name
            });
          });

          this.fixture.obsFetchers.fetchProject.should.have.been.calledOnceWith(
            td.fakeApi1ValidAcc.connection,
            td.fooProj.name,
            match.any
          );
        })
      );

      it(
        "tries to fetch the package list if the project has no saved packages",
        castToAsyncFunc<FixtureContext>(async function () {
          const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
            [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]],
            [[td.fakeAccount1.apiUrl, [td.fooProjWithPackages, td.barProj]]]
          );

          const projElemen = new BookmarkedProjectTreeElement(
            projectBookmarkFromProject(td.fooProj)
          );

          setupFetchProjectMocks(
            td.fooProjWithPackages,
            this.fixture.obsFetchers
          );

          const children = await projectTree
            .getChildren(projElemen)
            .should.eventually.be.an("array")
            .and.have.lengthOf(2);

          children.map((child: any, i: number) => {
            child.should.deep.include({
              ...commonPackageEntries,
              label: td.packages[i].name
            });
          });

          this.fixture.obsFetchers.fetchProject.should.have.been.calledOnce;
          this.fixture.obsFetchers.fetchProject.should.have.been.calledOnceWith(
            td.fakeApi1ValidAcc.connection,
            td.fooProj.name,
            match.any
          );

          this.fixture.obsFetchers.fetchProject.reset();

          // the project bookmarks should have been updated
          // => no more fetching is necessary
          const children2 = await projectTree.getChildren(projElemen);
          children2.map((child: any, i: number) => {
            child.should.deep.include({
              ...commonPackageEntries,
              label: td.packages[i].name
            });
          });

          this.fixture.obsFetchers.fetchProject.should.have.callCount(0);
        })
      );

      it(
        "it returns an empty array if the project has no saved packages and no configured account exists",
        castToAsyncFunc<FixtureContext>(async function () {
          const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
            [],
            [[td.fakeAccount1.apiUrl, [td.fooProj, td.barProj]]]
          );

          const projElement = new BookmarkedProjectTreeElement(
            projectBookmarkFromProject(td.fooProj)
          );

          await projectTree
            .getChildren(projElement)
            .should.eventually.be.deep.equal([]);

          this.fixture.sandbox.assert.notCalled(
            this.fixture.obsFetchers.fetchProject
          );
        })
      );

      it(
        "does not try to save non-bookmarked projects",
        castToAsyncFunc<FixtureContext>(async function () {
          const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
            [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]]
          );

          setupFetchProjectMocks(
            td.fooProjWithPackages,
            this.fixture.obsFetchers
          );

          const projElement = new BookmarkedProjectTreeElement(
            projectBookmarkFromProject(td.fooProj)
          );
          await projectTree.getChildren(projElement);

          expect(
            await this.fixture.projectBookmarkManager!.getBookmarkedProject(
              td.fooProj.apiUrl,
              td.fooProj.name
            )
          ).to.equal(undefined);
        })
      );
    });

    describe("children of the Package Element", () => {
      const commonFileEntries = {
        collapsibleState: vscode.TreeItemCollapsibleState.None,
        contextValue: "packageFile",
        iconPath: new vscode.ThemeIcon("file"),
        packageName: td.barPkgWithFiles.name,
        parentProject: new BaseProject(
          td.barPkgWithFiles.apiUrl,
          td.barPkgWithFiles.projectName
        )
      };

      it(
        "returns an empty array when no files are known and no account is present",
        castToAsyncFunc<FixtureContext>(async function () {
          const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
            [],
            [[td.fakeAccount1.apiUrl, [td.fooProjWithPackages, td.barProj]]]
          );

          const pkgElement = new BookmarkedPackageTreeElement(
            packageBookmarkFromPackage(td.fooPkg)
          );

          await projectTree
            .getChildren(pkgElement)
            .should.eventually.deep.equal([]);

          this.fixture.obsFetchers.fetchProject.should.have.callCount(0);
        })
      );

      it(
        "returns the known files as PackageTreeElements",
        castToAsyncFunc<FixtureContext>(async function () {
          const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
            [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]],
            [[td.fakeAccount1.apiUrl, [td.barProjWithPackages]]]
          );

          const pkgElement = new BookmarkedPackageTreeElement(
            packageBookmarkFromPackage(td.barPkg)
          );

          setupFetchProjectMocks(
            td.barProjWithPackages,
            this.fixture.obsFetchers
          );

          const fileElements = await projectTree
            .getChildren(pkgElement)
            .should.eventually.be.an("array")
            .and.have.lengthOf(2);

          td.barPkgWithFiles.files!.map((pkgFile, i) => {
            fileElements[i].should.deep.include({
              ...commonFileEntries,
              fileName: pkgFile.name,
              label: pkgFile.name
            });
          });
        })
      );

      it(
        "fetches the files from OBS if none are present and a connection exists",
        castToAsyncFunc<FixtureContext>(async function () {
          const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
            [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]],
            [[td.fakeAccount1.apiUrl, [td.barProjWithPackagesWithoutFiles]]]
          );

          setupFetchProjectMocks(
            td.barProjWithPackages,
            this.fixture.obsFetchers
          );

          const pkgElement = new BookmarkedPackageTreeElement(
            packageBookmarkFromPackage(td.barPkg)
          );

          const fileElements = await projectTree
            .getChildren(pkgElement)
            .should.eventually.be.an("array")
            .and.have.lengthOf(2);

          td.barPkgWithFiles.files!.map((pkgFile, i) => {
            fileElements[i].should.deep.include({
              ...commonFileEntries,
              fileName: pkgFile.name,
              label: pkgFile.name
            });
          });

          this.fixture.obsFetchers.fetchPackage.should.have.been.calledOnceWith(
            td.fakeApi1ValidAcc.connection,
            td.barProj.name,
            td.barPkg.name,
            { retrieveFileContents: false, expandLinks: true }
          );

          this.fixture.obsFetchers.fetchProject.reset();
          this.fixture.obsFetchers.fetchPackage.reset();

          // the project should have now been updated => when we request the same
          // thing again, then fetchPackage must not be called again
          await projectTree
            .getChildren(pkgElement)
            .should.eventually.deep.equal(fileElements);

          this.fixture.obsFetchers.fetchProject.should.have.callCount(0);
          this.fixture.obsFetchers.fetchPackage.should.have.callCount(0);
        })
      );

      it(
        "Does not try to save packages of non bookmarked projects",
        castToAsyncFunc<FixtureContext>(async function () {
          const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
            [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]]
          );

          setupFetchProjectMocks(
            td.barProjWithPackages,
            this.fixture.obsFetchers
          );

          const pkgElement = new BookmarkedPackageTreeElement(
            packageBookmarkFromPackage(td.barPkg)
          );

          const fileElements = await projectTree.getChildren(pkgElement);

          expect(
            await this.fixture.projectBookmarkManager!.getBookmarkedPackage(
              td.barPkg.apiUrl,
              td.barPkg.projectName,
              td.barPkg.name
            )
          ).to.equal(undefined);

          // the project has not been updated, so if we try to get the children
          // again, we end up having to call fetchPackage again
          await projectTree
            .getChildren(pkgElement)
            .should.eventually.deep.equal(fileElements);
        })
      );
    });
  });

  describe("#getTreeItem", () => {
    it(
      "passes non ProjectTreeItems through",
      castToAsyncFunc<FixtureContext>(async function () {
        const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider();
        const myBookmarks = new MyBookmarksElement();
        projectTree.getTreeItem(myBookmarks).should.deep.equal(myBookmarks);

        const obsServer = new ObsServerTreeElement(td.fakeAccount1);
        projectTree.getTreeItem(obsServer).should.deep.equal(obsServer);

        const addBookmark = new AddBookmarkElement();
        projectTree.getTreeItem(addBookmark).should.deep.equal(addBookmark);
      })
    );

    it(
      "modifies the iconPath of a ProjectTreeElement",
      castToAsyncFunc<FixtureContext>(async function () {
        const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider();
        const projElem = new BookmarkedProjectTreeElement(
          projectBookmarkFromProject(td.fooProj)
        );
        const projTreeItem = projectTree.getTreeItem(projElem);

        projTreeItem.should.have
          .property("iconPath")
          .that.deep.equals(new vscode.ThemeIcon("bookmark"));
      })
    );

    it(
      "adds a command to fetch the file contents to a FileTreeElement",
      castToAsyncFunc<FixtureContext>(async function () {
        const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider();
        const fileElem = new FileTreeElement(td.fooProj.apiUrl, td.fileA);
        projectTree
          .getTreeItem(fileElem)
          .should.have.property("command")
          .that.deep.includes({
            command: SHOW_REMOTE_PACKAGE_FILE_CONTENTS_COMMAND
          });
      })
    );
  });

  describe("#updatePackage", () => {
    const projTreeItem = new BookmarkedProjectTreeElement(
      projectBookmarkFromProject(td.barProjWithPackagesWithoutFiles)
    );
    const pkgTreeItem = new BookmarkedPackageTreeElement(
      packageBookmarkFromPackage(td.barPkg)
    );

    it(
      "tries to refetch the package contents",
      castToAsyncFunc<FixtureContext>(async function () {
        const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
          [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]],
          [[td.fakeAccount1.apiUrl, [td.barProjWithPackagesWithoutFiles]]]
        );

        const initialBookmark = await this.fixture.projectBookmarkManager!.getBookmarkedProject(
          td.barProj.apiUrl,
          td.barProj.name,
          RefreshBehavior.FetchWhenMissing
        );
        expect(initialBookmark).to.deep.include(td.barProj);
        expect(initialBookmark!.packages)
          .to.be.an("array")
          .and.have.length(td.barProjWithPackages.packages!.length);

        setupFetchProjectMocks(
          td.barProjWithPackages,
          this.fixture.obsFetchers
        );

        await projectTree.updatePackage(pkgTreeItem);

        this.fixture.obsFetchers.fetchPackage.should.have.been.calledWithExactly(
          match({ url: td.fakeApi1ValidAcc.connection.url }),
          td.barProjWithPackagesWithoutFiles.name,
          td.barPkg.name,
          { retrieveFileContents: false, expandLinks: true }
        );
        this.fixture.obsFetchers.fetchPackage.reset();
        this.fixture.obsFetchers.fetchProject.reset();

        // verify that the updated package contents are there:
        await this.fixture
          .projectBookmarkManager!.getBookmarkedProject(
            td.barProj.apiUrl,
            td.barProj.name,
            RefreshBehavior.FetchWhenMissing
          )
          .should.eventually.deep.include({
            ...td.barProjWithPackages,
            state: BookmarkState.Ok
          });

        this.fixture.obsFetchers.fetchProject.should.have.callCount(0);
        this.fixture.obsFetchers.fetchPackage.should.have.callCount(0);
      })
    );

    it(
      "does not add additional packages to the bookmarks",
      castToAsyncFunc<FixtureContext>(async function () {
        const bar2Pkg: obs_api.Package = {
          apiUrl: td.fakeAccount1.apiUrl,
          name: "bar2",
          projectName: td.barProj.name
        };
        const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
          [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]],
          [
            [
              td.fakeAccount1.apiUrl,
              [
                {
                  ...td.barProj,
                  packages: [bar2Pkg]
                }
              ]
            ]
          ]
        );

        setupFetchProjectMocks(
          {
            ...td.barProj,
            packages: [bar2Pkg, td.barPkgWithFiles]
          },
          this.fixture.obsFetchers
        );

        await projectTree.updatePackage(pkgTreeItem);

        const projBookmark = await this.fixture.projectBookmarkManager!.getBookmarkedProject(
          td.barProj.apiUrl,
          td.barProj.name
        );
        isProjectBookmark(projBookmark).should.equal(true);

        expect(projBookmark).to.deep.include({
          ...td.barProj,
          state: BookmarkState.Ok
        });
        expect(projBookmark!.packages).to.be.an("array").and.have.length(1);
        expect(projBookmark!.packages![0]).to.deep.include(bar2Pkg);
      })
    );

    it(
      "logs an error if no account is present for this project",
      castToAsyncFunc<FixtureContext>(async function () {
        const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
          [],
          [[td.fakeAccount1.apiUrl, [td.barProjWithPackagesWithoutFiles]]]
        );

        await projectTree.updatePackage(pkgTreeItem);

        this.fixture.sandbox.assert.notCalled(this.fixture.mockMemento.update);
      })
    );

    it(
      "does not save a package in the bookmarks whose parent project is not bookmarked",
      castToAsyncFunc<FixtureContext>(async function () {
        const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
          [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]],
          []
        );

        await projectTree.updatePackage(pkgTreeItem);

        this.fixture.sandbox.assert.notCalled(this.fixture.mockMemento.update);
      })
    );

    it(
      "logs an error if the provided element is invalid or of the wrong type",
      castToAsyncFunc<FixtureContext>(async function () {
        const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
          [],
          [[td.fakeAccount1.apiUrl, [td.barProjWithPackagesWithoutFiles]]]
        );

        await projectTree.updatePackage(projTreeItem);
        await projectTree.updatePackage();

        this.fixture.sandbox.assert.notCalled(this.fixture.mockMemento.update);
      })
    );
  });

  describe("#bookmarkProjectCommand", () => {
    xit(
      "adds a project to the bookmarks including all packages",
      castToAsyncFunc<FixtureContext>(async function () {
        const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
          [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]],
          [[td.fakeAccount1.apiUrl, [td.barProj]]]
        );

        // project selection
        this.fixture.vscodeWindow.showInputBox
          .onCall(0)
          .resolves(td.fooProj.name);

        setupFetchProjectMocks(
          td.fooProjWithPackages,
          this.fixture.obsFetchers
        );

        await projectTree.bookmarkProjectCommand(new AddBookmarkElement());

        this.fixture.vscodeWindow.showInputBox.should.have.been.calledOnce;
        this.fixture.vscodeWindow.showInputBox.should.have.been.calledWithMatch(
          match({
            ignoreFocusOut: true,
            prompt: "Provide the name of the project that you want to add"
          })
        );

        const bookmark = await this.fixture.projectBookmarkManager!.getBookmarkedProject(
          td.fooProj.apiUrl,
          td.fooProj.name
        );
        expect(bookmark).to.deep.include(td.fooProj);
        expect(bookmark!.packages)
          .to.be.an("array")
          .and.have.length(td.fooProjWithPackages.packages!.length);
      })
    );

    describe("add a project with many packages", () => {
      const projWith12Packages: obs_api.Project = {
        apiUrl: td.fakeAccount1.apiUrl,
        name: "devl",
        packages: [...Array(12).keys()].map((num) => ({
          apiUrl: td.fakeAccount1.apiUrl,
          name: `pkg_${num}`,
          projectName: "devl"
        }))
      };

      beforeEach(function () {
        this.fixture.vscodeWindow.showInputBox
          .onCall(0)
          .resolves(projWith12Packages.name);

        setupFetchProjectMocks(projWith12Packages, this.fixture.obsFetchers);
      });

      xit(
        "includes all packages when the user says so",
        castToAsyncFunc<FixtureContext>(async function () {
          const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
            [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]],
            [[td.fakeAccount1.apiUrl, [td.barProj]]]
          );

          // this.fixture.vscodeWindow.showQuickPick.resolves()

          await projectTree.bookmarkProjectCommand(new AddBookmarkElement());

          this.fixture.mockMemento.update.should.have.been.calledOnce;
          // const [_key, newBookmarks] = this.fixture.mockMemento.update.getCall(
          //   0
          // ).args;

          // newBookmarks.should.deep.equal([
          //   [td.fakeAccount1.apiUrl, [td.barProj, projWith12Packages]]
          // ]);

          // this.fixture.projectBookmarkManager!.getBookmarkedProject()
        })
      );

      it(
        "doesn't bookmark the project if the user let's the prompt whether add all packages time out",
        castToAsyncFunc<FixtureContext>(async function () {
          const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
            [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]],
            [[td.fakeAccount1.apiUrl, [td.barProj]]]
          );

          this.fixture.vscodeWindow.showInformationMessage
            .onCall(0)
            .resolves(undefined);

          await projectTree.bookmarkProjectCommand(new AddBookmarkElement());

          this.fixture.sandbox.assert.notCalled(
            this.fixture.mockMemento.update
          );
        })
      );

      it(
        "asks the user which packages to include and bookmarks only these",
        castToAsyncFunc<FixtureContext>(async function () {
          const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
            [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]],
            [[td.fakeAccount1.apiUrl, [td.barProj]]]
          );

          const pickedPkgNames = ["pkg_2", "pkg_5", "pkg_6", "pkg_10"];
          this.fixture.vscodeWindow.showInformationMessage
            .onCall(0)
            .resolves("No");
          this.fixture.vscodeWindow.showQuickPick
            .onCall(0)
            .resolves(pickedPkgNames);

          await projectTree.bookmarkProjectCommand(new AddBookmarkElement());

          this.fixture.vscodeWindow.showQuickPick.should.have.callCount(1);

          const [
            pkgNames,
            quickPickOptions
          ] = this.fixture.vscodeWindow.showQuickPick.getCall(0).args;
          pkgNames.should.deep.equal(
            projWith12Packages.packages?.map((pkg) => pkg.name)
          );
          quickPickOptions.should.deep.include({ canPickMany: true });

          const bookmark = await this.fixture.projectBookmarkManager!.getBookmarkedProject(
            projWith12Packages.apiUrl,
            projWith12Packages.name
          );
          expect(bookmark).to.deep.include({
            apiUrl: projWith12Packages.apiUrl,
            name: projWith12Packages.name
          });

          expect(bookmark?.packages)
            .to.be.an("array")
            .and.have.length(pickedPkgNames.length);
          for (const pkgBkmrk of bookmark!.packages!) {
            pkgBkmrk.should.deep.include(
              projWith12Packages.packages!.find(
                (pkg) => pkg.name === pkgBkmrk.name
              )
            );
          }
        })
      );

      it(
        "asks the user which packages to include but does not bookmark anything if the prompt times out",
        castToAsyncFunc<FixtureContext>(async function () {
          const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
            [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]],
            [[td.fakeAccount1.apiUrl, [td.barProj]]]
          );

          this.fixture.vscodeWindow.showInformationMessage
            .onCall(0)
            .resolves("No");
          this.fixture.vscodeWindow.showQuickPick.onCall(0).resolves(undefined);

          await projectTree.bookmarkProjectCommand(new AddBookmarkElement());

          this.fixture.vscodeWindow.showQuickPick.should.have.callCount(1);
          this.fixture.mockMemento.update.should.have.callCount(0);
        })
      );
    });

    it(
      "reports an error if no accounts are configured",
      castToAsyncFunc<FixtureContext>(async function () {
        const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider();

        await projectTree.bookmarkProjectCommand();

        this.fixture.sandbox.assert.calledOnce(
          this.fixture.vscodeWindow.showErrorMessage
        );
        this.fixture.sandbox.assert.calledWith(
          this.fixture.vscodeWindow.showErrorMessage,
          "Error: No accounts are present, cannot add a bookmark"
        );

        this.fixture.sandbox.assert.notCalled(this.fixture.mockMemento.update);
      })
    );

    it(
      "does not bookmark anything if the user does not provide a project name",
      castToAsyncFunc<FixtureContext>(async function () {
        const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
          [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]]
        );

        this.fixture.vscodeWindow.showInputBox.onCall(0).resolves(undefined);

        await projectTree.bookmarkProjectCommand(new AddBookmarkElement());

        this.fixture.vscodeWindow.showInputBox.should.have.callCount(1);
        this.fixture.mockMemento.update.should.have.callCount(0);
      })
    );

    describe("project that fails to be fetched", () => {
      const projName = "test_project";
      const errMsg = `Unknown project ${projName}`;

      beforeEach(function () {
        this.fixture.vscodeWindow.showInputBox.onCall(0).resolves(projName);
        this.fixture.obsFetchers.fetchProject
          .onCall(0)
          .throws(new Error(errMsg));
      });

      it(
        "does not bookmark anything if the project cannot be fetched and the user does not want to add it",
        castToAsyncFunc<FixtureContext>(async function () {
          const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
            [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]]
          );

          this.fixture.vscodeWindow.showErrorMessage
            .onCall(0)
            .resolves("Cancel");

          await projectTree.bookmarkProjectCommand(new AddBookmarkElement());

          this.fixture.vscodeWindow.showInputBox.should.have.been.calledOnce;
          this.fixture.vscodeWindow.showErrorMessage.calledOnceWith(
            `Adding a bookmark for the project ${projName} using the account ${td.fakeAccount1.accountName} failed with: Error: ${errMsg}.`,
            "Add anyway",
            "Cancel"
          );
          this.fixture.mockMemento.update.should.have.callCount(0);
        })
      );

      it(
        "bookmarks a project that failed to load when instructed to do so",
        castToAsyncFunc<FixtureContext>(async function () {
          const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
            [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]]
          );

          this.fixture.vscodeWindow.showErrorMessage
            .onCall(0)
            .resolves("Add anyway");

          await projectTree.bookmarkProjectCommand(new AddBookmarkElement());

          this.fixture.vscodeWindow.showInputBox.should.have.callCount(1);
          this.fixture.vscodeWindow.showErrorMessage.should.have.callCount(1);

          this.fixture.mockMemento.update.should.have.callCount(1);

          await this.fixture
            .projectBookmarkManager!.getBookmarkedProject(
              td.fakeAccount1.apiUrl,
              projName,
              RefreshBehavior.Never
            )
            .should.eventually.deep.include({
              apiUrl: td.fakeAccount1.apiUrl,
              state: BookmarkState.RemoteGone,
              name: projName,
              packages: undefined
            });
        })
      );
    });
  });

  describe("#removeBookmark", () => {
    it(
      "removes a bookmarked project",
      castToAsyncFunc<FixtureContext>(async function () {
        const projects = [
          td.fooProj,
          td.barProj,
          { apiUrl: td.fakeAccount1.apiUrl, name: "another_project" }
        ];
        const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
          [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]],
          [[td.fakeAccount1.apiUrl, projects]]
        );

        const projElem = new BookmarkedProjectTreeElement(
          projectBookmarkFromProject(td.barProj)
        );

        await projectTree.removeBookmark(projElem);

        this.fixture.mockMemento.update.should.have.been.calledOnce;
        expect(
          await this.fixture.projectBookmarkManager!.getBookmarkedProject(
            td.barProj.apiUrl,
            td.barProj.name
          )
        ).to.equal(undefined);
      })
    );
  });

  describe("#updateProject", () => {
    it(
      "updates the active project when fetching it succeeds",
      castToAsyncFunc<FixtureContext>(async function () {
        const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
          [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]],
          [[td.fakeAccount1.apiUrl, [td.fooProjWithPackages]]]
        );

        setupFetchProjectMocks(
          td.fooProjWithPackages,
          this.fixture.obsFetchers
        );

        const projElem = new BookmarkedProjectTreeElement(
          projectBookmarkFromProject(td.fooProj)
        );

        await vscode.commands.executeCommand(UPDATE_PROJECT_COMMAND, projElem);
        // this.fixture.mockMemento.update.should.have.callCount(0);

        // now we have to check that the project tree provider is actually aware
        // of this change, do that via getChildren() as we cannot access the
        // activeProject property
        const pkgElems = await projectTree.getChildren(projElem);

        expect(pkgElems)
          .to.be.an("array")
          .and.have.length(td.fooProjWithPackages.packages!.length);

        pkgElems.forEach((elem, i) => {
          isPackageTreeElement(elem).should.be.true;
          elem.should.deep.include({
            label: td.fooProjWithPackages.packages![i].name,
            parentProject: new BaseProject(td.fooProjWithPackages)
          });
        });
      })
    );

    it(
      "updates the project bookmark when fetching it succeeds",
      castToAsyncFunc<FixtureContext>(async function () {
        await this.fixture.createBookmarkedProjectsTreeProvider(
          [[td.fakeAccount1.apiUrl, td.fakeApi1ValidAcc]],
          [[td.fakeAccount1.apiUrl, [td.fooProjWithPackages]]]
        );

        setupFetchProjectMocks(
          td.fooProjWithPackages,
          this.fixture.obsFetchers
        );

        const projElem = new ProjectTreeElement(td.fooProj);

        await vscode.commands.executeCommand(UPDATE_PROJECT_COMMAND, projElem);

        this.fixture.mockMemento.update.should.have.been.calledOnce;
      })
    );

    it(
      "does nothing when the provided element is not a ProjectTreeElement",
      castToAsyncFunc<FixtureContext>(async function () {
        // const projectTree =
        await this.fixture.createBookmarkedProjectsTreeProvider();

        await vscode.commands.executeCommand(UPDATE_PROJECT_COMMAND);

        this.fixture.sandbox.assert.notCalled(this.fixture.mockMemento.update);
      })
    );

    it(
      "reports to the user if there is no account present for this project",
      castToAsyncFunc<FixtureContext>(async function () {
        await this.fixture.createBookmarkedProjectsTreeProvider(
          [],
          [[td.fakeAccount1.apiUrl, [td.fooProj]]]
        );

        const fooProjTreeElem = new ProjectTreeElement(td.fooProj);

        await vscode.commands.executeCommand(
          UPDATE_PROJECT_COMMAND,
          fooProjTreeElem
        );

        this.fixture.vscodeWindow.showErrorMessage.should.have.been.calledOnceWith(
          match(
            `Cannot fetch project ${td.fooProj.name} from ${td.fooProj.apiUrl}: no account is configured`
          )
        );
        this.fixture.sandbox.assert.notCalled(this.fixture.mockMemento.update);
      })
    );
  });
});
