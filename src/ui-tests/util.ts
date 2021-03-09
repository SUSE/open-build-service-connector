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
import {
  Arch,
  Connection,
  createPackage,
  createProject,
  Package,
  PackageFile,
  pathExists,
  PathType,
  Project,
  ProjectMeta
} from "open-build-service-api";
import { join } from "path";
import {
  ActivityBar,
  EditorView,
  InputBox,
  ModalDialog,
  Notification,
  NotificationsCenter,
  NotificationType,
  SideBarView,
  TextEditor,
  TreeItem,
  until,
  ViewItem,
  ViewItemAction,
  ViewSection,
  Workbench
} from "vscode-extension-tester";
import { AccountStorage } from "../accounts";
import { getTmpPrefix } from "../test/suite/utilities";
import { testUser } from "./testEnv";

export const BOOKMARKED_PROJECTS_SECTION_NAME = "Bookmarked Projects";

/**
 * Dismisses the MS telemetry notification and returns a new array which
 * contains all other notifications.
 */
export async function dismissMsTelemetryNotification(
  notifications: Notification[]
): Promise<Notification[]> {
  const nonTelemetryNotifications = [];
  for (const notif of notifications) {
    const msg = await notif.getMessage();
    if (msg.match(/collect.*usage.*data/i) !== null) {
      await notif.dismiss();
      await notif.getDriver().sleep(100);
    } else {
      nonTelemetryNotifications.push(notif);
    }
  }
  return nonTelemetryNotifications;
}

/**
 * Dismiss either the passed notifications or all currently existing ones in
 * the notification center.
 *
 * @return The notifications that were dismissed.
 */
export async function dismissAllNotifications(
  notifications?: Notification[]
): Promise<Notification[]> {
  const bench = new Workbench();
  let notif: Notification[];
  let center: NotificationsCenter | undefined;
  if (notifications === undefined) {
    center = await bench.openNotificationsCenter();
    notif = await center.getNotifications(NotificationType.Any);
  } else {
    notif = notifications;
  }
  for (let n of notif) {
    await n.dismiss();
    await bench.getDriver().wait(until.stalenessOf(n));
  }

  return notif;
}

export interface WaitForNotificationsOptions {
  notificationType?: NotificationType;
  timeoutMs?: number;
  bench?: Workbench;
}

export const WAIT_FOR_NOTIFICATIONS_OPTIONS_DEFAULT = {
  notificationType: NotificationType.Any,
  timeoutMs: 10000,
  bench: undefined
};

export async function waitForNotifications(
  options: WaitForNotificationsOptions = WAIT_FOR_NOTIFICATIONS_OPTIONS_DEFAULT
): Promise<Notification[]> {
  const timeoutMs =
    options?.timeoutMs ?? WAIT_FOR_NOTIFICATIONS_OPTIONS_DEFAULT.timeoutMs;
  return promiseWithTimeout(
    async () => {
      const center = await (
        options?.bench ?? new Workbench()
      ).openNotificationsCenter();
      let notifications: Notification[] = [];

      while (notifications.length === 0) {
        await center.getDriver().sleep(500);
        notifications = await center.getNotifications(
          options?.notificationType ??
            WAIT_FOR_NOTIFICATIONS_OPTIONS_DEFAULT.notificationType
        );
      }

      return notifications;
    },
    timeoutMs,
    {
      errorMsg: `Did not receive any notifications in ${timeoutMs}ms.`
    }
  );
}

/**
 * Wait for `timeoutMs` milliseconds for a element to appear in the DOM.
 *
 * @param construct  A function that tries to find the element in the DOM and
 *     returns it. It can return a promise resolving to the object or the object
 *     directly or `undefined`. Returning `undefined` indicates that the element
 *     was not found and will try to look for the element again.
 *
 * @throw `Error` when `construct()` does not return in the specified timeout
 */
