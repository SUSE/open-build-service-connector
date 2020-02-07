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

import { afterEach, beforeEach, describe, it } from "mocha";
import * as obs_ts from "obs-ts";
import { PackageFile } from "obs-ts/lib/file";
import { createSandbox } from "sinon";
import { ImportMock } from "ts-mock-imports";
import * as vscode from "vscode";
import { ApiAccountMapping, ApiUrl, ObsInstance } from "../../accounts";
import {
  BookmarkedProjectsRootElement,
  ObsServerTreeElement,
  PackageTreeElement,
  ProjectTreeElement,
  ProjectTreeProvider
} from "../../project-view";
import { VscodeWindow } from "../../vscode-dep";
import {
  fakeAccount1,
  fakeAccount2,
  fakeApi1Info,
  fakeApi2Info
} from "./test-data";
import { createStubbedVscodeWindow, logger, makeFakeEvent } from "./test-utils";

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

const [fileA, fileB]: PackageFile[] = ["fileA", "fileB"].map(name => ({
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

const fakeApi1WithCon: ObsInstance = {
  ...fakeApi1Info,
  connection: new obs_ts.Connection("fooUser", "fooPw")
};

class ProjectTreeFixture {
  public readonly fakeActiveProject = makeFakeEvent<obs_ts.Project>();
  public readonly fakeCurrentConnection = makeFakeEvent<ApiAccountMapping>();
  public readonly sandbox = createSandbox();

  public readonly mockMemento = {
    get: this.sandbox.stub(),
    update: this.sandbox.stub()
  };
  public readonly vscodeWindow: VscodeWindow = createStubbedVscodeWindow(
    this.sandbox
  );

  public readonly getProjectMock = ImportMock.mockFunction(
    obs_ts,
    "getProject"
  );

  public readonly fetchPackageMock = ImportMock.mockFunction(
    obs_ts,
    "fetchPackage"
  );

  public createProjectTreeProvider(
    apiAccountMap: ApiAccountMapping = {
      defaultApi: undefined,
      mapping: new Map()
    },
    initialBookmarks: Array<[ApiUrl, obs_ts.Project[]]> = []
  ): ProjectTreeProvider {
    this.mockMemento.get.returns(initialBookmarks);

    const projTreeProv = new ProjectTreeProvider(
      this.fakeActiveProject.event,
      this.fakeCurrentConnection.event,
      this.mockMemento,
      logger,
      this.vscodeWindow
    );

    this.fakeCurrentConnection.fire(apiAccountMap);
    return projTreeProv;
  }

  public tearDown() {
    this.sandbox.restore();
    this.getProjectMock.restore();
    this.fetchPackageMock.restore();
  }
}

describe("ProjectTreeProvider", () => {
  beforeEach(function() {
    this.fixture = new ProjectTreeFixture();
  });

  afterEach(function() {
    this.fixture.tearDown();
  });

  const testProject: obs_ts.Project = {
    apiUrl: "api.foo.org",
    name: "testProject"
  };

  describe("#getChildren", () => {
    describe("children of the top level element", () => {
      it("returns a Bookmark element when no project is active", async function() {
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
      });

      it("returns a Bookmark element and an active project element", async function() {
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
      });
    });

    describe("children of the Bookmark element", () => {
      it("returns no children, if no Accounts are present", async function() {
        const projectTree: ProjectTreeProvider = this.fixture.createProjectTreeProvider();
        const bookmarkElement = new BookmarkedProjectsRootElement();

        await projectTree
          .getChildren(bookmarkElement)
          .should.be.fulfilled.and.eventually.deep.equal([]);
      });

      it("returns an empty array when no projects are bookmarked and only one account is present", async function() {
        const projectTree: ProjectTreeProvider = this.fixture.createProjectTreeProvider(
          {
            defaultApi: fakeAccount1.apiUrl,
            mapping: new Map([[fakeAccount1.apiUrl, fakeApi1Info]])
          }
        );
        const bookmarkElement = new BookmarkedProjectsRootElement();

        await projectTree
          .getChildren(bookmarkElement)
          .should.be.fulfilled.and.eventually.deep.equal([]);
      });

      it("returns an array of project bookmarks if only one account is present", async function() {
        const projectTree: ProjectTreeProvider = this.fixture.createProjectTreeProvider(
          {
            defaultApi: fakeAccount1.apiUrl,
            mapping: new Map([[fakeAccount1.apiUrl, fakeApi1Info]])
          },
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
      });

      it("returns ObsServerTreeElements as children of the bookmark element for each Account", async function() {
        const projectTree: ProjectTreeProvider = this.fixture.createProjectTreeProvider(
          {
            defaultApi: undefined,
            mapping: new Map([
              [fakeAccount1.apiUrl, fakeApi1Info],
              [fakeAccount2.apiUrl, fakeApi2Info]
            ])
          }
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
      });
    });

    describe("children of the ObsServer element", () => {
      it("returns the list of project bookmarks for this server", async function() {
        const commonEntries = {
          bookmark: true,
          collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
          contextValue: "project",
          iconPath: "media/Noun_Project_projects_icon_1327109_cc.svg"
        };

        const projectTree: ProjectTreeProvider = this.fixture.createProjectTreeProvider(
          {
            defaultApi: undefined,
            mapping: new Map([
              [fakeAccount1.apiUrl, fakeApi1Info],
              [fakeAccount2.apiUrl, fakeApi2Info]
            ])
          },
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
      });
    });

    describe("children of the Project Element", () => {
      const commonPackageEntries = {
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        contextValue: "package",
        iconPath: "media/package.svg"
      };

      it("returns the package list if the project has saved packages", async function() {
        const projectTree: ProjectTreeProvider = this.fixture.createProjectTreeProvider(
          {
            defaultApi: fakeAccount1.apiUrl,
            mapping: new Map([[fakeAccount1.apiUrl, fakeApi1Info]])
          },
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
      });

      it("tries to fetch the package list if the project has no saved packages", async function() {
        const projectTree: ProjectTreeProvider = this.fixture.createProjectTreeProvider(
          {
            defaultApi: fakeAccount1.apiUrl,
            mapping: new Map([[fakeAccount1.apiUrl, fakeApi1WithCon]])
          },
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
          fakeApi1WithCon.connection,
          fooProj.name,
          true
        );

        // the project bookmarks should have been updated
        // => no more fetching is necessary
        await projectTree
          .getChildren(projElemen)
          .should.be.fulfilled.and.eventually.deep.equal(children);
        this.fixture.sandbox.assert.calledOnce(this.fixture.getProjectMock);
      });

      it("it returns an empty array if the project has no saved packages and no associated connection", async function() {
        const projectTree: ProjectTreeProvider = this.fixture.createProjectTreeProvider(
          {
            defaultApi: fakeAccount1.apiUrl,
            mapping: new Map([[fakeAccount1.apiUrl, fakeApi1Info]])
          },
          [[fakeAccount1.apiUrl, [fooProj, barProj]]]
        );

        const projElement = new ProjectTreeElement(fooProj, false);

        await projectTree
          .getChildren(projElement)
          .should.be.fulfilled.and.eventually.be.deep.equal([]);

        this.fixture.sandbox.assert.notCalled(this.fixture.getProjectMock);
      });

      it("does not try to save non-bookmarked projects", async function() {
        const projectTree: ProjectTreeProvider = this.fixture.createProjectTreeProvider(
          {
            defaultApi: fakeAccount1.apiUrl,
            mapping: new Map([[fakeAccount1.apiUrl, fakeApi1WithCon]])
          }
        );

        this.fixture.getProjectMock.resolves(fooProjWithPackages);

        const projElement = new ProjectTreeElement(fooProj, false);
        await projectTree.getChildren(projElement).should.be.fulfilled;

        this.fixture.sandbox.assert.notCalled(this.fixture.mockMemento.update);
        this.fixture.sandbox.assert.calledOnce(this.fixture.getProjectMock);
      });
    });

    describe("children of the Package Element", () => {
      it("returns an empty array when no files are known and no connection is present", async function() {
        const projectTree: ProjectTreeProvider = this.fixture.createProjectTreeProvider(
          {
            defaultApi: fakeAccount1.apiUrl,
            mapping: new Map([[fakeAccount1.apiUrl, fakeApi1Info]])
          },
          [[fakeAccount1.apiUrl, [fooProjWithPackages, barProj]]]
        );

        const projElement = new ProjectTreeElement(fooProjWithPackages, false);
        const pkgElement = new PackageTreeElement(fooPkg, projElement);

        await projectTree
          .getChildren(pkgElement)
          .should.be.fulfilled.and.eventually.deep.equal([]);

        this.fixture.sandbox.assert.notCalled(this.fixture.fetchPackageMock);
      });

      it("returns the known files as PackageTreeElements", async function() {
        const projectTree: ProjectTreeProvider = this.fixture.createProjectTreeProvider(
          {
            defaultApi: fakeAccount1.apiUrl,
            mapping: new Map([[fakeAccount1.apiUrl, fakeApi1Info]])
          },
          [[fakeAccount1.apiUrl, [barProjWithPackages]]]
        );

        const projElement = new ProjectTreeElement(barProjWithPackages, false);
        const pkgElement = new PackageTreeElement(barPkgWithFiles, projElement);

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
      });

      it("fetches the files from OBS if none are present and a connection exists", async function() {
        const projectTree: ProjectTreeProvider = this.fixture.createProjectTreeProvider(
          {
            defaultApi: fakeAccount1.apiUrl,
            mapping: new Map([[fakeAccount1.apiUrl, fakeApi1WithCon]])
          },
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
          fakeApi1WithCon.connection,
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
      });

      it("Does not try to save packages of non bookmarked projects", async function() {
        const projectTree: ProjectTreeProvider = this.fixture.createProjectTreeProvider(
          {
            defaultApi: fakeAccount1.apiUrl,
            mapping: new Map([[fakeAccount1.apiUrl, fakeApi1WithCon]])
          }
        );

        this.fixture.fetchPackageMock.resolves(barPkgWithFiles);

        const projElement = new ProjectTreeElement(
          barProjWithPackagesWithoutFiles,
          false
        );
        const pkgElement = new PackageTreeElement(barPkg, projElement);

        const fileElements = await projectTree.getChildren(pkgElement).should.be
          .fulfilled;

        this.fixture.sandbox.assert.calledOnce(this.fixture.fetchPackageMock);
        this.fixture.sandbox.assert.notCalled(this.fixture.mockMemento.update);

        // the project has not been updated, so if we try to get the children
        // again, we end up having to call fetchPackage again
        await projectTree
          .getChildren(pkgElement)
          .should.be.fulfilled.and.eventually.deep.equal(fileElements);
        this.fixture.sandbox.assert.calledTwice(this.fixture.fetchPackageMock);
      });
    });
  });

  describe("#updatePackage", () => {
    it("tries to refetch the package contents");
  });
});
