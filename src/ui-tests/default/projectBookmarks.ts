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

import { expect, use } from "chai";
import * as chaiAsPromised from "chai-as-promised";
import * as chaiThings from "chai-things";
import { before, describe, it } from "mocha";
import {
  createPackage,
  createProject,
  deletePackage,
  deleteProject,
  fetchPackage,
  packageFileFromBuffer,
  setFileContentsAndCommit
} from "open-build-service-api";
import {
  EditorView,
  NotificationType,
  TextEditor,
  TreeItem,
  Workbench
} from "vscode-extension-tester";
import { DialogHandler } from "vscode-extension-tester-native";
import { safeRmRf, swallowException } from "../../test/suite/utilities";
import { testCon } from "../testEnv";
import {
  addProjectBookmark,
  BOOKMARKED_PROJECTS_SECTION_NAME,
  createTestTempDir,
  dismissAllNotifications,
  dismissMsTelemetryNotification,
  ensureExtensionOpen,
  findAndClickButtonOnTreeItem,
  focusOnSection,
  getLabelsOfTreeItems,
  waitForEditorWindow,
  waitForNotifications,
  waitForPackageBookmark
} from "../util";

use(chaiAsPromised);
use(chaiThings);

const projName = "openSUSE.org:utilities";
const pkgName = "jtc";

const focusOnCurrentProjectSection = async () => {
  const curProjSect = await focusOnSection("Current Project");

  let projElement = await curProjSect.findItem(projName);
  expect(projElement).to.not.be.undefined;
  projElement = projElement!;
  if (await (projElement as TreeItem).isExpanded()) {
    await (projElement as TreeItem).collapse();
  }
  const visibleProjects = await curProjSect.getVisibleItems();
  expect(visibleProjects).to.have.lengthOf(1);

  const curProj = visibleProjects[0] as TreeItem;
  await curProj.getLabel().should.eventually.equal(projName);
  await curProj.click();
  return curProj;
};