export async function waitForElement<T>(
  construct: () => T | undefined | Promise<T | undefined>,
  timeoutMs: number = 2000
): Promise<T> {
  return promiseWithTimeout(
    async () => {
      let elem: T | undefined = undefined;
      while (elem === undefined) {
        try {
          elem = await construct();
          if (elem !== undefined) {
            return elem;
          }
        } catch (err) {
          await new Workbench().getDriver().sleep(500);
        }
      }
      return elem;
    },
    timeoutMs,
    { errorMsg: `Did not find a new element in ${timeoutMs} ms` }
  );
}

/**
 * Focus on the section with the supplied `sectionName` in the Side Bar.
 */
export async function focusOnSection(
  sectionName: string
): Promise<ViewSection> {
  const section = await new SideBarView().getContent().getSection(sectionName);
  await section.getDriver().sleep(100);
  await section.getDriver().actions().mouseMove(section).perform();
  return section;
}

export async function waitForRepository({
  repositoryName,
  timeoutMs = 5000
}: { repositoryName?: string; timeoutMs?: number } = {}): Promise<TreeItem> {
  return promiseWithTimeout(async () => {
    const sect = await focusOnSection("Repositories");
    let repository: ViewItem | undefined;
    while (repository === undefined) {
      repository =
        repositoryName !== undefined
          ? await sect.findItem(repositoryName)
          : (await sect.getVisibleItems())[0];
    }
    return repository as TreeItem;
  }, timeoutMs);
}

interface LabeledObj {
  getLabel(): Promise<string>;
}

/**
 * Retrieve the labels of the supplied [[TreeItem]]s.
 * **Caution:** you must call this function before performing any further
 *              manipulations with the tree items, as they store some state
 *              internally and get implicitly modified as well (see
 *              https://github.com/redhat-developer/vscode-extension-tester/issues/158)
 */
export async function getLabelsOfTreeItems(
  items: (LabeledObj | TreeItem | ViewItem)[] | void
): Promise<string[]> {
  if (items === undefined) {
    return [];
  }
  assert(
    items
      .map((i) => typeof (i as any).getLabel === "function")
      .filter((hasGetLabelFunc) => !hasGetLabelFunc).length === 0
  );
  const labels: string[] = [];
  for (const item of items) {
    labels.push(await (item as TreeItem).getLabel());
  }
  return labels;
}

/**
 * Finds a button with the provided label on the specified `treeItem` and click
 * it.
 */
export async function findAndClickButtonOnTreeItem(
  treeItem: TreeItem,
  buttonLabel: string
): Promise<ViewItemAction> {
  let button = await treeItem.getActionButton(buttonLabel);
  expect(button).to.not.equal(undefined);
  button = button!;

  expect(button.getLabel()).to.deep.equal(buttonLabel);
  await button.getDriver().actions().mouseMove(treeItem).perform();
  await button.click();
  return button;
}

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

export async function createTestPackage(con: Connection): Promise<void> {
  await createProject(con, testProjMeta);
  await createPackage(
    con,
    testProj,
    pkg.name,
    "A test package",
    "This is really just for testing"
  );
}

export async function ensureExtensionOpen() {
  // open the extension beforehands and wait for a bit so that everything can
  // initialize in the background
  const activityBar = new ActivityBar();
  await (await activityBar.getViewControl("Open Build Service"))!.openView();
  return activityBar;
}

/**
 * Creates a promise with an added timeout.
 *
 * @param promise  A function that returns the Promise to which a timeout should
 *     be added.
 * @param timeoutMs  The timeout in milliseconds
 * @param errorMsg Optional error message with which the returned promise is
 *     rejected if the timeout expires.
 */
