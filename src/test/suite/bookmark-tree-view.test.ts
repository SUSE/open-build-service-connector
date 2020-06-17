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
import { promises as fsPromises } from "fs";
import { afterEach, beforeEach, Context, describe, it, xit } from "mocha";
import * as obs_ts from "open-build-service-api";
import { tmpdir } from "os";
import { sep } from "path";
import { match } from "sinon";
import * as vscode from "vscode";
import { ApiUrl } from "../../accounts";
import { BaseProject } from "../../base-components";
import {
  AddBookmarkElement,
  BookmarkedProjectsTreeProvider,
  MyBookmarksElement,
  ObsServerTreeElement,
  UPDATE_PROJECT_COMMAND
} from "../../bookmark-tree-view";
import { SHOW_REMOTE_PACKAGE_FILE_CONTENTS_COMMAND } from "../../package-file-contents";
import {
  ProjectBookmarkManager,
  RefreshBehavior
} from "../../project-bookmarks";
import {
  FileTreeElement,
  isPackageTreeElement,
  PackageTreeElement,
  ProjectTreeElement
} from "../../project-view";
import { AccountMapInitializer } from "./fakes";
import { ProjectViewFixture } from "./project-view.test";
import {
  fakeAccount1,
  fakeAccount2,
  fakeApi1ValidAcc,
  fakeApi2ValidAcc
} from "./test-data";
import { castToAsyncFunc, testLogger } from "./test-utils";
import { GET_INSTANCE_INFO_COMMAND } from "../../instance-info";

const fooProj: obs_ts.Project = {
  apiUrl: fakeAccount1.apiUrl,
  name: "fooProj"
};

const barProj: obs_ts.Project = {
  apiUrl: fakeAccount1.apiUrl,
  name: "barProj"
};

const bazProj: obs_ts.Project = {
  apiUrl: fakeAccount2.apiUrl,
  name: "bazProj"
};

const fooPkg: obs_ts.Package = {
  apiUrl: fakeAccount1.apiUrl,
  name: "fooPkg",
  projectName: fooProj.name
};
const foo2Pkg: obs_ts.Package = {
  apiUrl: fakeAccount1.apiUrl,
  name: "foo2Pkg",
  projectName: fooProj.name
};
const packages = [fooPkg, foo2Pkg];

const fooProjWithPackages: obs_ts.Project = {
  ...fooProj,
  packages
};

const barPkg: obs_ts.Package = {
  apiUrl: fakeAccount1.apiUrl,
  name: "barPkg",
  projectName: barProj.name
};

const [fileA, fileB]: obs_ts.PackageFile[] = ["fileA", "fileB"].map((name) => ({
  name,
  packageName: barPkg.name,
  projectName: barPkg.projectName
}));

const barPkgWithFiles: obs_ts.Package = {
  ...barPkg,
  files: [fileA, fileB]
};

const barProjWithPackages: obs_ts.Project = {
  ...barProj,
  packages: [barPkgWithFiles]
};

const barProjWithPackagesWithoutFiles: obs_ts.Project = {
  ...barProj,
  packages: [barPkg]
};

class BookmarkedProjectsTreeProviderFixture extends ProjectViewFixture {
  public projectBookmarkManager?: ProjectBookmarkManager;

  public globalStoragePath: string = "";

  public readonly mockMemento = {
    get: this.sandbox.stub(),
    update: this.sandbox.stub()
  };

