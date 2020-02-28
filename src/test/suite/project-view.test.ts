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

import { afterEach, beforeEach, Context, describe, it } from "mocha";
import * as obs_ts from "obs-ts";
import { createSandbox } from "sinon";
import { ImportMock } from "ts-mock-imports";
import * as vscode from "vscode";
import { ApiUrl, ValidAccount } from "../../accounts";
import {
  BookmarkedProjectsRootElement,
  ObsServerTreeElement,
  PackageTreeElement,
  ProjectTreeElement,
  ProjectTreeProvider
} from "../../project-view";
import {
  fakeAccount1,
  fakeAccount2,
  fakeApi1ValidAcc,
  fakeApi2ValidAcc
} from "./test-data";
import {
  castToAsyncFunc,
  createStubbedVscodeWindow,
  FakeActiveAccounts,
  LoggingFixture,
  makeFakeEvent,
  testLogger
} from "./test-utils";

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

const fooPkg: obs_ts.Package = { name: "fooPkg", project: fooProj.name };
const foo2Pkg: obs_ts.Package = { name: "foo2Pkg", project: fooProj.name };
const packages = [fooPkg, foo2Pkg];

const fooProjWithPackages: obs_ts.Project = {
  ...fooProj,
  packages
};

const [fileA, fileB]: obs_ts.PackageFile[] = ["fileA", "fileB"].map(name => ({
  name,
  packageName: fooPkg.name,
  projectName: fooProjWithPackages.name
}));

const barPkg: obs_ts.Package = {
  name: "barPkg",
  project: barProj.name
};

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

class ProjectTreeFixture extends LoggingFixture {
  public readonly fakeActiveProject = makeFakeEvent<obs_ts.Project>();
  public readonly fakeActiveAccounts = makeFakeEvent<ApiUrl[]>();
  public readonly sandbox = createSandbox();

  public readonly mockMemento = {
    get: this.sandbox.stub(),
    update: this.sandbox.stub()
  };
  public readonly vscodeWindow = createStubbedVscodeWindow(this.sandbox);

  public readonly getProjectMock = ImportMock.mockFunction(
    obs_ts,
    "getProject"
  );

  public readonly fetchPackageMock = ImportMock.mockFunction(
    obs_ts,
    "fetchPackage"
  );

  constructor(ctx: Context) {
    super();
    super.beforeEach(ctx);
  }

  public createProjectTreeProvider(
    activeAccountsInitializer: Array<[ApiUrl, ValidAccount]> = [],
    initialBookmarks: Array<[ApiUrl, obs_ts.Project[]]> = []
  ): ProjectTreeProvider {
    this.mockMemento.get.returns(initialBookmarks);

    const activeAccounts = new FakeActiveAccounts(
      new Map(activeAccountsInitializer)
    );

    const projTreeProv = new ProjectTreeProvider(
      this.fakeActiveProject.event,
      this.fakeActiveAccounts.event,
      activeAccounts,
      this.mockMemento,
      testLogger,
      this.vscodeWindow
    );

    return projTreeProv;
  }

  public afterEach(ctx: Context) {
    this.sandbox.restore();
    this.getProjectMock.restore();
    this.fetchPackageMock.restore();

    super.afterEach(ctx);
  }
}

type FixtureContext = {
  fixture: ProjectTreeFixture;
} & Mocha.Context;

