import * as vscode from "vscode";

/** Dependency injection type to be able to unit test UI elements */
export interface VscodeWindow {
  showInformationMessage: typeof vscode.window.showInformationMessage;

  showErrorMessage: typeof vscode.window.showErrorMessage;

  showQuickPick: typeof vscode.window.showQuickPick;

  showInputBox: typeof vscode.window.showInputBox;
}
