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

import { expect, should, use } from "chai";
import * as chaiAsPromised from "chai-as-promised";
import * as chaiThings from "chai-things";
import { promises as fsPromises } from "fs";
import {
  addAndDeleteFilesFromPackage,
  Arch,
  checkOutProject,
  commit,
  createProject,
  deleteProject,
  fetchProjectMeta,
  modifyProjectMeta,
  Package,
  PackageFile,
  Project,
  ProjectMeta,
  readInModifiedPackageFromDir,
  rmRf
} from "open-build-service-api";
// FIXME: import from "open-build-service-api" directly once the library
// correctly exports this
import { createPackage } from "open-build-service-api/lib/package";
import * as path from "path";
import { join } from "path";
import { inspect } from "util";
import {
  ActivityBar,
  InputBox,
  QuickPickItem,
  SideBarView,
  TreeItem,
  ViewItem,
  ViewSection,
  Workbench
} from "vscode-extension-tester";
import { testCon, testUser } from "../testEnv";
import { findAndClickButtonOnTreeItem, focusOnSection } from "../util";

use(chaiAsPromised);
use(chaiThings);
should();

const apiUrl = testUser.apiUrl;
const repository = [
  {
    name: "openSUSE_Tumbleweed",
    path: [{ project: "openSUSE:Factory", repository: "snapshot" }],
    arch: [Arch.I586, Arch.X86_64]
  }
];

const testProjMeta: ProjectMeta = {
  description: "Test project for UI tests of vscode-obs",
  name: `home:${testUser.username}:vscode_obs_test`,
  title: "Test Project for vscode-obs"
};
const testProj: Project = {
  apiUrl,
  meta: testProjMeta,
  name: testProjMeta.name
};

const pkg: Package = {
  apiUrl,
  projectName: testProj.name,
  name: "foo"
};

const fooSpec: PackageFile = {
  name: "foo.spec",
  projectName: testProj.name,
  packageName: pkg.name,
  contents: Buffer.from("well, not really a spec but good enough")
};

const checkOutPath: string = path.join(process.env.HOME!, testProj.name);

const tw = "openSUSE Tumbleweed";
const twRepoName = tw.replace(" ", "_");

const removeArchLabel = "Remove this architecture from the repository";
const addArchLabel = "Add architectures to a repository";

const addPathLabel = "Add a path from a Project to a repository";
const removePathLabel = "Remove this path from the repository";

const movePathUpLabel = "Move this path up";
const movePathDownLabel = "Move this path down";

const getArchChildren = (section: ViewSection) =>
  section.openItem(twRepoName, "Architectures");

const addPathToRepository = async (
  repositoriesSection: ViewSection,
  projectName: string,
  repositoryName: string
): Promise<void> => {
  const pathElement = await repositoriesSection.findItem("Paths");
  await findAndClickButtonOnTreeItem(pathElement! as TreeItem, addPathLabel);

  const projectNameInput = await InputBox.create();

  await projectNameInput.setText(projectName);
  await projectNameInput.confirm();
  await projectNameInput.getDriver().sleep(100);

  const reposInput = await InputBox.create();
  await reposInput.setText(repositoryName);
  await reposInput.confirm();

  await projectNameInput.getDriver().sleep(3000);
};

