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
import { Package, PackageFile, Project } from "open-build-service-api";
import * as vscode from "vscode";
import { BaseProject } from "./base-components";

/** A tree element representing a project in the open build service */
export class ProjectTreeElement extends vscode.TreeItem {
  public contextValue = "project";

  public readonly project: BaseProject;

  constructor(project: Project) {
    super(project.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.project = new BaseProject(project);
  }
}

export function isProjectTreeElement(
  treeItem: vscode.TreeItem
): treeItem is ProjectTreeElement {
  // do not identify the ProjectTreeElement by the contextValue as we do it with
  // other elements, we want to identify the LocalProjectTreeElement as well
  return (treeItem as ProjectTreeElement).project !== undefined;
}

export class PackageTreeElement extends vscode.TreeItem {
  public readonly contextValue = "package";

  public readonly iconPath = new vscode.ThemeIcon("package");

  public readonly parentProject: BaseProject;

  public readonly packageName: string;

  constructor(pkg: Package) {
    super(pkg.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.parentProject = new BaseProject(pkg.apiUrl, pkg.projectName);
    this.packageName = pkg.name;
  }
}

export function isPackageTreeElement(
  treeItem: any
): treeItem is PackageTreeElement {
  return treeItem.contextValue === "package";
}

export class FileTreeElement extends vscode.TreeItem {
  // public readonly command: vscode.Command;

  public readonly contextValue = "packageFile";

  public readonly iconPath = new vscode.ThemeIcon("file");

  public readonly parentProject: BaseProject;
  public readonly packageName: string;

  // FIXME: this property is actually pointless, as it is available via the
  // label property. Maybe drop it?
  public readonly fileName: string;

  constructor(apiUrl: string, pkgFile: PackageFile) {
    super(pkgFile.name, vscode.TreeItemCollapsibleState.None);
    this.packageName = pkgFile.packageName;
    this.fileName = pkgFile.name;
    this.parentProject = new BaseProject(apiUrl, pkgFile.projectName);
  }
}

export function isFileTreeElement(
  treeItem: vscode.TreeItem
): treeItem is FileTreeElement {
  return treeItem.contextValue === "packageFile";
}

export type ProjectTreeItem =
  | ProjectTreeElement
  | PackageTreeElement
  | FileTreeElement;

export function isProjectTreeItem(obj: any): obj is ProjectTreeItem {
  return (
    isProjectTreeElement(obj) ||
    isPackageTreeElement(obj) ||
    isFileTreeElement(obj)
  );
}

export function getChildrenOfPackageTreeElement(
  rootProject: Project,
  element: PackageTreeElement
): ProjectTreeItem[] {
  assert(
    element.parentProject.name === rootProject.name &&
      element.parentProject.apiUrl === rootProject.apiUrl
  );

  const matchingPkg = rootProject.packages?.find(
    (pkg) => pkg.name === element.packageName
  );

  return matchingPkg === undefined
    ? []
    : matchingPkg.files?.map(
        (pkgFile) => new FileTreeElement(rootProject.apiUrl, pkgFile)
      ) ?? [];
}

export function getChildrenOfProjectTreeElement(
  rootProject: Project,
  element: ProjectTreeElement
): ProjectTreeItem[] {
  assert(
    element.project.name === rootProject.name &&
      element.project.apiUrl === rootProject.apiUrl,
    `rootProject (${rootProject.name} from ${rootProject.apiUrl}) and project from the element (${element.project.name} from ${element.project.apiUrl}) are not the same.`
  );

  return rootProject.packages?.map((pkg) => new PackageTreeElement(pkg)) ?? [];
}

export function getChildrenOfProjectTreeItem(
  rootProject: Project,
  element?: ProjectTreeItem
): ProjectTreeItem[] {
  // root element
  if (element === undefined) {
    return [new ProjectTreeElement(rootProject)];
  }

  if (isProjectTreeElement(element)) {
    return getChildrenOfProjectTreeElement(rootProject, element);
  }

  if (isPackageTreeElement(element)) {
    return getChildrenOfPackageTreeElement(rootProject, element);
  }

  assert(
    false,
    `This code must be unreachable, but reached it via a ${element.contextValue} Element`
  );
}