describe("Bookmarked Projects", function () {
  this.timeout(30000);

  const branchedProjName = `home:${testCon.username}:branches:${projName}`;
  const newProj = "home:obsTestUser:new_project";
  const testPkg = "new_pkg";
  let tmpPath: string;

  before(async () => {
    const center = await new Workbench().openNotificationsCenter();

    tmpPath = await createTestTempDir();
    await ensureExtensionOpen();
    let notifications = await center.getNotifications(NotificationType.Any);
    await dismissMsTelemetryNotification(notifications);
  });

  after(
    async () =>
      await Promise.all([
        swallowException(safeRmRf, { args: [tmpPath] }),
        swallowException(deleteProject, { args: [testCon, branchedProjName] })
      ])
  );

  it("has a 'Bookmark a Project' button and a 'My bookmarks' element", async () => {
    const bookmarkSection = await focusOnSection(
      BOOKMARKED_PROJECTS_SECTION_NAME
    );
    const elements = await bookmarkSection.getVisibleItems();

    // only 2 elements are expected to exist
    expect(elements).to.be.an("array").and.to.have.length(2);

    expect(await getLabelsOfTreeItems(elements)).to.deep.equal([
      "Bookmark a Project",
      "My bookmarks"
    ]);

    // nothing is bookmarked => no children should exist
    expect(await (elements[1] as TreeItem).getChildren())
      .to.be.an("array")
      .and.have.length(0);
  });

  it("asks us to bookmark a project when clicking the 'Bookmark a Project' button", async () => {
    await addProjectBookmark(projName, [pkgName]);

    const pkgElem = await waitForPackageBookmark(projName, pkgName);
    await pkgElem.getLabel().should.eventually.equal(pkgName);
  });

  it("fetches the files of the package bookmark as well", async () => {
    await new EditorView().closeAllEditors();

    const pkgElement = await waitForPackageBookmark(projName, pkgName);

    const specFile = `${pkgName}.spec`;
    const specFileElement = await pkgElement.findChildItem(specFile);
    expect(specFileElement).to.not.equal(undefined);
    await specFileElement!.click();

    const editor = await waitForEditorWindow(specFile);
    const specFileContents = await (editor as TextEditor).getText();
    specFileContents.should.match(/Name:\s+jtc/);
  });

  it("shows the project in the 'Current Project' view", async () => {
    const curProj = await focusOnCurrentProjectSection();

    const pkgsInProj = await curProj.getChildren();
    expect(pkgsInProj).to.have.lengthOf(1);
    await pkgsInProj[0].getLabel().should.eventually.equal(pkgName);

    if (!(await pkgsInProj[0].isExpanded())) {
      await pkgsInProj[0].select();
    }
    const filesInPkg = await pkgsInProj[0].getChildren();
    const fileNames = await getLabelsOfTreeItems(filesInPkg);

    const pkgOnObs = await fetchPackage(testCon, projName, pkgName);
    pkgOnObs.files.forEach((f) =>
      fileNames.should.contain.a.thing.that.equals(f.name)
    );
  });

  it("adds additional packages to an existing bookmarked project", async () => {
    await addProjectBookmark(projName, ["ack", "jq"]);

    await waitForPackageBookmark(projName, pkgName);
    await waitForPackageBookmark(projName, "jq", { timeoutMs: 10000 });
    await waitForPackageBookmark(projName, "ack");

    await ((await (
      await focusOnSection(BOOKMARKED_PROJECTS_SECTION_NAME)
    ).findItem(projName)) as TreeItem)
      .getChildren()
      .should.eventually.be.an("array")
      .and.have.length(3);
  });

  it("adds the newly added packages to the current project view", async () => {
    const curProj = await focusOnCurrentProjectSection();

    const pkgsInProj = await curProj.getChildren();
    expect(pkgsInProj).to.have.lengthOf(3);
    const pkgLabels = await getLabelsOfTreeItems(pkgsInProj);
    pkgLabels.forEach((lbl) =>
      ["jq", "ack", pkgName].should.contain.a.thing.that.equals(lbl)
    );

    const pkgInCurProj = await waitForPackageBookmark(projName, pkgName, {
      section: "Current Project"
    });

    if (!(await pkgInCurProj.isExpanded())) {
      await pkgInCurProj.select();
    }
    const filesInPkg = await pkgInCurProj.getChildren();
    const fileNames = await getLabelsOfTreeItems(filesInPkg);

    const pkgOnObs = await fetchPackage(testCon, projName, pkgName);
    pkgOnObs.files.forEach((f) =>
      fileNames.should.contain.a.thing.that.equals(f.name)
    );
  });

  const contents = "¯_(ツ)_/¯";
  it("bookmarks another project", async () => {
    await createProject(testCon, newProj);
    await createPackage(testCon, newProj, testPkg);
    await setFileContentsAndCommit(
      testCon,
      packageFileFromBuffer(`${testPkg}.spec`, testPkg, newProj, contents),
      "Initial commit"
    );

    await addProjectBookmark(newProj);

    await waitForPackageBookmark(projName, "jtc");
    await waitForPackageBookmark(projName, "jq");
    await waitForPackageBookmark(projName, "ack");

    await waitForPackageBookmark(newProj, testPkg);
  });

  it("displays the correct contents of the new package's file", async () => {
    const pkgElem = await waitForPackageBookmark(newProj, testPkg);
    await pkgElem.click();

    const fileElements = await pkgElem.getChildren();
    expect(fileElements).to.be.an("array").and.have.lengthOf(1);
    await fileElements[0].click();
  });

  it("marks a package as broken, when the package is gone", async () => {
    await deletePackage(testCon, newProj, testPkg);

    const bookmarkSection = await focusOnSection(
      BOOKMARKED_PROJECTS_SECTION_NAME
    );
    // wait for OBS to actually delete the package
    await bookmarkSection.getDriver().sleep(3000);

    const pkgElem = await waitForPackageBookmark(newProj, testPkg);

    await pkgElem.collapse();
    await findAndClickButtonOnTreeItem(
      pkgElem,
      "Update this Package and its contents"
    );
    await ((await bookmarkSection.findItem(newProj)) as TreeItem).collapse();
    await waitForPackageBookmark(newProj, testPkg);

    await pkgElem.getDriver().sleep(5000);
  });

  it("marks a project bookmark as broken when the project is gone", async () => {
    await deleteProject(testCon, newProj);

    await focusOnSection(BOOKMARKED_PROJECTS_SECTION_NAME);

    await (await ((await (
      await focusOnSection(BOOKMARKED_PROJECTS_SECTION_NAME)
    ).findItem(newProj)) as TreeItem).getActionButton(
      "Update this Project"
    ))!.click();
  });

  xit("allows to branch the package from the bookmarks", async () => {
    await dismissAllNotifications();
    const pkgElement = await waitForPackageBookmark(projName, pkgName);
    await pkgElement.select();

    const actionButton = await pkgElement.getActionButton(
      "Branch, bookmark and checkout this package"
    );
    expect(actionButton).to.not.be.undefined;

    await actionButton!.click();

    const progressNotification = await waitForNotifications();
    expect(progressNotification).to.be.an("array").and.have.lengthOf(1);
    // await progressNotification[0].hasProgress().should.eventually.equal(true);
    console.log(await progressNotification[0].hasProgress());
    await progressNotification[0]
      .getMessage()
      .should.eventually.match(
        new RegExp(`branching package ${projName}/${pkgName}`, "i")
      );

    /*const [_void, checkoutNotification] = await Promise.all([
      async () => {
        const dialog = await DialogHandler.getOpenDialog();
        await dialog.selectPath(tmpPath);
        dialog.confirm();
      },
      waitForNotifications()
      ]);*/
    const dialog = await DialogHandler.getOpenDialog();
    await dialog.selectPath(tmpPath);
    await dialog.confirm();

    // expect(checkoutNotification).to.be.an("array").and.have.lengthOf(1);
    // // await checkoutNotification[0].hasProgress().should.eventually.equal(true);
    // console.log(await checkoutNotification[0].hasProgress());
    // await checkoutNotification[0]
    //   .getMessage()
    //   .should.eventually.match(
    //     new RegExp(`checking out.*${branchedProjName}/${pkgName}`, "i")
    //   );

    const openNewFolderNotification = await waitForNotifications();
    expect(openNewFolderNotification).to.be.an("array").and.have.lengthOf(1);
    await openNewFolderNotification[0]
      .hasProgress()
      .should.eventually.equal(false);
    await openNewFolderNotification[0]
      .getMessage()
      .should.eventually.match(/open the checked out package/i);

    const buttons = await openNewFolderNotification[0].getActions();
    expect(buttons).to.be.an("array").and.have.lengthOf(2);
    const buttonLabels = await Promise.all(buttons.map((b) => b.getTitle()));
    ["Yes", "No"].forEach((lbl) =>
      buttonLabels.should.include.a.thing.that.equals(lbl)
    );
    await openNewFolderNotification[0].takeAction("No");

    await waitForPackageBookmark(branchedProjName, pkgName);
  });
});