describe("RepositoryTreeProvider", function () {
  this.timeout(30000);

  before(async () => {
    await createProject(testCon, testProjMeta);
    await createPackage(
      testCon,
      testProj,
      pkg.name,
      "A test package",
      "This is really just for testing"
    );
    await checkOutProject(testCon, testProj, checkOutPath);
    await fsPromises.writeFile(
      join(checkOutPath, pkg.name, fooSpec.name),
      fooSpec.contents!
    );

    let modPkg = await readInModifiedPackageFromDir(
      join(checkOutPath, pkg.name)
    );

    modPkg = await addAndDeleteFilesFromPackage(modPkg, [], [fooSpec.name]);
    await commit(testCon, modPkg, "Add foo.spec");

    const bench = new Workbench();
    await bench.executeCommand("extest.addFolder");

    const input = await InputBox.create();
    await input.setText(checkOutPath);
    await input.confirm();
    await input.getDriver().sleep(100);

    await bench.executeCommand("extest.openFile");
    const fileInput = await InputBox.create();
    await fileInput.setText(join(checkOutPath, pkg.name, fooSpec.name));
    await fileInput.confirm();
    await fileInput.getDriver().sleep(100);

    // open the extension beforehands and wait for a bit so that everything can
    // initialize in the background
    const activityBar = new ActivityBar();
    await activityBar.getViewControl("Open Build Service").click();
    await activityBar.getDriver().sleep(3000);
  });

  after(async () => {
    try {
      await deleteProject(testCon, testProj.name);
    } catch (err) {}
    await rmRf(checkOutPath);
  });

  it("shows no repositories by default", async () => {
    const repositorySection = await focusOnSection("Repositories");

    const repositories = await repositorySection.getVisibleItems();
    expect(repositories).to.be.an("array").and.have.length(0);
  });

  it("adds a repository from a known distribution", async () => {
    const section = await focusOnSection("Repositories");

    const addDistroButtonLabel = "Add a repository from a Distribution";

    let addDistroButton = section.getAction(addDistroButtonLabel);
    await addDistroButton.click();
    await addDistroButton.getDriver().sleep(100);

    const inputDistroName = new InputBox();

    const twItem = await inputDistroName.findQuickPick(tw);
    expect(twItem).to.not.equal(undefined);

    await (twItem as QuickPickItem).select();

    await inputDistroName.confirm();
    await inputDistroName.getDriver().sleep(1000);

    const repositorySection = await new SideBarView()
      .getContent()
      .getSection("Repositories");

    const repositories = await repositorySection.getVisibleItems();
    expect(repositories).to.be.an("array").and.have.length(1);
  });

  it("modified the actual project's _meta", async () => {
    // OBS likes to include person elements at random, so not do a deep.equal()
    // here
    await fetchProjectMeta(
      testCon,
      testProj.name
    ).should.eventually.deep.include({
      ...testProjMeta,
      repository
    });
  });

  it("no longer offers us to add an already existing repository", async () => {
    const section = await focusOnSection("Repositories");

    const addDistroButtonLabel = "Add a repository from a Distribution";

    let addDistroButton = section.getAction(addDistroButtonLabel);
    await addDistroButton.click();
    await addDistroButton.getDriver().sleep(100);

    const inputDistroName = new InputBox();
    const distros = await inputDistroName.getQuickPicks();
    const distroNames = await Promise.all(
      distros.map((distro) => distro.getLabel())
    );

    expect(distroNames.findIndex((name) => name === tw)).to.equal(-1);

    await inputDistroName.cancel();
  });

  it("shows the existing architectures and paths", async () => {
    const section = await focusOnSection("Repositories");

    await section
      .getVisibleItems()
      .should.eventually.be.an("array")
      .and.have.length(1);

    const pathChildren = await section.openItem(twRepoName, "Paths");
    expect(pathChildren).to.be.an("array").and.have.length(1);
    expect(
      (pathChildren as TreeItem[]).map((item) => item.getLabel())
    ).to.deep.equal(["openSUSE:Factory/snapshot"]);

    const archChildren = await section.openItem(twRepoName, "Architectures");
    expect(archChildren).to.be.an("array").and.have.length(2);
    const arches = (archChildren as TreeItem[]).map((item) => item.getLabel());
    expect(arches).to.include.a.thing.that.equals(Arch.X86_64);
    expect(arches).to.include.a.thing.that.equals(Arch.I586);

    // the children of Paths and Architectures must have *no* children
    // themselves
    await Promise.all(
      (archChildren as TreeItem[])
        .concat(pathChildren as TreeItem[])
        .map(
          async (treeItem) =>
            await treeItem.hasChildren().should.eventually.equal(false)
        )
    );
  });

  it("architecture elements have a button to remove this entry", async () => {
    const section = await focusOnSection("Repositories");
    const archChildren = await section.openItem(twRepoName, "Architectures");

    await Promise.all(
      (archChildren as TreeItem[]).map(async (archItem) => {
        await archItem
          .getActionButton(removeArchLabel)
          .should.eventually.not.equal(undefined);
      })
    );
  });

  it("path elements have a button to remove this entry", async () => {
    const section = await focusOnSection("Repositories");
    const archChildren = await section.openItem(twRepoName, "Paths");

    await Promise.all(
      (archChildren as TreeItem[]).map(async (archItem) => {
        await archItem
          .getActionButton("Remove this path from the repository")
          .should.eventually.not.equal(undefined);
      })
    );
  });

  it("removes an architecture by clicking on the respective button", async () => {
    const section = await focusOnSection("Repositories");
    let archChildren = await getArchChildren(section);

    for (const archChild of archChildren as ViewItem[]) {
      const treeItem = archChild as TreeItem;
      if (treeItem.getLabel() === Arch.X86_64) {
        const actButton = await treeItem.getActionButton(removeArchLabel);
        expect(actButton).to.not.equal(undefined);
        await section.getDriver().actions().mouseMove(treeItem).perform();
        await actButton!.click();
      }
    }

    // wait for the project meta change to propagate
    section.getDriver().sleep(3000);

    archChildren = await getArchChildren(section);
    expect(archChildren).to.be.an("array").and.have.length(1);
    expect((archChildren as TreeItem[])[0].getLabel()).to.deep.equal(Arch.I586);
  });

  it("removes the last architecture by clicking on the respective button", async () => {
    const section = await focusOnSection("Repositories");

    let archChildren = await getArchChildren(section);
    expect(archChildren).to.be.an("array").and.have.length(1);

    await findAndClickButtonOnTreeItem(
      (archChildren as TreeItem[])[0],
      removeArchLabel
    );

    // wait for the project meta change to propagate
    section.getDriver().sleep(3000);

    archChildren = await getArchChildren(section);
    expect(archChildren).to.be.an("array").and.have.length(0);

    // the architecture element must not disappear
    const twChildren = await section.openItem(twRepoName);
    expect(
      (twChildren as TreeItem[]).map((child) => child.getLabel())
    ).to.deep.equal(["Paths", "Architectures"]);
  });

  it("allows us to add a new architecture to the Tumbleweed repository", async () => {
    const section = await focusOnSection("Repositories");

    const archElement = ((await section.openItem(
      twRepoName
    )) as TreeItem[]).find(
      (treeItem) => treeItem.getLabel() === "Architectures"
    );
    expect(archElement).to.not.equal(undefined);

    await findAndClickButtonOnTreeItem(archElement!, addArchLabel);

    const inputArch = new InputBox();
    await inputArch
      .getQuickPicks()
      .should.eventually.be.an("array")
      .and.have.lengthOf.least(1);

    const aarch64Item = await inputArch.findQuickPick(Arch.Aarch64);
    expect(aarch64Item).to.not.equal(undefined);
    await (aarch64Item as QuickPickItem).select();

    await inputArch.confirm();

    await section.getDriver().sleep(3000);

    let archChildren = await getArchChildren(section);
    expect(archChildren).to.be.an("array").and.have.length(1);
    expect(
      (archChildren as TreeItem[]).map((treeItem) => treeItem.getLabel())
    ).to.deep.equal([Arch.Aarch64]);
  });

  it("allows us to add a new project as a path", async () => {
    const section = await focusOnSection("Repositories");

    const pathElement = await section.findItem("Paths");
    expect(pathElement).to.not.equal(undefined);

    await findAndClickButtonOnTreeItem(pathElement as TreeItem, addPathLabel);

    const projectNameInput = await InputBox.create();
    const projects = await projectNameInput.getQuickPicks();
    const projectNames = await Promise.all(
      projects.map((proj) => proj.getLabel())
    );
    expect(projectNames.length).to.be.greaterThan(2);
    ["Tumbleweed", "Factory"].forEach((subProj) =>
      expect(projectNames).to.include.a.thing.that.equals(`openSUSE:${subProj}`)
    );

    await projectNameInput.setText("openSUSE:Tumbleweed");
    await projectNameInput.confirm();
    await projectNameInput.getDriver().sleep(100);

    const reposInput = await InputBox.create();
    const repoNames = await Promise.all(
      (await reposInput.getQuickPicks()).map((item) => item.getLabel())
    );
    expect(repoNames).to.be.an("array").and.have.length(2);
    ["standard", "standard_debug"].forEach((repoName) =>
      repoNames.should.include.a.thing.that.equals(repoName)
    );
    await reposInput.setText("standard");
    await reposInput.confirm();

    await section.getDriver().sleep(3000);

    const newPaths = await section.openItem(twRepoName, "Paths");
    expect(newPaths).to.be.an("array").and.have.length(2);

    expect(
      (newPaths as TreeItem[]).map((path) => path.getLabel())
    ).to.include.a.thing.that.equals("openSUSE:Tumbleweed/standard");
  });

  it("allows us to remove a repository path", async () => {
    const section = await focusOnSection("Repositories");

    let pathElements = await section.openItem(twRepoName, "Paths");
    expect(pathElements).to.be.an("array").and.have.length(2);

    await Promise.all(
      (pathElements as TreeItem[]).map(async (pathElement) => {
        if (pathElement.getLabel() === "openSUSE:Factory/snapshot") {
          await findAndClickButtonOnTreeItem(pathElement, removePathLabel);
        }
      })
    );

    await section.getDriver().sleep(3000);

    pathElements = await section.openItem(twRepoName, "Paths");
    expect(pathElements).to.be.an("array").and.have.length(1);

    (pathElements as TreeItem[])[0]
      .getLabel()
      .should.deep.equal("openSUSE:Tumbleweed/standard");
  });

  it("correctly updated the _meta on OBS", async () => {
    await fetchProjectMeta(
      testCon,
      testProj.name
    ).should.eventually.deep.include({
      ...testProjMeta,
      repository: [
        {
          name: "openSUSE_Tumbleweed",
          path: [{ project: "openSUSE:Tumbleweed", repository: "standard" }],
          arch: [Arch.Aarch64]
        }
      ]
    });
  });

  it("does not display any move path buttons when only a single path is present", async () => {
    const section = await focusOnSection("Repositories");

    const pathElements = await section.openItem(twRepoName, "Paths");
    expect(pathElements).to.be.an("array").and.have.length(1);

    const buttons = await (pathElements as TreeItem[])[0].getActionButtons();

    [movePathUpLabel, movePathDownLabel].forEach((label) =>
      expect(buttons.find((button) => button.getLabel() === label)).to.equal(
        undefined
      )
    );
  });

  it("shows the move path buttons on the movable entries", async () => {
    const section = await focusOnSection("Repositories");

    await addPathToRepository(section, "openSUSE:Factory", "standard");

    let pathElementChildren = await section.openItem(twRepoName, "Paths");
    expect(pathElementChildren).to.be.an("array").and.have.length(2);

    const checkUpperButton = async (children: ViewItem[] | void) => {
      const upperButtonLabels = (
        await (children as TreeItem[])[0].getActionButtons()
      ).map((button) => button.getLabel());
      upperButtonLabels.should.include.a.thing.that.equals(movePathDownLabel);
      upperButtonLabels.should.not.include.a.thing.that.equals(movePathUpLabel);
    };
    const checkLowerButton = async (children: ViewItem[] | void) => {
      const lowerButtonLabels = (
        await (children as TreeItem[])[
          (children as TreeItem[]).length - 1
        ].getActionButtons()
      ).map((button) => button.getLabel());
      lowerButtonLabels.should.include.a.thing.that.equals(movePathUpLabel);
      lowerButtonLabels.should.not.include.a.thing.that.equals(
        movePathDownLabel
      );
    };

    await checkUpperButton(pathElementChildren);
    await checkLowerButton(pathElementChildren);

    await addPathToRepository(section, "openSUSE:Factory", "snapshot");

    pathElementChildren = await section.openItem(twRepoName, "Paths");
    expect(pathElementChildren).to.be.an("array").and.have.length(3);

    await checkUpperButton(pathElementChildren);
    await checkLowerButton(pathElementChildren);

    const middleButtonLabels = (
      await (pathElementChildren as TreeItem[])[1].getActionButtons()
    ).map((button) => button.getLabel());
    middleButtonLabels.should.include.a.thing.that.equals(movePathUpLabel);
    middleButtonLabels.should.include.a.thing.that.equals(movePathDownLabel);
  });

  it("moves a path up when the respective button is pressed", async () => {
    const section = await focusOnSection("Repositories");

    const pathsBeforeMove = await section.openItem(twRepoName, "Paths");
    expect(pathsBeforeMove).to.be.an("array").and.have.length(3);

    const middlePathEntry = (pathsBeforeMove as TreeItem[])[1];
    middlePathEntry.getLabel().should.deep.equal("openSUSE:Factory/standard");
    const moveUpButton = await findAndClickButtonOnTreeItem(
      middlePathEntry,
      movePathUpLabel
    );
    await moveUpButton.getDriver().sleep(3000);

    const pathsAfterMove = await section.openItem(twRepoName, "Paths");
    expect(pathsAfterMove).to.be.an("array").and.have.length(3);

    const labelsBeforeMove = (pathsBeforeMove as TreeItem[]).map((pth) =>
      pth.getLabel()
    );
    const labelsAfterMove = (pathsAfterMove as TreeItem[]).map((pth) =>
      pth.getLabel()
    );

    labelsAfterMove[0].should.deep.equal(labelsBeforeMove[1]);
    labelsAfterMove[1].should.deep.equal(labelsBeforeMove[0]);
    labelsAfterMove[2].should.deep.equal(labelsBeforeMove[2]);
  });

  it("moves a path down when the respective button is pressed", async () => {
    const section = await focusOnSection("Repositories");

    const pathsBeforeMove = await section.openItem(twRepoName, "Paths");
    expect(pathsBeforeMove).to.be.an("array").and.have.length(3);

    const middlePathEntry = (pathsBeforeMove as TreeItem[])[1];
    middlePathEntry
      .getLabel()
      .should.deep.equal("openSUSE:Tumbleweed/standard");
    const moveDownButton = await findAndClickButtonOnTreeItem(
      middlePathEntry,
      movePathDownLabel
    );
    await moveDownButton.getDriver().sleep(3000);

    const pathsAfterMove = await section.openItem(twRepoName, "Paths");
    expect(pathsAfterMove).to.be.an("array").and.have.length(3);

    const labelsBeforeMove = (pathsBeforeMove as TreeItem[]).map((pth) =>
      pth.getLabel()
    );
    const labelsAfterMove = (pathsAfterMove as TreeItem[]).map((pth) =>
      pth.getLabel()
    );
    labelsAfterMove[0].should.deep.equal(labelsBeforeMove[0]);
    labelsAfterMove[1].should.deep.equal(labelsBeforeMove[2]);
    labelsAfterMove[2].should.deep.equal(labelsBeforeMove[1]);
  });

  it("modified the project's _meta", async () => {
    await fetchProjectMeta(
      testCon,
      testProj.name
    ).should.eventually.deep.include({
      ...testProjMeta,
      repository: [
        {
          name: "openSUSE_Tumbleweed",
          path: [
            { project: "openSUSE:Factory", repository: "standard" },
            { project: "openSUSE:Factory", repository: "snapshot" },
            { project: "openSUSE:Tumbleweed", repository: "standard" }
          ],
          arch: [Arch.Aarch64]
        }
      ]
    });
  });

  xit("Refreshes the project and sees the new repositories", async () => {
    const newMeta: ProjectMeta = {
      ...testProjMeta,
      repository: [
        {
          name: "openSUSE_Tumbleweed",
          path: [{ project: "openSUSE:Factory", repository: "standard" }],
          arch: [Arch.X86_64, Arch.Aarch64]
        }
      ]
    };

    await modifyProjectMeta(testCon, newMeta);

    const curProjSection = await focusOnSection("Current Project");

    const visibleItems = await curProjSection.getVisibleItems();
    expect(visibleItems).to.be.an("array").and.have.length(1);

    const testProjEntry = visibleItems[0] as TreeItem;
    testProjEntry.getLabel().should.deep.equal(testProj.name);

    const updateProj = await findAndClickButtonOnTreeItem(
      testProjEntry,
      "Update this Project"
    );
    await updateProj.getDriver().sleep(3000);

    const repoSection = await focusOnSection("Repositories");
    const pathsAfterMove = await repoSection.openItem(twRepoName, "Paths");
    expect(pathsAfterMove).to.be.an("array").and.have.length(1);
    (pathsAfterMove as TreeItem[])[0]
      .getLabel()
      .should.deep.equal("openSUSE:Factory/standard");
  });
});