export function promiseWithTimeout<T>(
  promise: () => Promise<T>,
  timeoutMs: number,
  { errorMsg }: { errorMsg?: string } = {}
): Promise<T> {
  let tmout: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    tmout = setTimeout(
      () => reject(new Error(errorMsg ?? `Timeout of ${timeoutMs}ms expired`)),
      timeoutMs
    );
  });

  return Promise.race([promise(), timeoutPromise]).then(async (result) => {
    clearTimeout(tmout);
    return result;
  });
}

async function findChildByLabel(
  treeItem: TreeItem,
  label: string
): Promise<TreeItem | undefined> {
  const children = await treeItem.getChildren();

  const labels = await getLabelsOfTreeItems(children);
  return children[labels.findIndex((name) => name === label)];
}

/**
 * Try for `timeoutMs` milliseconds to locate the OBS instance with the name
 * `instanceName` in the bookmarked projects view.
 */
export function waitForObsInstance(
  instanceName: string,
  {
    timeoutMs = 5000
  }: {
    timeoutMs?: number;
  } = {}
): Promise<TreeItem> {
  return promiseWithTimeout(
    async () => {
      const bookmarkSection = await focusOnSection(
        BOOKMARKED_PROJECTS_SECTION_NAME
      );
      let instanceElement: TreeItem | undefined;
      while (instanceElement === undefined) {
        if ((await bookmarkSection.findWelcomeContent()) === undefined) {
          const myBookmarksItem = await bookmarkSection.findItem(
            "My bookmarks",
            1
          );

          if (myBookmarksItem !== undefined) {
            instanceElement = await findChildByLabel(
              myBookmarksItem as TreeItem,
              instanceName
            );
          }
        }
        await bookmarkSection.getDriver().sleep(500);
      }
      return instanceElement;
    },
    timeoutMs,
    {
      errorMsg: `Did not find a OBS instance with the alias ${instanceName} in ${timeoutMs}ms`
    }
  );
}

export function waitForProjectBookmark(
  instanceName: string,
  projectName: string,
  {
    timeoutMs = 5000
  }: {
    timeoutMs?: number;
  } = {}
): Promise<TreeItem> {
  return promiseWithTimeout(
    async () => {
      const obsElement = await waitForObsInstance(instanceName, { timeoutMs });
      let projectElement: TreeItem | undefined;
      while (projectElement === undefined) {
        projectElement = await findChildByLabel(obsElement, projectName);
        await obsElement.getDriver().sleep(500);
      }
      return projectElement;
    },
    timeoutMs,
    {
      errorMsg: `Failed to find the project element ${projectName} from the instance ${instanceName}`
    }
  );
}

/**
 * Wait for `timeoutMs` ms for the package element of the package
 * `projectName/packageName` to appear in the "My bookmarks" or "Current
 * Project" section.
 */
export function waitForPackageBookmark(
  instanceName: string,
  projectName: string,
  packageName: string,
  {
    timeoutMs = 5000,
    section = BOOKMARKED_PROJECTS_SECTION_NAME
  }: {
    timeoutMs?: number;
    section?: "Current Project" | "Bookmarked Projects";
  } = {}
): Promise<TreeItem> {
  return promiseWithTimeout(
    async () => {
      let pkgElem: TreeItem | undefined;
      let projElement: TreeItem | undefined;

      if (section === "Current Project") {
        const curSection = await focusOnSection(section);
        projElement = await waitForElement(async () => {
          projElement = (await curSection.findItem(projectName)) as
            | TreeItem
            | undefined;

          if (projElement === undefined) {
            return undefined;
          }

          return projElement;
        });
      } else {
        projElement = await waitForProjectBookmark(instanceName, projectName, {
          timeoutMs
        });
      }

      console.log(await projElement.getLabel());
      if (!(await projElement.isSelected())) {
        await projElement.select();
      }

      while (pkgElem === undefined) {
        pkgElem = await findChildByLabel(projElement, packageName);
        await projElement.getDriver().sleep(500);
      }
      return pkgElem;
    },
    timeoutMs,
    {
      errorMsg: `Failed to find the package bookmark ${projectName}/${packageName} in ${timeoutMs}ms`
    }
  );
}