describe("ProjectTreeProvider", () => {
  beforeEach(function() {
    this.fixture = new ProjectTreeFixture(this);
  });

  afterEach(function() {
    this.fixture.afterEach(this);
  });

  const testProject: obs_ts.Project = {
    apiUrl: "api.foo.org",
    name: "testProject"
  };

  describe("#getChildren", () => {
    describe("children of the top level element", () => {
      it(
        "returns a Bookmark element when no project is active",
        castToAsyncFunc<FixtureContext>(async function() {
          const projectTree: ProjectTreeProvider = this.fixture.createProjectTreeProvider();
          const children = await projectTree.getChildren(undefined).should.be
            .fulfilled;

          children.should.deep.equal([
            {
              collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
              contextValue: "BookmarkedProjectsRoot",
              iconPath: {
                dark: "media/bookmark.svg",
                light: "media/bookmark_border.svg"
              },
              label: "Bookmarked Projects"
            }
          ]);
        })
      );

      it(
        "returns a Bookmark element and an active project element",
        castToAsyncFunc<FixtureContext>(async function() {
          const projectTree: ProjectTreeProvider = this.fixture.createProjectTreeProvider();
          this.fixture.fakeActiveProject.fire(testProject);

          const children = await projectTree.getChildren(undefined).should.be
            .fulfilled;

          children.should.deep.equal([
            {
              collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
              contextValue: "BookmarkedProjectsRoot",
              iconPath: {
                dark: "media/bookmark.svg",
                light: "media/bookmark_border.svg"
              },
              label: "Bookmarked Projects"
            },
            {
              bookmark: false,
              collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
              contextValue: "project",
              iconPath: "media/Noun_Project_projects_icon_1327109_cc.svg",
              label: `Current project: ${testProject.name}`,
              parent: undefined,
              project: testProject
            }
          ]);
        })
      );
    });

    describe("children of the Bookmark element", () => {
      it(
        "returns no children, if no Accounts are present",
        castToAsyncFunc<FixtureContext>(async function() {
          const projectTree: ProjectTreeProvider = this.fixture.createProjectTreeProvider();
          const bookmarkElement = new BookmarkedProjectsRootElement();

          await projectTree
            .getChildren(bookmarkElement)
            .should.be.fulfilled.and.eventually.deep.equal([]);
        })
      );

      it(
        "returns an empty array when no projects are bookmarked and only one account is present",
        castToAsyncFunc<FixtureContext>(async function() {
          const projectTree: ProjectTreeProvider = this.fixture.createProjectTreeProvider(
            [[fakeAccount1.apiUrl, fakeApi1ValidAcc]]
          );
          const bookmarkElement = new BookmarkedProjectsRootElement();

          await projectTree
            .getChildren(bookmarkElement)
            .should.be.fulfilled.and.eventually.deep.equal([]);
        })
      );

      it(
        "returns an array of project bookmarks if only one account is present",
        castToAsyncFunc<FixtureContext>(async function() {
          const projectTree: ProjectTreeProvider = this.fixture.createProjectTreeProvider(
            [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
            [[fakeAccount1.apiUrl, [fooProj]]]
          );
          const bookmarkElement = new BookmarkedProjectsRootElement();

          await projectTree
            .getChildren(bookmarkElement)
            .should.be.fulfilled.and.eventually.deep.equal([
              {
                bookmark: true,
                collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
                contextValue: "project",
                iconPath: "media/Noun_Project_projects_icon_1327109_cc.svg",
                label: fooProj.name,
                parent: undefined,
                project: fooProj
              }
            ]);
        })
      );

      it(
        "returns ObsServerTreeElements as children of the bookmark element for each Account",
        castToAsyncFunc<FixtureContext>(async function() {
          const projectTree: ProjectTreeProvider = this.fixture.createProjectTreeProvider(
            [
              [fakeAccount1.apiUrl, fakeApi1ValidAcc],
              [fakeAccount2.apiUrl, fakeApi2ValidAcc]
            ]
          );
          const bookmarkElement = new BookmarkedProjectsRootElement();

          const children = await projectTree.getChildren(bookmarkElement).should
            .be.fulfilled;

          children.should.contain.a.thing.that.deep.equals({
            account: fakeAccount1,
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
            contextValue: "ObsServer",
            iconPath: "media/api.svg",
            label: fakeAccount1.accountName
          });
          children.should.contain.a.thing.that.deep.equals({
            account: fakeAccount2,
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
            contextValue: "ObsServer",
            iconPath: "media/api.svg",
            label: fakeAccount2.accountName
          });
          children.should.be.a("array").and.have.length(2);
        })
      );
    });

    describe("children of the ObsServer element", () => {
      it(
        "returns the list of project bookmarks for this server",
        castToAsyncFunc<FixtureContext>(async function() {
          const commonEntries = {
            bookmark: true,
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
            contextValue: "project",
            iconPath: "media/Noun_Project_projects_icon_1327109_cc.svg"
          };

          const projectTree: ProjectTreeProvider = this.fixture.createProjectTreeProvider(
            [
              [fakeAccount1.apiUrl, fakeApi1ValidAcc],
              [fakeAccount2.apiUrl, fakeApi2ValidAcc]
            ],
            [
              [fakeAccount1.apiUrl, [fooProj, barProj]],
              [fakeAccount2.apiUrl, [bazProj]]
            ]
          );

          const obsServer1Element = new ObsServerTreeElement(fakeAccount1);
          await projectTree
            .getChildren(obsServer1Element)
            .should.be.fulfilled.and.eventually.deep.equal([
              {
                ...commonEntries,
                label: fooProj.name,
                parent: obsServer1Element,
                project: fooProj
              },
              {
                ...commonEntries,
                label: barProj.name,
                parent: obsServer1Element,
                project: barProj
              }
            ]);

          const obsServer2Element = new ObsServerTreeElement(fakeAccount2);
          await projectTree
            .getChildren(obsServer2Element)
            .should.be.fulfilled.and.eventually.deep.equal([
              {
                ...commonEntries,
                label: bazProj.name,
                parent: obsServer2Element,
                project: bazProj
              }
            ]);
        })
      );
    });

    describe("children of the Project Element", () => {
      const commonPackageEntries = {
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        contextValue: "package",
        iconPath: "media/package.svg"
      };

      it(
        "returns the package list if the project has saved packages",
        castToAsyncFunc<FixtureContext>(async function() {
          const projectTree: ProjectTreeProvider = this.fixture.createProjectTreeProvider(
            [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
            [[fakeAccount1.apiUrl, [fooProjWithPackages, barProj]]]
          );

          const projElemen = new ProjectTreeElement(fooProjWithPackages, false);

          const children = await projectTree
            .getChildren(projElemen)
            .should.be.fulfilled.and.eventually.be.an("array")
            .and.have.lengthOf(2);

          children.map((child: any, i: number) => {
            child.should.deep.include({
              ...commonPackageEntries,
              label: packages[i].name,
              parent: projElemen
            });
            child.should.have.property("command").that.deep.includes({
              command: "obsProject.updatePackage",
              title: "Update this packages contents and data"
            });
          });

          this.fixture.sandbox.assert.notCalled(this.fixture.getProjectMock);
        })
      );

      it(
        "tries to fetch the package list if the project has no saved packages",
        castToAsyncFunc<FixtureContext>(async function() {
          const projectTree: ProjectTreeProvider = this.fixture.createProjectTreeProvider(
            [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
            [[fakeAccount1.apiUrl, [fooProj, barProj]]]
          );

          const projElemen = new ProjectTreeElement(fooProj, true);

          this.fixture.getProjectMock.resolves(fooProjWithPackages);

          const children = await projectTree
            .getChildren(projElemen)
            .should.be.fulfilled.and.eventually.be.an("array")
            .and.have.lengthOf(2);

          children.map((child: any, i: number) => {
            child.should.deep.include({
              ...commonPackageEntries,
              label: packages[i].name,
              parent: projElemen
            });
            child.should.have.property("command").that.deep.includes({
              command: "obsProject.updatePackage",
              title: "Update this packages contents and data"
            });
          });

          this.fixture.sandbox.assert.calledOnce(this.fixture.getProjectMock);
          this.fixture.sandbox.assert.calledWith(
            this.fixture.getProjectMock.firstCall,
            fakeApi1ValidAcc.connection,
            fooProj.name,
            true
          );

          // the project bookmarks should have been updated
          // => no more fetching is necessary
          await projectTree
            .getChildren(projElemen)
            .should.be.fulfilled.and.eventually.deep.equal(children);
          this.fixture.sandbox.assert.calledOnce(this.fixture.getProjectMock);
        })
      );

      it(
        "it returns an empty array if the project has no saved packages and no configured account exists",
        castToAsyncFunc<FixtureContext>(async function() {
          const projectTree: ProjectTreeProvider = this.fixture.createProjectTreeProvider(
            [],
            [[fakeAccount1.apiUrl, [fooProj, barProj]]]
          );

          const projElement = new ProjectTreeElement(fooProj, false);

          await projectTree
            .getChildren(projElement)
            .should.be.fulfilled.and.eventually.be.deep.equal([]);

          this.fixture.sandbox.assert.notCalled(this.fixture.getProjectMock);
        })
      );

      it(
        "does not try to save non-bookmarked projects",
        castToAsyncFunc<FixtureContext>(async function() {
          const projectTree: ProjectTreeProvider = this.fixture.createProjectTreeProvider(
            [[fakeAccount1.apiUrl, fakeApi1ValidAcc]]
          );

          this.fixture.getProjectMock.resolves(fooProjWithPackages);

          const projElement = new ProjectTreeElement(fooProj, false);
          await projectTree.getChildren(projElement).should.be.fulfilled;

          this.fixture.sandbox.assert.notCalled(
            this.fixture.mockMemento.update
          );
          this.fixture.sandbox.assert.calledOnce(this.fixture.getProjectMock);
        })
      );
    });

    describe("children of the Package Element", () => {
      it(
        "returns an empty array when no files are known and no account is present",
        castToAsyncFunc<FixtureContext>(async function() {
          const projectTree: ProjectTreeProvider = this.fixture.createProjectTreeProvider(
            [],
            [[fakeAccount1.apiUrl, [fooProjWithPackages, barProj]]]
          );

          const projElement = new ProjectTreeElement(
            fooProjWithPackages,
            false
          );
          const pkgElement = new PackageTreeElement(fooPkg, projElement);

          await projectTree
            .getChildren(pkgElement)
            .should.be.fulfilled.and.eventually.deep.equal([]);

          this.fixture.sandbox.assert.notCalled(this.fixture.fetchPackageMock);
        })
      );

      it(
        "returns the known files as PackageTreeElements",
        castToAsyncFunc<FixtureContext>(async function() {
          const projectTree: ProjectTreeProvider = this.fixture.createProjectTreeProvider(
            [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
            [[fakeAccount1.apiUrl, [barProjWithPackages]]]
          );

          const projElement = new ProjectTreeElement(
            barProjWithPackages,
            false
          );
          const pkgElement = new PackageTreeElement(
            barPkgWithFiles,
            projElement
          );

          const fileElements = await projectTree
            .getChildren(pkgElement)
            .should.be.fulfilled.and.eventually.be.an("array")
            .and.have.lengthOf(2);

          const commonFileEntries = {
            collapsibleState: vscode.TreeItemCollapsibleState.None,
            contextValue: "packageFile",
            iconPath: "media/insert_drive_file.svg",
            parent: pkgElement
          };

          barPkgWithFiles.files!.map((pkg, i) => {
            fileElements[i].should.deep.include({
              ...commonFileEntries,
              label: pkg.name,
              pkgFile: pkg
            });
          });
          this.fixture.sandbox.assert.notCalled(this.fixture.fetchPackageMock);
        })
      );

      it(
        "fetches the files from OBS if none are present and a connection exists",
        castToAsyncFunc<FixtureContext>(async function() {
          const projectTree: ProjectTreeProvider = this.fixture.createProjectTreeProvider(
            [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
            [[fakeAccount1.apiUrl, [barProjWithPackagesWithoutFiles]]]
          );

          this.fixture.fetchPackageMock.resolves(barPkgWithFiles);

          const projElement = new ProjectTreeElement(
            barProjWithPackagesWithoutFiles,
            true
          );
          const pkgElement = new PackageTreeElement(barPkg, projElement);

          const fileElements = await projectTree
            .getChildren(pkgElement)
            .should.be.fulfilled.and.eventually.be.an("array")
            .and.have.lengthOf(2);

          const commonFileEntries = {
            collapsibleState: vscode.TreeItemCollapsibleState.None,
            contextValue: "packageFile",
            iconPath: "media/insert_drive_file.svg",
            parent: pkgElement
          };

          barPkgWithFiles.files!.map((pkg, i) => {
            fileElements[i].should.deep.include({
              ...commonFileEntries,
              label: pkg.name,
              pkgFile: pkg
            });
          });

          this.fixture.sandbox.assert.calledOnce(this.fixture.fetchPackageMock);
          this.fixture.sandbox.assert.calledWith(
            this.fixture.fetchPackageMock.firstCall,
            fakeApi1ValidAcc.connection,
            barProj.name,
            barPkg.name,
            { pkgContents: false, historyFetchType: 0 }
          );

          // the project should have now been updated => when we request the same
          // thing again, then fetchPackage must not be called again
          await projectTree
            .getChildren(pkgElement)
            .should.be.fulfilled.and.eventually.deep.equal(fileElements);
          this.fixture.sandbox.assert.calledOnce(this.fixture.fetchPackageMock);
        })
      );

      it(
        "Does not try to save packages of non bookmarked projects",
        castToAsyncFunc<FixtureContext>(async function() {
          const projectTree: ProjectTreeProvider = this.fixture.createProjectTreeProvider(
            [[fakeAccount1.apiUrl, fakeApi1ValidAcc]]
          );

          this.fixture.fetchPackageMock.resolves(barPkgWithFiles);

          const projElement = new ProjectTreeElement(
            barProjWithPackagesWithoutFiles,
            false
          );
          const pkgElement = new PackageTreeElement(barPkg, projElement);

          const fileElements = await projectTree.getChildren(pkgElement).should
            .be.fulfilled;

          this.fixture.sandbox.assert.calledOnce(this.fixture.fetchPackageMock);
          this.fixture.sandbox.assert.notCalled(
            this.fixture.mockMemento.update
          );

          // the project has not been updated, so if we try to get the children
          // again, we end up having to call fetchPackage again
          await projectTree
            .getChildren(pkgElement)
            .should.be.fulfilled.and.eventually.deep.equal(fileElements);
          this.fixture.sandbox.assert.calledTwice(
            this.fixture.fetchPackageMock
          );
        })
      );
    });
  });

  describe("#updatePackage", () => {
    const projTreeItem = new ProjectTreeElement(
      barProjWithPackagesWithoutFiles,
      false
    );
    const pkgTreeItem = new PackageTreeElement(barPkg, projTreeItem);

    it(
      "tries to refetch the package contents",
      castToAsyncFunc<FixtureContext>(async function() {
        const projectTree = this.fixture.createProjectTreeProvider(
          [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
          [[fakeAccount1.apiUrl, [barProjWithPackagesWithoutFiles]]]
        );

        this.fixture.fetchPackageMock.resolves(barPkgWithFiles);

        await projectTree.updatePackage(pkgTreeItem).should.be.fulfilled;

        this.fixture.sandbox.assert.calledOnce(this.fixture.fetchPackageMock);
        this.fixture.sandbox.assert.calledWith(
          this.fixture.fetchPackageMock,
          fakeApi1ValidAcc.connection,
          barProjWithPackagesWithoutFiles.name,
          barPkg.name,
          { pkgContents: false }
        );

        this.fixture.sandbox.assert.calledOnce(this.fixture.mockMemento.update);
        const [key, savedBookmarks] = this.fixture.mockMemento.update.getCall(
          0
        ).args;
        key.should.be.a("string");
        savedBookmarks.should.deep.equal([
          [fakeAccount1.apiUrl, [barProjWithPackages]]
        ]);
      })
    );

    it(
      "appends the package if the project bookmark has already packages",
      castToAsyncFunc<FixtureContext>(async function() {
        const bar2Pkg: obs_ts.Package = { name: "bar2", project: barProj.name };
        const projectTree = this.fixture.createProjectTreeProvider(
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

        this.fixture.fetchPackageMock.resolves(barPkgWithFiles);

        await projectTree.updatePackage(pkgTreeItem).should.be.fulfilled;

        this.fixture.sandbox.assert.calledOnce(this.fixture.fetchPackageMock);

        this.fixture.sandbox.assert.calledOnce(this.fixture.mockMemento.update);
        const [key, savedBookmarks] = this.fixture.mockMemento.update.getCall(
          0
        ).args;
        key.should.be.a("string");

        savedBookmarks.should.deep.equal([
          [
            fakeAccount1.apiUrl,
            [{ ...barProj, packages: [bar2Pkg, barPkgWithFiles] }]
          ]
        ]);
      })
    );

    it(
      "logs an error if no account is present for this project",
      castToAsyncFunc<FixtureContext>(async function() {
        const projectTree = this.fixture.createProjectTreeProvider(
          [],
          [[fakeAccount1.apiUrl, [barProjWithPackagesWithoutFiles]]]
        );

        await projectTree.updatePackage(pkgTreeItem).should.be.fulfilled;

        this.fixture.sandbox.assert.notCalled(this.fixture.mockMemento.update);
      })
    );

    it(
      "does not save a package in the bookmarks whose parent project is not bookmarked",
      castToAsyncFunc<FixtureContext>(async function() {
        const projectTree = this.fixture.createProjectTreeProvider(
          [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
          []
        );

        await projectTree.updatePackage(pkgTreeItem).should.be.fulfilled;

        this.fixture.sandbox.assert.notCalled(this.fixture.mockMemento.update);
      })
    );

    it(
      "logs an error if the provided element is invalid or of the wrong type",
      castToAsyncFunc<FixtureContext>(async function() {
        const projectTree = this.fixture.createProjectTreeProvider(
          [],
          [[fakeAccount1.apiUrl, [barProjWithPackagesWithoutFiles]]]
        );

        await projectTree.updatePackage(projTreeItem).should.be.fulfilled;
        await projectTree.updatePackage().should.be.fulfilled;

        this.fixture.sandbox.assert.notCalled(this.fixture.mockMemento.update);
      })
    );
  });

  describe("#addProjectToBookmarksTreeButton", () => {
    const bookmarkRoot = new BookmarkedProjectsRootElement();

    it(
      "adds a project to the bookmarks including all packages",
      castToAsyncFunc<FixtureContext>(async function() {
        const projectTree = this.fixture.createProjectTreeProvider(
          [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
          [[fakeAccount1.apiUrl, [barProj]]]
        );

        // project selection
        this.fixture.vscodeWindow.showInputBox.onCall(0).resolves(fooProj.name);

        this.fixture.getProjectMock.resolves(fooProjWithPackages);

        await projectTree.addProjectToBookmarksTreeButton(
          bookmarkRoot
        ).should.be.fulfilled;

        this.fixture.sandbox.assert.calledOnce(
          this.fixture.vscodeWindow.showInputBox
        );
        this.fixture.vscodeWindow.showInputBox
          .getCall(0)
          .args[0].should.deep.include({
            ignoreFocusOut: true,
            prompt: "Provide the name of the project that you want to add"
          });

        this.fixture.sandbox.assert.calledOnce(this.fixture.mockMemento.update);
        const [key, newBookmarks] = this.fixture.mockMemento.update.getCall(
          0
        ).args;
        key.should.be.a("string");
        newBookmarks.should.deep.equal([
          [fakeAccount1.apiUrl, [barProj, fooProjWithPackages]]
        ]);
      })
    );

    describe("add a project with many packages", () => {
      const projWith12Packages: obs_ts.Project = {
        apiUrl: fakeAccount1.apiUrl,
        name: "devl",
        packages: [...Array(12).keys()].map(num => ({
          name: `pkg_${num}`,
          project: "devl"
        }))
      };

      beforeEach(function() {
        this.fixture.vscodeWindow.showInputBox
          .onCall(0)
          .resolves(projWith12Packages.name);

        this.fixture.getProjectMock.resolves(projWith12Packages);
      });

      it(
        "includes all packages when the user says so",
        castToAsyncFunc<FixtureContext>(async function() {
          const projectTree = this.fixture.createProjectTreeProvider(
            [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
            [[fakeAccount1.apiUrl, [barProj]]]
          );

          this.fixture.vscodeWindow.showInformationMessage
            .onCall(0)
            .resolves("Yes");

          await projectTree.addProjectToBookmarksTreeButton(
            bookmarkRoot
          ).should.be.fulfilled;

          this.fixture.sandbox.assert.calledOnce(
            this.fixture.vscodeWindow.showInformationMessage
          );
          this.fixture.sandbox.assert.calledWith(
            this.fixture.vscodeWindow.showInformationMessage,
            "This project has 12 packages, add them all?",
            "Yes",
            "No"
          );

          this.fixture.sandbox.assert.calledOnce(
            this.fixture.mockMemento.update
          );
          const [_key, newBookmarks] = this.fixture.mockMemento.update.getCall(
            0
          ).args;

          newBookmarks.should.deep.equal([
            [fakeAccount1.apiUrl, [barProj, projWith12Packages]]
          ]);
        })
      );

      it(
        "doesn't bookmark the project if the user let's the prompt whether add all packages time out",
        castToAsyncFunc<FixtureContext>(async function() {
          const projectTree = this.fixture.createProjectTreeProvider(
            [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
            [[fakeAccount1.apiUrl, [barProj]]]
          );

          this.fixture.vscodeWindow.showInformationMessage
            .onCall(0)
            .resolves(undefined);

          await projectTree.addProjectToBookmarksTreeButton(
            bookmarkRoot
          ).should.be.fulfilled;

          this.fixture.sandbox.assert.notCalled(
            this.fixture.mockMemento.update
          );
        })
      );

      it(
        "asks the user which packages to include and bookmarks only these",
        castToAsyncFunc<FixtureContext>(async function() {
          const projectTree = this.fixture.createProjectTreeProvider(
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

          await projectTree.addProjectToBookmarksTreeButton(
            bookmarkRoot
          ).should.be.fulfilled;

          this.fixture.sandbox.assert.calledOnce(
            this.fixture.vscodeWindow.showQuickPick
          );
          const [
            pkgNames,
            quickPickOptions
          ] = this.fixture.vscodeWindow.showQuickPick.getCall(0).args;
          pkgNames.should.deep.equal(
            projWith12Packages.packages?.map(pkg => pkg.name)
          );
          quickPickOptions.should.deep.include({ canPickMany: true });

          this.fixture.sandbox.assert.calledOnce(
            this.fixture.mockMemento.update
          );
          const [_key, newBookmarks] = this.fixture.mockMemento.update.getCall(
            0
          ).args;

          newBookmarks.should.deep.equal([
            [
              fakeAccount1.apiUrl,
              [
                barProj,
                {
                  apiUrl: projWith12Packages.apiUrl,
                  name: projWith12Packages.name,
                  packages: projWith12Packages.packages!.filter(
                    pkg =>
                      pickedPkgNames.find(pkgName => pkg.name === pkgName) !==
                      undefined
                  )
                }
              ]
            ]
          ]);
        })
      );

      it(
        "asks the user which packages to include but does not bookmark anything if the prompt times out",
        castToAsyncFunc<FixtureContext>(async function() {
          const projectTree = this.fixture.createProjectTreeProvider(
            [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
            [[fakeAccount1.apiUrl, [barProj]]]
          );

          this.fixture.vscodeWindow.showInformationMessage
            .onCall(0)
            .resolves("No");
          this.fixture.vscodeWindow.showQuickPick.onCall(0).resolves(undefined);

          await projectTree.addProjectToBookmarksTreeButton(
            bookmarkRoot
          ).should.be.fulfilled;

          this.fixture.sandbox.assert.calledOnce(
            this.fixture.vscodeWindow.showQuickPick
          );
          this.fixture.sandbox.assert.notCalled(
            this.fixture.mockMemento.update
          );
        })
      );
    });

    it(
      "reports an error if no accounts are configured",
      castToAsyncFunc<FixtureContext>(async function() {
        const projectTree = this.fixture.createProjectTreeProvider();

        await projectTree.addProjectToBookmarksTreeButton().should.be.fulfilled;

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
      castToAsyncFunc<FixtureContext>(async function() {
        const projectTree = this.fixture.createProjectTreeProvider([
          [fakeAccount1.apiUrl, fakeApi1ValidAcc]
        ]);

        this.fixture.vscodeWindow.showInputBox.onCall(0).resolves(undefined);

        await projectTree.addProjectToBookmarksTreeButton(
          bookmarkRoot
        ).should.be.fulfilled;

        this.fixture.sandbox.assert.calledOnce(
          this.fixture.vscodeWindow.showInputBox
        );
        this.fixture.sandbox.assert.notCalled(this.fixture.mockMemento.update);
      })
    );

    describe("project that fails to be fetched", () => {
      const projName = "test_project";
      const errMsg = `Unknown project ${projName}`;

      beforeEach(function() {
        this.fixture.vscodeWindow.showInputBox.onCall(0).resolves(projName);
        this.fixture.getProjectMock.onCall(0).throws(Error(errMsg));
      });

      it(
        "does not bookmark anything if the project cannot be fetched and the user does not want to add it",
        castToAsyncFunc<FixtureContext>(async function() {
          const projectTree = this.fixture.createProjectTreeProvider([
            [fakeAccount1.apiUrl, fakeApi1ValidAcc]
          ]);

          this.fixture.vscodeWindow.showErrorMessage
            .onCall(0)
            .resolves("Cancel");

          await projectTree.addProjectToBookmarksTreeButton(
            bookmarkRoot
          ).should.be.fulfilled;

          this.fixture.sandbox.assert.calledOnce(
            this.fixture.vscodeWindow.showInputBox
          );
          this.fixture.sandbox.assert.calledOnce(
            this.fixture.vscodeWindow.showErrorMessage
          );
          this.fixture.sandbox.assert.calledWith(
            this.fixture.vscodeWindow.showErrorMessage,
            `Adding a bookmark for the project ${projName} using the account ${fakeAccount1.accountName} failed with: Error: ${errMsg}.`,
            "Add anyway",
            "Cancel"
          );
          this.fixture.sandbox.assert.notCalled(
            this.fixture.mockMemento.update
          );
        })
      );

      it(
        "bookmarks a project that failed to load when instructed to do so",
        castToAsyncFunc<FixtureContext>(async function() {
          const projectTree = this.fixture.createProjectTreeProvider([
            [fakeAccount1.apiUrl, fakeApi1ValidAcc]
          ]);

          this.fixture.vscodeWindow.showErrorMessage
            .onCall(0)
            .resolves("Add anyway");

          await projectTree.addProjectToBookmarksTreeButton(
            bookmarkRoot
          ).should.be.fulfilled;

          this.fixture.sandbox.assert.calledOnce(
            this.fixture.vscodeWindow.showInputBox
          );
          this.fixture.sandbox.assert.calledOnce(
            this.fixture.vscodeWindow.showErrorMessage
          );

          this.fixture.sandbox.assert.calledOnce(
            this.fixture.mockMemento.update
          );
          const [_key, newBookmarks] = this.fixture.mockMemento.update.getCall(
            0
          ).args;
          newBookmarks.should.deep.equal([
            [
              fakeAccount1.apiUrl,
              [{ apiUrl: fakeAccount1.apiUrl, name: projName }]
            ]
          ]);
        })
      );
    });

    it(
      "uses the correct connection when bookmarking projects from a ObsServerTreeElement",
      castToAsyncFunc<FixtureContext>(async function() {
        const projectTree = this.fixture.createProjectTreeProvider([
          [fakeAccount1.apiUrl, fakeApi1ValidAcc],
          [fakeAccount2.apiUrl, fakeApi2ValidAcc]
        ]);

        const fakeApi1ObsServerTreeElement = new ObsServerTreeElement(
          fakeAccount1
        );

        this.fixture.vscodeWindow.showInputBox.onCall(0).resolves(fooProj.name);

        this.fixture.getProjectMock.resolves(fooProjWithPackages);

        await projectTree.addProjectToBookmarksTreeButton(
          fakeApi1ObsServerTreeElement
        ).should.be.fulfilled;

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
      castToAsyncFunc<FixtureContext>(async function() {
        const projects = [
          fooProj,
          barProj,
          { apiUrl: fakeAccount1.apiUrl, name: "another_project" }
        ];
        const projectTree = this.fixture.createProjectTreeProvider(
          [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
          [[fakeAccount1.apiUrl, projects]]
        );

        const projElem = new ProjectTreeElement(barProj, false);

        await projectTree.removeBookmark(projElem).should.be.fulfilled;

        this.fixture.sandbox.assert.calledOnce(this.fixture.mockMemento.update);
        this.fixture.mockMemento.update
          .getCall(0)
          .args[1].should.deep.equal([
            [fakeAccount1.apiUrl, [fooProj, projects[2]]]
          ]);
      })
    );
  });

  describe("#refreshProject", () => {
    it(
      "updates the active project when fetching it succeeds",
      castToAsyncFunc<FixtureContext>(async function() {
        const projectTree = this.fixture.createProjectTreeProvider(
          [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
          [[fakeAccount1.apiUrl, [fooProj]]]
        );

        this.fixture.getProjectMock.resolves(fooProjWithPackages);
        this.fixture.fakeActiveProject.fire(fooProj);

        const projElem = new ProjectTreeElement(fooProj, false);

        await projectTree.refreshProject(projElem).should.be.fulfilled;
        this.fixture.sandbox.assert.notCalled(this.fixture.mockMemento.update);

        // now we have to check that the project tree provider is actually aware
        // of this change, do that via getChildren() as we cannot access the
        // activeProject property
        const pkgElems = await projectTree.getChildren(projElem).should.be
          .fulfilled;

        pkgElems.should.be
          .an("array")
          .and.have.length(fooProjWithPackages.packages!.length);
        pkgElems.forEach((elem: PackageTreeElement, i: number) =>
          elem.pkg.should.deep.equal(fooProjWithPackages.packages![i])
        );
      })
    );

    it(
      "updates the project bookmark when fetching it succeeds",
      castToAsyncFunc<FixtureContext>(async function() {
        const projectTree = this.fixture.createProjectTreeProvider(
          [[fakeAccount1.apiUrl, fakeApi1ValidAcc]],
          [[fakeAccount1.apiUrl, [fooProj]]]
        );

        this.fixture.getProjectMock.resolves(fooProjWithPackages);

        const projElem = new ProjectTreeElement(fooProj, true);

        await projectTree.refreshProject(projElem).should.be.fulfilled;

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
      castToAsyncFunc<FixtureContext>(async function() {
        const projectTree = this.fixture.createProjectTreeProvider();

        await projectTree.refreshProject().should.be.fulfilled;

        this.fixture.sandbox.assert.notCalled(this.fixture.mockMemento.update);
      })
    );

    it(
      "reports to the user if there is no account present for this project",
      castToAsyncFunc<FixtureContext>(async function() {
        const projectTree = this.fixture.createProjectTreeProvider(
          [],
          [[fakeAccount1.apiUrl, [fooProj]]]
        );

        const fooProjTreeElem = new ProjectTreeElement(fooProj, false);
        this.fixture.fakeActiveProject.fire(fooProj);

        await projectTree.refreshProject(fooProjTreeElem).should.be.fulfilled;

        this.fixture.sandbox.assert.calledOnce(
          this.fixture.vscodeWindow.showErrorMessage
        );
        this.fixture.sandbox.assert.calledWith(
          this.fixture.vscodeWindow.showErrorMessage,
          `Error: Cannot update the project ${fooProj.name}, the corresponding account does not exist`
        );
        this.fixture.sandbox.assert.notCalled(this.fixture.mockMemento.update);
      })
    );
  });
});
