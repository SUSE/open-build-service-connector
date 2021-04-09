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

import {
  branchPackage,
  checkConnection,
  checkOutPackage,
  checkOutProject,
  fetchFileContents,
  fetchHistory,
  fetchHistoryAcrossLinks,
  fetchPackage,
  fetchProject,
  fetchServerCaCertificate,
  readAccountsFromOscrc,
  readInUnifiedPackage,
  submitPackage
} from "open-build-service-api";
import * as vscode from "vscode";

/** Dependency injection type to be able to unit test UI elements */
export interface VscodeWindow {
  showInformationMessage: typeof vscode.window.showInformationMessage;

  showErrorMessage: typeof vscode.window.showErrorMessage;

  showQuickPick: typeof vscode.window.showQuickPick;

  showInputBox: typeof vscode.window.showInputBox;

  showOpenDialog: typeof vscode.window.showOpenDialog;

  withProgress: typeof vscode.window.withProgress;

  onDidChangeActiveTextEditor: typeof vscode.window.onDidChangeActiveTextEditor;

  activeTextEditor: typeof vscode.window.activeTextEditor;

  visibleTextEditors: typeof vscode.window.visibleTextEditors;

  registerWebviewViewProvider: typeof vscode.window.registerWebviewViewProvider;
}

export interface VscodeWorkspace {
  getWorkspaceFolder: typeof vscode.workspace.getWorkspaceFolder;

  createFileSystemWatcher: typeof vscode.workspace.createFileSystemWatcher;

  textDocuments: typeof vscode.workspace.textDocuments;
}

export interface ObsFetchers {
  readonly fetchFileContents: typeof fetchFileContents;
  readonly fetchPackage: typeof fetchPackage;
  readonly fetchProject: typeof fetchProject;
  readonly fetchHistory: typeof fetchHistory;
  readonly fetchHistoryAcrossLinks: typeof fetchHistoryAcrossLinks;
  readonly branchPackage: typeof branchPackage;
  readonly readInUnifiedPackage: typeof readInUnifiedPackage;
  readonly submitPackage: typeof submitPackage;
  readonly checkConnection: typeof checkConnection;
  readonly readAccountsFromOscrc: typeof readAccountsFromOscrc;
  readonly fetchServerCaCertificate: typeof fetchServerCaCertificate;
  readonly checkOutPackage: typeof checkOutPackage;
  readonly checkOutProject: typeof checkOutProject;
}

export const DEFAULT_OBS_FETCHERS: ObsFetchers = {
  fetchProject,
  fetchFileContents,
  fetchPackage,
  fetchHistory,
  fetchHistoryAcrossLinks,
  branchPackage,
  readInUnifiedPackage,
  submitPackage,
  checkConnection,
  readAccountsFromOscrc,
  fetchServerCaCertificate,
  checkOutPackage,
  checkOutProject
};