export async function addProjectBookmark(
  projectName: string,
  packages?: string[]
): Promise<void> {
  const bookmarkSection = await focusOnSection(
    BOOKMARKED_PROJECTS_SECTION_NAME
  );
  const addBookmarkItem = await bookmarkSection.findItem("Bookmark a Project");
  expect(addBookmarkItem).to.not.be.undefined;

  await addBookmarkItem!.click();
  await bookmarkSection.getDriver().sleep(100);

  await dismissAllNotifications();

  const projectNameInput = await InputBox.create();
  await projectNameInput.setText(projectName);
  await projectNameInput.confirm();

  const pkgSelectionInput = await InputBox.create();
  const pkgs =
    packages ??
    (await Promise.all(
      (await pkgSelectionInput.getQuickPicks()).map((pick) => pick.getLabel())
    ));

  for (const pkgName of pkgs) {
    await pkgSelectionInput.setText(pkgName);
    await pkgSelectionInput.selectQuickPick(pkgName);
  }

  await pkgSelectionInput.confirm();
}

/**
 * Wait for `timeoutMs` milliseconds for the editor tab with the given title to
 * appear. If it appears, then the corresponding [[Editor]] object is returned,
 * otherwise an error is thrown.
 */
export function waitForEditorWindow(title: string, timeoutMs: number = 5000) {
  return promiseWithTimeout(
    async () => {
      while (true) {
        const editorView = new EditorView();
        try {
          const editor = await editorView.openEditor(title);
          return editor;
        } catch {
          await editorView.getDriver().sleep(500);
        }
      }
    },
    timeoutMs,
    {
      errorMsg: `Failed to open the editor window with the title '${title}' in ${timeoutMs}ms`
    }
  );
}

/**
 * Creates a temporary directory either in a subfolder of the environment
 * variable `TMPDIR` or in the systems temporary folder.
 * The path to the created temporary directory is returned.
 */
export function createTestTempDir(): Promise<string> {
  return fsPromises.mkdtemp(join(getTmpPrefix(), "obs-connector"));
}

/**
 * Ensure that the file with the given `path` is deleted.
 * This function does nothing if `path` is not present or not a file.
 *
 * @return `true` when the file was removed or `false` if it did not exist.
 */
export async function ensureFileNotPresent(path: string): Promise<boolean> {
  if ((await pathExists(path, PathType.File)) !== undefined) {
    await fsPromises.unlink(path);
    return true;
  }
  return false;
}

/** Enters `text` into a existing Input Box and confirms it */
export async function enterTextIntoInputBox(text: string): Promise<void> {
  const input = await InputBox.create();
  await input.setText(text);
  await input.confirm();
}

/**
 * Create a new account by executing the command `newAccountWizard` and entering
 * all properties into the input boxes & quick picks.
 *
 * @param acc  The account to be added
 * @param password  The account's password
 * @param stopAfterPasswordEntry  When set to `true`, then this function will
 *     stop after entering the password (and thus not finish the actual account
 *     creation).
 * @param acceptHostUnreachable  If the API belonging to `acc` is not reachable,
 *     then this account will still be accepted and added.
 */