  public async createBookmarkedProjectsTreeProvider(
    initialAccountMap?: AccountMapInitializer,
    initialBookmarks: [ApiUrl, obs_ts.Project[]][] = []
  ): Promise<BookmarkedProjectsTreeProvider> {
    this.globalStoragePath = await fsPromises.mkdtemp(
      `${process.env.TMPDIR ?? tmpdir()}${sep}obs-connector`
    );
    // in case there is a projectBookmarkManager, dispose it, so that the
    // commands are unregistered
    this.projectBookmarkManager?.dispose();

    this.mockMemento.get.returns(initialBookmarks);
    this.createFakeAccountManager(initialAccountMap);
    this.projectBookmarkManager = await ProjectBookmarkManager.createProjectBookmarkManager(
      {
        globalState: this.mockMemento as vscode.Memento,
        globalStoragePath: this.globalStoragePath
      } as vscode.ExtensionContext,
      this.fakeAccountManager!,
      testLogger,
      {
        fetchFileContents: this.fetchFileContentsMock,
        fetchPackage: this.fetchPackageMock,
        fetchProject: this.fetchProjectMock
      }
    );

    const projTreeProv = new BookmarkedProjectsTreeProvider(
      this.fakeAccountManager!,
      this.projectBookmarkManager,
      testLogger,
      this.vscodeWindow,
      this.fetchProjectMock
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

  public async afterEach(ctx: Context) {
    await obs_ts.rmRf(this.globalStoragePath);
    super.afterEach(ctx);
  }
}

type FixtureContext = {
  fixture: BookmarkedProjectsTreeProviderFixture;
} & Context;

describe("BookmarkedProjectsTreeProvider", () => {
  beforeEach(function () {
    this.fixture = new BookmarkedProjectsTreeProviderFixture(this);
  });

  afterEach(function () {
    return this.fixture.afterEach(this);
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
            [[fakeAccount1.apiUrl, fakeApi1ValidAcc]]
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
            [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
            [[fakeAccount1.apiUrl, [fooProj]]]
          );
          this.fixture.fetchProjectMock.resolves(fooProjWithPackages);
          const myBookmarksElement = new MyBookmarksElement();

          await projectTree
            .getChildren(myBookmarksElement)
            .should.eventually.deep.equal([
              {
                collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
                contextValue: "project",
                label: fooProj.name,
                project: fooProj
              }
            ]);

          this.fixture.fetchProjectMock.should.have.been.calledOnceWith(
            fakeApi1ValidAcc.connection,
            fooProj.name
          );
        })
      );

      it(
        "returns ObsServerTreeElements as children of the bookmark element for each Account",
        castToAsyncFunc<FixtureContext>(async function () {
          const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
            [
              [fakeAccount1.apiUrl, fakeApi1ValidAcc],
              [fakeAccount2.apiUrl, fakeApi2ValidAcc]
            ]
          );

          const myBookmarksElement = new MyBookmarksElement();

          const children = await projectTree.getChildren(myBookmarksElement);
          children.should.contain.a.thing.that.deep.equals({
            account: fakeAccount1,
            collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
            contextValue: "ObsServer",
            iconPath: { id: "server" },
            label: fakeAccount1.accountName
          });
          children.should.contain.a.thing.that.deep.equals({
            account: fakeAccount2,
            collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
            contextValue: "ObsServer",
            iconPath: { id: "server" },
            label: fakeAccount2.accountName
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
              [fakeAccount1.apiUrl, fakeApi1ValidAcc],
              [fakeAccount2.apiUrl, fakeApi2ValidAcc]
            ],
            [
              [fakeAccount1.apiUrl, [fooProj, barProj]],
              [fakeAccount2.apiUrl, [bazProj]]
            ]
          );

          this.fixture.fetchProjectMock.onCall(0).resolves(fooProjWithPackages);
          this.fixture.fetchProjectMock.onCall(1).resolves(barProjWithPackages);

          const obsServer1Element = new ObsServerTreeElement(fakeAccount1);
          await projectTree
            .getChildren(obsServer1Element)
            .should.eventually.deep.equal([
              {
                collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
                contextValue,
                label: fooProj.name,
                project: fooProj
              },
              {
                collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
                contextValue,
                label: barProj.name,
                project: barProj
              }
            ]);

          this.fixture.fetchProjectMock.should.have.been.calledTwice;
          this.fixture.fetchProjectMock.should.have.been.calledWith(
            fakeApi1ValidAcc.connection,
            fooProj.name,
            { getPackageList: true }
          );
          this.fixture.fetchProjectMock.should.have.been.calledWith(
            fakeApi1ValidAcc.connection,
            barProj.name,
            { getPackageList: true }
          );

          this.fixture.fetchProjectMock.reset();

          this.fixture.fetchProjectMock.resolves(bazProj);

          const obsServer2Element = new ObsServerTreeElement(fakeAccount2);
          await projectTree
            .getChildren(obsServer2Element)
            .should.eventually.deep.equal([
              {
                collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
                contextValue,
                label: bazProj.name,
                project: bazProj
              }
            ]);

          this.fixture.fetchProjectMock.should.have.been.calledOnceWith(
            fakeApi2ValidAcc.connection,
            bazProj.name,
            { getPackageList: true }
          );
          this.fixture.fetchPackageMock.should.have.not.been.called;
        })
      );
    });

    describe("children of the Project Element", () => {
      const commonPackageEntries = {
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        contextValue: "package",
        iconPath: { id: "package" }
      };

      it(
        "returns the package list if the project has saved packages",
        castToAsyncFunc<FixtureContext>(async function () {
          const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
            [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
            [[fakeAccount1.apiUrl, [fooProjWithPackages, barProj]]]
          );

          const projElemen = new ProjectTreeElement(fooProjWithPackages);

          this.fixture.fetchProjectMock.resolves(fooProjWithPackages);

          const children = await projectTree
            .getChildren(projElemen)
            .should.eventually.be.an("array")
            .and.have.lengthOf(2);

          children.map((child: any, i: number) => {
            child.should.deep.include({
              ...commonPackageEntries,
              label: packages[i].name
            });
          });

          this.fixture.fetchProjectMock.should.have.been.calledOnceWith(
            fakeApi1ValidAcc.connection,
            fooProj.name,
            { getPackageList: true }
          );
          this.fixture.fetchPackageMock.should.have.not.been.called;
        })
      );

      it(
        "tries to fetch the package list if the project has no saved packages",
        castToAsyncFunc<FixtureContext>(async function () {
          const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
            [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
            [[fakeAccount1.apiUrl, [fooProjWithPackages, barProj]]]
          );

          const projElemen = new ProjectTreeElement(fooProj);

          this.fixture.fetchProjectMock.resolves(fooProjWithPackages);

          const children = await projectTree
            .getChildren(projElemen)
            .should.eventually.be.an("array")
            .and.have.lengthOf(2);

          children.map((child: any, i: number) => {
            child.should.deep.include({
              ...commonPackageEntries,
              label: packages[i].name
            });
          });

          this.fixture.fetchProjectMock.should.have.been.calledOnce;
          this.fixture.sandbox.assert.calledWith(
            this.fixture.fetchProjectMock.firstCall,
            fakeApi1ValidAcc.connection,
            fooProj.name,
            { getPackageList: true }
          );

          this.fixture.fetchProjectMock.reset();

          // the project bookmarks should have been updated
          // => no more fetching is necessary
          await projectTree
            .getChildren(projElemen)
            .should.eventually.deep.equal(children);

          this.fixture.fetchProjectMock.should.have.callCount(0);
        })
      );

      it(
        "it returns an empty array if the project has no saved packages and no configured account exists",
        castToAsyncFunc<FixtureContext>(async function () {
          const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
            [],
            [[fakeAccount1.apiUrl, [fooProj, barProj]]]
          );

          const projElement = new ProjectTreeElement(fooProj);

          await projectTree
            .getChildren(projElement)
            .should.eventually.be.deep.equal([]);

          this.fixture.sandbox.assert.notCalled(this.fixture.fetchProjectMock);
        })
      );

      xit(
        "does not try to save non-bookmarked projects",
        castToAsyncFunc<FixtureContext>(async function () {
          const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
            [[fakeAccount1.apiUrl, fakeApi1ValidAcc]]
          );

          this.fixture.fetchProjectMock.resolves(fooProjWithPackages);

          const projElement = new ProjectTreeElement(fooProj);
          await projectTree.getChildren(projElement);

          this.fixture.sandbox.assert.notCalled(
            this.fixture.mockMemento.update
          );
          this.fixture.sandbox.assert.calledOnce(this.fixture.fetchProjectMock);
        })
      );
    });

    describe("children of the Package Element", () => {
      const commonFileEntries = {
        collapsibleState: vscode.TreeItemCollapsibleState.None,
        contextValue: "packageFile",
        iconPath: new vscode.ThemeIcon("file"),
        packageName: barPkgWithFiles.name,
        parentProject: new BaseProject(
          barPkgWithFiles.apiUrl,
          barPkgWithFiles.projectName
        )
      };

      it(
        "returns an empty array when no files are known and no account is present",
        castToAsyncFunc<FixtureContext>(async function () {
          const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
            [],
            [[fakeAccount1.apiUrl, [fooProjWithPackages, barProj]]]
          );

          const pkgElement = new PackageTreeElement(fooPkg);

          await projectTree
            .getChildren(pkgElement)
            .should.eventually.deep.equal([]);

          this.fixture.fetchProjectMock.should.have.callCount(0);
        })
      );

      it(
        "returns the known files as PackageTreeElements",
        castToAsyncFunc<FixtureContext>(async function () {
          const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
            [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
            [[fakeAccount1.apiUrl, [barProjWithPackages]]]
          );

          const pkgElement = new PackageTreeElement(barPkg);

          this.fixture.fetchProjectMock.resolves(barProjWithPackages);
          this.fixture.fetchPackageMock.resolves(barPkgWithFiles);

          const fileElements = await projectTree
            .getChildren(pkgElement)
            .should.eventually.be.an("array")
            .and.have.lengthOf(2);

          this.fixture.fetchProjectMock.should.have.been.calledOnceWithExactly(
            fakeApi1ValidAcc.connection,
            barProj.name,
            { getPackageList: true }
          );
          // this.fixture.fetchPackageMock.should.have.been.calledOnceWithExactly(
          //   fakeApi1ValidAcc.connection,
          //   barPkgWithFiles.projectName,
          //   barPkgWithFiles.name,
          //   { retrieveFileContents: false, expandLinks: true }
          // );

          barPkgWithFiles.files!.map((pkgFile, i) => {
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
            [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
            [[fakeAccount1.apiUrl, [barProjWithPackagesWithoutFiles]]]
          );

          this.fixture.fetchPackageMock.resolves(barPkgWithFiles);
          this.fixture.fetchProjectMock.resolves(
            barProjWithPackagesWithoutFiles
          );

          const pkgElement = new PackageTreeElement(barPkg);

          const fileElements = await projectTree
            .getChildren(pkgElement)
            .should.eventually.be.an("array")
            .and.have.lengthOf(2);

          barPkgWithFiles.files!.map((pkgFile, i) => {
            fileElements[i].should.deep.include({
              ...commonFileEntries,
              fileName: pkgFile.name,
              label: pkgFile.name
            });
          });

          this.fixture.fetchPackageMock.should.have.been.calledOnceWith(
            fakeApi1ValidAcc.connection,
            barProj.name,
            barPkg.name,
            { retrieveFileContents: false, expandLinks: true }
          );

          this.fixture.fetchProjectMock.reset();
          this.fixture.fetchPackageMock.reset();

          // the project should have now been updated => when we request the same
          // thing again, then fetchPackage must not be called again
          await projectTree
            .getChildren(pkgElement)
            .should.eventually.deep.equal(fileElements);

          this.fixture.fetchProjectMock.should.have.callCount(0);
          this.fixture.fetchPackageMock.should.have.callCount(0);
        })
      );

      xit(
        "Does not try to save packages of non bookmarked projects",
        castToAsyncFunc<FixtureContext>(async function () {
          const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
            [[fakeAccount1.apiUrl, fakeApi1ValidAcc]]
          );

          this.fixture.fetchPackageMock.resolves(barPkgWithFiles);

          const pkgElement = new PackageTreeElement(barPkg);

          const fileElements = await projectTree.getChildren(pkgElement);

          this.fixture.sandbox.assert.calledOnce(this.fixture.fetchPackageMock);
          this.fixture.sandbox.assert.notCalled(
            this.fixture.mockMemento.update
          );

          // the project has not been updated, so if we try to get the children
          // again, we end up having to call fetchPackage again
          await projectTree
            .getChildren(pkgElement)
            .should.eventually.deep.equal(fileElements);
          this.fixture.sandbox.assert.calledTwice(
            this.fixture.fetchPackageMock
          );
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

        const obsServer = new ObsServerTreeElement(fakeAccount1);
        projectTree.getTreeItem(obsServer).should.deep.equal(obsServer);

        const addBookmark = new AddBookmarkElement();
        projectTree.getTreeItem(addBookmark).should.deep.equal(addBookmark);
      })
    );

    it(
      "modifies the iconPath of a ProjectTreeElement",
      castToAsyncFunc<FixtureContext>(async function () {
        const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider();
        const projElem = new ProjectTreeElement(fooProj);
        const projTreeItem = projectTree.getTreeItem(projElem);

        projTreeItem.should.have.property("iconPath");
        const iconPath = projTreeItem.iconPath!;

        iconPath.should.have
          .property("dark")
          .that.matches(/bookmark_border\.svg/);
        iconPath.should.have
          .property("light")
          .that.matches(/bookmark_border\.svg/);
      })
    );

    it(
      "adds a command to fetch the file contents to a FileTreeElement",
      castToAsyncFunc<FixtureContext>(async function () {
        const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider();
        const fileElem = new FileTreeElement(fooProj.apiUrl, fileA);
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
    const projTreeItem = new ProjectTreeElement(
      barProjWithPackagesWithoutFiles
    );
    const pkgTreeItem = new PackageTreeElement(barPkg);

    it(
      "tries to refetch the package contents",
      castToAsyncFunc<FixtureContext>(async function () {
        const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
          [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
          [[fakeAccount1.apiUrl, [barProjWithPackagesWithoutFiles]]]
        );

        this.fixture.fetchProjectMock.resolves(barProjWithPackagesWithoutFiles);
        this.fixture.fetchPackageMock.resolves(barPkgWithFiles);

        await projectTree.updatePackage(pkgTreeItem);

        this.fixture.fetchPackageMock.should.have.been.calledOnceWithExactly(
          fakeApi1ValidAcc.connection,
          barProjWithPackagesWithoutFiles.name,
          barPkg.name,
          { retrieveFileContents: false, expandLinks: true }
        );
        this.fixture.fetchPackageMock.reset();
        this.fixture.fetchProjectMock.reset();

        // verify that the updated package contents are there:
        this.fixture
          .projectBookmarkManager!.getBookmarkedProject(
            barProj.apiUrl,
            barProj.name,
            RefreshBehavior.FetchWhenMissing
          )
          .should.eventually.deep.equal(barProjWithPackages);

        this.fixture.fetchProjectMock.should.have.callCount(0);
        this.fixture.fetchPackageMock.should.have.callCount(0);
      })
    );

    it(
      "appends the package if the project bookmark has already packages",
      castToAsyncFunc<FixtureContext>(async function () {
        const bar2Pkg: obs_ts.Package = {
          apiUrl: fakeAccount1.apiUrl,
          name: "bar2",
          projectName: barProj.name
        };
        const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
          [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
          [
            [
              fakeAccount1.apiUrl,
              [
                {
                  ...barProj,
                  packages: [bar2Pkg]
                }
              ]
            ]
          ]
        );

        this.fixture.fetchProjectMock.resolves(barProjWithPackages);

        await projectTree.updatePackage(pkgTreeItem);

        this.fixture
          .projectBookmarkManager!.getBookmarkedProject(
            barProj.apiUrl,
            barProj.name
          )
          .should.eventually.deep.equal({
            ...barProj,
            packages: [bar2Pkg, barPkgWithFiles]
          });
      })
    );

    it(
      "logs an error if no account is present for this project",
      castToAsyncFunc<FixtureContext>(async function () {
        const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
          [],
          [[fakeAccount1.apiUrl, [barProjWithPackagesWithoutFiles]]]
        );

        await projectTree.updatePackage(pkgTreeItem);

        this.fixture.sandbox.assert.notCalled(this.fixture.mockMemento.update);
      })
    );

    it(
      "does not save a package in the bookmarks whose parent project is not bookmarked",
      castToAsyncFunc<FixtureContext>(async function () {
        const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
          [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
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
          [[fakeAccount1.apiUrl, [barProjWithPackagesWithoutFiles]]]
        );

        await projectTree.updatePackage(projTreeItem);
        await projectTree.updatePackage();

        this.fixture.sandbox.assert.notCalled(this.fixture.mockMemento.update);
      })
    );
  });

  describe("#bookmarkProjectCommand", () => {
    it(
      "adds a project to the bookmarks including all packages",
      castToAsyncFunc<FixtureContext>(async function () {
        const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
          [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
          [[fakeAccount1.apiUrl, [barProj]]]
        );

        // project selection
        this.fixture.vscodeWindow.showInputBox.onCall(0).resolves(fooProj.name);

        this.fixture.fetchProjectMock.resolves(fooProjWithPackages);

        await projectTree.bookmarkProjectCommand(new AddBookmarkElement());

        this.fixture.vscodeWindow.showInputBox.should.have.been.calledOnce;
        this.fixture.vscodeWindow.showInputBox.should.have.been.calledWithMatch(
          match({
            ignoreFocusOut: true,
            prompt: "Provide the name of the project that you want to add"
          })
        );

        this.fixture
          .projectBookmarkManager!.getBookmarkedProject(
            fooProj.apiUrl,
            fooProj.name
          )
          .should.eventually.deep.equal(fooProjWithPackages);
      })
    );

    describe("add a project with many packages", () => {
      const projWith12Packages: obs_ts.Project = {
        apiUrl: fakeAccount1.apiUrl,
        name: "devl",
        packages: [...Array(12).keys()].map((num) => ({
          apiUrl: fakeAccount1.apiUrl,
          name: `pkg_${num}`,
          projectName: "devl"
        }))
      };

      beforeEach(function () {
        this.fixture.vscodeWindow.showInputBox
          .onCall(0)
          .resolves(projWith12Packages.name);

        this.fixture.fetchProjectMock.resolves(projWith12Packages);
      });

      it(
        "includes all packages when the user says so",
        castToAsyncFunc<FixtureContext>(async function () {
          const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
            [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
            [[fakeAccount1.apiUrl, [barProj]]]
          );

          this.fixture.vscodeWindow.showInformationMessage
            .onCall(0)
            .resolves("Yes");

          await projectTree.bookmarkProjectCommand(new AddBookmarkElement());

          this.fixture.vscodeWindow.showInformationMessage.should.have.been.calledOnceWith(
            "This project has 12 packages, add them all?",
            "Yes",
            "No"
          );

          this.fixture.mockMemento.update.should.have.been.calledOnce;
          // const [_key, newBookmarks] = this.fixture.mockMemento.update.getCall(
          //   0
          // ).args;

          // newBookmarks.should.deep.equal([
          //   [fakeAccount1.apiUrl, [barProj, projWith12Packages]]
          // ]);

          // this.fixture.projectBookmarkManager!.getBookmarkedProject()
        })
      );

      it(
        "doesn't bookmark the project if the user let's the prompt whether add all packages time out",
        castToAsyncFunc<FixtureContext>(async function () {
          const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
            [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
            [[fakeAccount1.apiUrl, [barProj]]]
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
            [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
            [[fakeAccount1.apiUrl, [barProj]]]
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

          await this.fixture
            .projectBookmarkManager!.getBookmarkedProject(
              projWith12Packages.apiUrl,
              projWith12Packages.name
            )
            .should.eventually.deep.equal({
              apiUrl: projWith12Packages.apiUrl,
              name: projWith12Packages.name,
              packages: projWith12Packages.packages!.filter(
                (pkg) =>
                  pickedPkgNames.find((pkgName) => pkg.name === pkgName) !==
                  undefined
              )
            });
        })
      );

      it(
        "asks the user which packages to include but does not bookmark anything if the prompt times out",
        castToAsyncFunc<FixtureContext>(async function () {
          const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
            [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
            [[fakeAccount1.apiUrl, [barProj]]]
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
          [[fakeAccount1.apiUrl, fakeApi1ValidAcc]]
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
        this.fixture.fetchProjectMock.onCall(0).throws(Error(errMsg));
      });

      it(
        "does not bookmark anything if the project cannot be fetched and the user does not want to add it",
        castToAsyncFunc<FixtureContext>(async function () {
          const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
            [[fakeAccount1.apiUrl, fakeApi1ValidAcc]]
          );

          this.fixture.vscodeWindow.showErrorMessage
            .onCall(0)
            .resolves("Cancel");

          await projectTree.bookmarkProjectCommand(new AddBookmarkElement());

          this.fixture.vscodeWindow.showInputBox.should.have.been.calledOnce;
          this.fixture.vscodeWindow.showErrorMessage.calledOnceWith(
            `Adding a bookmark for the project ${projName} using the account ${fakeAccount1.accountName} failed with: Error: ${errMsg}.`,
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
            [[fakeAccount1.apiUrl, fakeApi1ValidAcc]]
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
              fakeAccount1.apiUrl,
              projName,
              RefreshBehavior.Never
            )
            .should.eventually.deep.equal({
              apiUrl: fakeAccount1.apiUrl,
              name: projName,
              packages: undefined
            });
        })
      );
    });

    xit(
      "uses the correct connection when bookmarking projects from a ObsServerTreeElement",
      castToAsyncFunc<FixtureContext>(async function () {
        const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
          [
            [fakeAccount1.apiUrl, fakeApi1ValidAcc],
            [fakeAccount2.apiUrl, fakeApi2ValidAcc]
          ]
        );

        const fakeApi1ObsServerTreeElement = new ObsServerTreeElement(
          fakeAccount1
        );

        this.fixture.vscodeWindow.showInputBox.onCall(0).resolves(fooProj.name);

        this.fixture.fetchProjectMock.resolves(fooProjWithPackages);

        await projectTree.bookmarkProjectCommand(fakeApi1ObsServerTreeElement);

        this.fixture.sandbox.assert.calledOnce(this.fixture.mockMemento.update);
        this.fixture.mockMemento.update
          .getCall(0)
          .args[1].should.deep.equal([
            [fakeAccount1.apiUrl, [fooProjWithPackages]]
          ]);
      })
    );
  });

  describe("#removeBookmark", () => {
    it(
      "removes a bookmarked project",
      castToAsyncFunc<FixtureContext>(async function () {
        const projects = [
          fooProj,
          barProj,
          { apiUrl: fakeAccount1.apiUrl, name: "another_project" }
        ];
        const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
          [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
          [[fakeAccount1.apiUrl, projects]]
        );

        const projElem = new ProjectTreeElement(barProj);

        await projectTree.removeBookmark(projElem);

        this.fixture.sandbox.assert.calledOnce(this.fixture.mockMemento.update);
        this.fixture.mockMemento.update
          .getCall(0)
          .args[1].should.deep.equal([
            [fakeAccount1.apiUrl, [fooProj, projects[2]]]
          ]);
      })
    );
  });

  describe("#updateProject", () => {
    it(
      "updates the active project when fetching it succeeds",
      castToAsyncFunc<FixtureContext>(async function () {
        const projectTree = await this.fixture.createBookmarkedProjectsTreeProvider(
          [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
          [[fakeAccount1.apiUrl, [fooProjWithPackages]]]
        );

        this.fixture.fetchProjectMock.resolves(fooProjWithPackages);

        const projElem = new ProjectTreeElement(fooProj);

        await vscode.commands.executeCommand(UPDATE_PROJECT_COMMAND, projElem);
        this.fixture.mockMemento.update.should.have.callCount(0);

        // now we have to check that the project tree provider is actually aware
        // of this change, do that via getChildren() as we cannot access the
        // activeProject property
        const pkgElems = await projectTree.getChildren(projElem);

        expect(pkgElems)
          .to.be.an("array")
          .and.have.length(fooProjWithPackages.packages!.length);

        pkgElems.forEach((elem, i) => {
          isPackageTreeElement(elem).should.be.true;
          elem.should.deep.include({
            packageName: fooProjWithPackages.packages![i].name,
            parentProject: new BaseProject(fooProjWithPackages)
          });
        });
      })
    );

    xit(
      "updates the project bookmark when fetching it succeeds",
      castToAsyncFunc<FixtureContext>(async function () {
        await this.fixture.createBookmarkedProjectsTreeProvider(
          [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
          [[fakeAccount1.apiUrl, [fooProjWithPackages]]]
        );

        this.fixture.fetchProjectMock.resolves(fooProjWithPackages);

        const projElem = new ProjectTreeElement(fooProj);

        await vscode.commands.executeCommand(UPDATE_PROJECT_COMMAND, projElem);

        this.fixture.sandbox.assert.calledOnce(this.fixture.mockMemento.update);
        this.fixture.mockMemento.update
          .getCall(0)
          .args[1].should.deep.equal([
            [fakeAccount1.apiUrl, [fooProjWithPackages]]
          ]);
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
          [[fakeAccount1.apiUrl, [fooProj]]]
        );

        const fooProjTreeElem = new ProjectTreeElement(fooProj);

        await vscode.commands.executeCommand(
          UPDATE_PROJECT_COMMAND,
          fooProjTreeElem
        );

        this.fixture.vscodeWindow.showErrorMessage.should.have.been.calledOnceWith(
          match(
            `Cannot fetch project ${fooProj.name} from ${fooProj.apiUrl}: no account is configured`
          )
        );
        this.fixture.sandbox.assert.notCalled(this.fixture.mockMemento.update);
      })
    );
  });
});
