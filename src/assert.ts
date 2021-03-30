/**
 * Copyright (c) 2021 SUSE LLC
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

import { IVSCodeExtLogger } from "@vscode-logging/logger";
import * as vscode from "vscode";
import { LoggingDisposableBase } from "./base-components";
import { cmdPrefix } from "./constants";
import { DISPLAY_LOG_COMMAND, getGlobalLogger } from "./logging";

const cmdId = "assert";

export const ERROR_PAGE_SCHEME = `vscodeObsErrorPage`;

export const SET_LAST_ERROR_COMMAND = `${cmdPrefix}.${cmdId}.setLastError`;

/** Open the error reporting page */
export const OPEN_INTERNAL_ERROR_PAGE_COMMAND = `${cmdPrefix}.${cmdId}.openInternalErrorPage`;

interface InternalError {
  readonly msg: string;
  occurenceTime?: Date;
  readonly stack?: string;
}

const DEFAULT_INTERNAL_ERROR = { msg: "No error recorded" };

export const ERROR_PAGE_URI = vscode.Uri.parse(
  `${ERROR_PAGE_SCHEME}:internal error.md`,
  true
);

/**
 * Custom assert that will asynchronously open the error reporting page with
 * additional information for error reporting.
 */
export function assert(condition: boolean, msg?: string): asserts condition {
  if (condition) {
    return;
  }

  void ErrorPageDocumentProvider.setLastErrorCommand({
    msg: msg ?? "Assertion failed",
    stack: new Error().stack,
    occurenceTime: new Date()
  })
    .then(
      async (): Promise<void> => {
        await vscode.window
          .showErrorMessage(
            `An internal error occurred${
              msg === undefined ? "" : ": ".concat(msg)
            }. Would you like to open the Error Report page?`,
            { modal: true },
            "Yes",
            "No"
          )
          .then(
            async (yesNo): Promise<void> => {
              if (yesNo === "Yes") {
                await vscode.commands.executeCommand(
                  OPEN_INTERNAL_ERROR_PAGE_COMMAND
                );
              }
            }
          );
      }
    )
    .catch((err) => {
      getGlobalLogger()?.error(
        "Tried to open the error reporting page for the error with the message '%', but got the error: %s",
        msg,
        (err as Error).toString()
      );
    });

  throw new Error(`Assertion failed! ${msg ?? ""}`);
}

/**
 * A Document provider that displays a Error reporting page with additional
 * information about the failure.
 */
export class ErrorPageDocumentProvider
  extends LoggingDisposableBase
  implements vscode.TextDocumentContentProvider {
  private lastError: InternalError = DEFAULT_INTERNAL_ERROR;

  private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  public onDidChange: vscode.Event<vscode.Uri> = this.onDidChangeEmitter.event;

  /** Displays the actual */
  public provideTextDocumentContent(uri: vscode.Uri): string {
    if (uri.scheme !== ERROR_PAGE_SCHEME) {
      throw new Error(
        `invalid uri scheme: ${uri.scheme}, expected ${ERROR_PAGE_SCHEME}`
      );
    }

    return `# An internal error occurred

Please report it upstream: https://github.com/SUSE/open-build-service-connector/issues/new

and include the following information:

message: ${this.lastError.msg}
`.concat(
      this.lastError.occurenceTime !== undefined
        ? `recorded on: ${this.lastError.occurenceTime.toLocaleDateString()}`
        : "",
      this.lastError.stack !== undefined
        ? `
## stack:
${this.lastError.stack}
`
        : "",
      `
## Log file (please remove sensitive information)

Open the log by executing the command ${DISPLAY_LOG_COMMAND}
`
    );
  }

  public static async setLastErrorCommand(
    lastError: InternalError
  ): Promise<void> {
    await vscode.commands.executeCommand(SET_LAST_ERROR_COMMAND, lastError);
  }

  private async openInternalErrorPage(
    lastError?: InternalError
  ): Promise<void> {
    this.setLastError(lastError ?? DEFAULT_INTERNAL_ERROR, false);
    const document = await vscode.workspace.openTextDocument(ERROR_PAGE_URI);
    await vscode.window.showTextDocument(document, { preview: false });
  }

  private setLastError(
    lastError?: InternalError,
    fireEvent: boolean = true
  ): void {
    if (lastError) {
      this.lastError = lastError;
    } else {
      const msg = `command ${SET_LAST_ERROR_COMMAND} invoked without the parameter 'lastError'`;
      this.logger.error(msg);
      this.lastError = {
        msg,
        stack: new Error(msg).stack,
        occurenceTime: new Date()
      };
    }

    if (fireEvent) {
      this.onDidChangeEmitter.fire(ERROR_PAGE_URI);
    }
  }

  constructor(logger: IVSCodeExtLogger) {
    super(logger);
    this.disposables.push(
      vscode.commands.registerCommand(
        SET_LAST_ERROR_COMMAND,
        this.setLastError,
        this
      ),
      vscode.commands.registerCommand(
        OPEN_INTERNAL_ERROR_PAGE_COMMAND,
        this.openInternalErrorPage,
        this
      ),
      vscode.workspace.registerTextDocumentContentProvider(
        ERROR_PAGE_SCHEME,
        this
      ),
      this.onDidChangeEmitter
    );
  }
}