export async function createAccountViaCommand(
  acc: AccountStorage,
  password: string,
  {
    stopAfterPasswordEntry = false,
    acceptHostUnreachable = false
  }: { stopAfterPasswordEntry?: boolean; acceptHostUnreachable?: boolean } = {}
): Promise<void> {
  const bench = new Workbench();
  await bench.executeCommand(
    "Add an existing account from the Open Build Service to the extension"
  );

  const typeSelectBox = await InputBox.create();

  // account type? OBS => no API url required, other => enter API url
  if (acc.apiUrl.match(new RegExp("api.opensuse.org")) === null) {
    const item = await typeSelectBox.findQuickPick("other (custom)");
    expect(item).to.not.equal(undefined);
    await item?.select();
    await typeSelectBox.confirm();

    await enterTextIntoInputBox(acc.apiUrl);
  } else {
    const item = await typeSelectBox.findQuickPick("build.opensuse.org (OBS)");
    expect(item).to.not.equal(undefined);
    await item?.select();
    await typeSelectBox.confirm();
  }

  await enterTextIntoInputBox(acc.username);
  await enterTextIntoInputBox(password);

  if (stopAfterPasswordEntry) {
    return;
  }

  // host is unreachable => notification will be displayed nagging about that
  // => find the correct one, press "Yes" and continue
  if (acceptHostUnreachable) {
    const notif = await waitForNotifications();
    const warningNotificationIndex = (
      await Promise.all(notif.map((n) => n.getMessage()))
    ).findIndex((msg) => msg.match(/add this account anyway/) !== null);
    warningNotificationIndex.should.not.equal(-1);
    await notif[warningNotificationIndex].takeAction("Yes");
    await bench
      .getDriver()
      .wait(until.stalenessOf(notif[warningNotificationIndex]));
  }

  await enterTextIntoInputBox(acc.accountName);
  await enterTextIntoInputBox(acc.realname ?? "");
  await enterTextIntoInputBox(acc.email ?? "");
}

/**
 * Removes an account from the extension by invoking the `removeAccount`
 * command.
 *
 * @param accountName The `accountName` property of this account from the
 *     settings.
 * @param apiUrl  Url to the API of this account
 */
export async function deleteAccount(
  accountName: string,
  apiUrl: string
): Promise<void> {
  const bench = new Workbench();
  await bench.executeCommand("vscodeObs.obsAccount.removeAccount");

  // if there are multiple accounts defined, we'll get asked which one to remove
  // if there is just one, the input will be skipped
  // if there are none, then this function just fails :)
  let accSelectionBox: InputBox | undefined;
  try {
    accSelectionBox = await InputBox.create();
  } catch (_err) {
    accSelectionBox = undefined;
  }

  if (accSelectionBox !== undefined) {
    await accSelectionBox.setText(accountName);
    await accSelectionBox.confirm();
  }

  const dialog = await waitForElement(() => new ModalDialog());
  const msg = await dialog.getDetails();

  msg.should.match(new RegExp(apiUrl));
  msg.should.match(/the account for the api.*will be deleted, are you sure?/i);

  await dialog.pushButton("Yes");
}

export const SETTINGS_JSON = "settings.json";

/**
 * Open the current global settings as json.
 *
 * @returns Object with the following properties:
 *     - `editorView`: a [[EditorView]] that can be used to access the open editors
 *     - `settingsJsonEditor`: [[TextEditor]] containing the settings.
 */
export async function openSettingsJson(): Promise<{
  settingsJsonEditor: TextEditor;
  editorView: EditorView;
}> {
  await new Workbench().executeCommand("workbench.action.openSettingsJson");

  const editorView = new EditorView();
  await editorView.openEditor(SETTINGS_JSON);
  return { editorView, settingsJsonEditor: new TextEditor() };
}

/**
 * Change the contents of `settings.json` by writing the result of
 * `modifyCallback(currentSettings)` back to `settings.json`.
 *
 * @param modifyCallback  A callback that receives the current settings as an
 *     object and returns the new settings (not converted to json). This
 *     function must not be asynchronous.
 */
export async function modifySettingsJson(
  modifyCallback: (settings: any) => any
): Promise<void> {
  const { editorView, settingsJsonEditor } = await openSettingsJson();
  const settings = JSON.parse(await settingsJsonEditor.getText());

  await settingsJsonEditor.setText(
    JSON.stringify(modifyCallback(settings), undefined, 4)
  );
  await settingsJsonEditor.save();

  await editorView.closeEditor(SETTINGS_JSON);
}
