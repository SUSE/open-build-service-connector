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

import { join } from "path";
import { Logger } from "pino";
import * as vscode from "vscode";
import { AccountManager } from "./accounts";
import { ConnectionListenerLoggerBase } from "./base-components";
import {
  CurrentPackage,
  CurrentPackageWatcher
} from "./current-package-watcher";
import {
  FileTreeElement,
  getChildrenOfProjectTreeItem,
  isFileTreeElement,
  isProjectTreeElement,
  ProjectTreeElement,
  ProjectTreeItem
} from "./project-view";

const PROJECT_ICON = new vscode.ThemeIcon("project");

export const LOCAL_PROJECT_TREE_ELEMENT_CTX_VAL = "localProject";

export class LocalProjectTreeElement extends ProjectTreeElement {
  public readonly contextValue = LOCAL_PROJECT_TREE_ELEMENT_CTX_VAL;

  constructor(
    projectTreeElement: ProjectTreeElement,
    public readonly checkedOutPath: string
  ) {
    super(projectTreeElement.project);
  }
}

export function isLocalProjectTreeElement(
  elem: ProjectTreeItem | LocalProjectTreeElement
): elem is LocalProjectTreeElement {
  return (
    isProjectTreeElement(elem) &&
    elem.contextValue === LOCAL_PROJECT_TREE_ELEMENT_CTX_VAL &&
    (elem as any).checkedOutPath !== undefined &&
    typeof (elem as any).checkedOutPath === "string"
  );
}

class LocalFileTreeElement extends FileTreeElement {
  constructor(fileTreeElement: FileTreeElement, path: string) {
    super(fileTreeElement.parentProject.apiUrl, {
      name: fileTreeElement.fileName,
      packageName: fileTreeElement.packageName,
      projectName: fileTreeElement.parentProject.name
    });

    this.command = {
      arguments: [vscode.Uri.file(path)],
      command: "vscode.open",
      title: "Open this file from the file system"
    };
  }
}

export class CurrentProjectTreeProvider
  extends ConnectionListenerLoggerBase
  implements vscode.TreeDataProvider<ProjectTreeItem> {
  public onDidChangeTreeData: vscode.Event<ProjectTreeItem | undefined>;

  public onDidChange: vscode.Event<vscode.Uri>;

  private currentPackage: CurrentPackage;

  private onDidChangeTreeDataEmitter: vscode.EventEmitter<
    ProjectTreeItem | undefined
  > = new vscode.EventEmitter<ProjectTreeItem | undefined>();

  private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();

  constructor(
    currentPackageWatcher: CurrentPackageWatcher,
    accountManager: AccountManager,
    logger: Logger
  ) {
    super(accountManager, logger);

    this.currentPackage = currentPackageWatcher.currentPackage;

    this.onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
    this.onDidChange = this.onDidChangeEmitter.event;

    this.disposables.push(
      currentPackageWatcher.onDidChangeCurrentPackage((curPkg) => {
        this.logger.trace(
          "CurrentProjectTreeProvider received an updated current package: %s/%s",
          curPkg.currentPackage?.projectName,
          curPkg.currentPackage?.name
        );
        this.currentPackage = curPkg;
        this.refresh();
      }, this),
      this.onDidChangeTreeDataEmitter,
      this.onAccountChange(() => {
        this.refresh();
      })
    );
  }

  public refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  public getTreeItem(element: ProjectTreeItem): vscode.TreeItem {
    if (isProjectTreeElement(element)) {
      element.iconPath = PROJECT_ICON;
    }
    return element;
  }

  public getChildren(element?: ProjectTreeItem): ProjectTreeItem[] {
    if (this.currentPackage.currentProject === undefined) {
      return [];
    }

    const children = getChildrenOfProjectTreeItem(
      this.currentPackage.currentProject,
      element
    );

    const checkedOutPath = this.currentPackage.properties?.checkedOutPath;
    const transformCheckedOut: (
      elem: ProjectTreeItem
    ) => ProjectTreeItem | LocalProjectTreeElement | LocalFileTreeElement = (
      elem: ProjectTreeItem
    ) => {
      if (isProjectTreeElement(elem)) {
        return new LocalProjectTreeElement(elem, checkedOutPath!);
      } else if (isFileTreeElement(elem)) {
        return new LocalFileTreeElement(
          elem,
          // FIXME: is this path really defined?
          join(checkedOutPath!, elem.fileName)
        );
      }
      return elem;
    };

    return this.currentPackage.properties?.checkedOutPath === undefined
      ? children
      : children.map(transformCheckedOut);
  }
}
