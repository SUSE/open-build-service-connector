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

// adapted from:
// https://github.com/mjcrouch/vscode-perforce/blob/master/src/ComboBoxInput.ts
// (MIT licensed)

import * as vscode from "vscode";
import { createItemInserter } from "./util";

/** Options to configure the behavior of the [[ComboBoxInput]] */
export interface ComboBoxInputOptions
  extends Omit<vscode.QuickPickOptions, "canPickMany"> {
  /**
   * Index before which the custom items will be inserted.
   *
   * When this value is not set, then they will be appended.
   */
  insertBeforeIndex?: number;
}

/**
 * @brief Create a QuickPick with dynamic and static elements that can be picked.
 *
 * This function opens a QuickPick that gets populated with the entries from
 * `items` and the result from `provideInputItems`. `provideInputItems` is
 * called each time the user enters something into the QuickPick and the
 * displayed entries are changed accordingly.
 *
 * @param items  Initial items that will be used to populate the QuickPick
 * @param provideInputItems Function that returns the dynamic items for the
 *     QuickPick.
 *     It is invoked on each change of the input by the user with the currently
 *     entered value. It is also invoked initially with "" to create the initial
 *     list of entries for the QuickPick.
 * @param options  Optional settings that configure the behavior of the QuickPick.
 */
export function showComboBoxInput<
  T extends Omit<vscode.QuickPickItem, "picked">
>(
  items: T[] | readonly T[],
  provideInputItems: (value: string) => T[] | readonly T[],
  options?: ComboBoxInputOptions
): Promise<T | undefined> {
  const quickPick = vscode.window.createQuickPick<T>();

  const subscriptions: vscode.Disposable[] = [quickPick];
  const dispose = (): void => {
    subscriptions.forEach((sub) => {
      sub.dispose();
    });
  };

  quickPick.canSelectMany = false;
  quickPick.matchOnDescription = options?.matchOnDescription ?? false;
  quickPick.matchOnDetail = options?.matchOnDetail ?? false;
  quickPick.ignoreFocusOut = options?.ignoreFocusOut ?? false;
  quickPick.placeholder = options?.placeHolder;

  const def = provideInputItems("");
  const inserter = createItemInserter(items, options?.insertBeforeIndex);

  quickPick.items = inserter(def);

  subscriptions.push(
    quickPick.onDidChangeValue((value) => {
      const provided = provideInputItems(value);
      quickPick.items = inserter(provided);
      quickPick.activeItems = provided.slice(-1);
    })
  );

  const promise = new Promise<T | undefined>((resolve) => {
    subscriptions.push(
      quickPick.onDidAccept(() => {
        resolve(quickPick.selectedItems[0]);
        quickPick.hide();
        dispose();
      })
    );
    subscriptions.push(
      quickPick.onDidHide(() => {
        resolve(undefined);
        dispose();
      })
    );
  });
  quickPick.show();
  return promise;
}
