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
import {
  Notification,
  SideBarView,
  TreeItem,
  ViewItemAction,
  ViewSection
} from "vscode-extension-tester";

/**
 * Dismisses the MS telemetry notification and returns a new array which
 * contains all other notifications.
 */
export async function dismissMsTelemetryNotification(
  notifications: Notification[]
): Promise<void> {
  for (const notif of notifications) {
    const msg = await notif.getMessage();
    if (msg.match(/collect.*usage.*data/i) !== null) {
      await notif.dismiss();
      await notif.getDriver().sleep(100);
    }
  }
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
