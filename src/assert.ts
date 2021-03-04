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

import { promises as fsPromises } from "fs";
import { Logger } from "pino";
import * as vscode from "vscode";
import { LoggingDisposableBase } from "./base-components";
import { cmdPrefix } from "./constants";
import { GET_LOGFILE_PATH_COMMAND } from "./extension";

const cmdId = "assert";

export const ERROR_PAGE_SCHEME = `vscodeObsErrorPage`;

export const SET_LAST_ERROR_COMMAND = `${cmdPrefix}.${cmdId}.setLastError`;

/** Open the error reporting page */
export const OPEN_ERROR_REPORT_PAGE_COMMAND = `${cmdPrefix}.${cmdId}.openErrorReportPage`;

interface InternalError {
  readonly msg: string;
  occurenceTime?: Date;
  readonly stack?: string;
}

const DEFAULT_INTERNAL_ERROR = { msg: "No error recorded" };

export const ERROR_PAGE_URI = vscode.Uri.parse(
  `${ERROR_PAGE_SCHEME}:last error.md`,
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
                  OPEN_ERROR_REPORT_PAGE_COMMAND
                );
              }
            }
          );
      }
    )
    .catch(() => {});

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
  public async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    if (uri.scheme !== ERROR_PAGE_SCHEME) {
      throw new Error(
        `invalid uri scheme: ${uri.scheme}, expected ${ERROR_PAGE_SCHEME}`
      );
    }

    const logFilePath = await vscode.commands.executeCommand<string>(
      GET_LOGFILE_PATH_COMMAND
    );
    if (logFilePath === undefined) {
      this.logger.error(
        "Tried to get the log file path, but got undefined instead"
      );
    }

    let logfile: string | undefined;

    try {
      logfile =
        logFilePath !== undefined
          ? await fsPromises.readFile(logFilePath, { encoding: "utf8" })
          : undefined;
    } catch (err) {
      this.logger.error(
        "Tried to read the logfile from %s but got %s",
        logFilePath,
        (err as Error).toString()
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
      logfile !== undefined
        ? `
## Log file (please remove sensitive information):
\`\`\`json
${logfile}
\`\`\`
`
        : logFilePath === undefined
        ? `
## Could not get the path of the logfile
`
        : `
## Could not read logfile from ${logFilePath}
`
    );
  }

  public static async setLastErrorCommand(
    lastError: InternalError
  ): Promise<void> {
    await vscode.commands.executeCommand(SET_LAST_ERROR_COMMAND, lastError);
  }

  private async openErrorReportPage(lastError?: InternalError): Promise<void> {
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

  constructor(logger: Logger) {
    super(logger);
    this.disposables.push(
      vscode.commands.registerCommand(
        SET_LAST_ERROR_COMMAND,
        this.setLastError,
        this
      ),
      vscode.commands.registerCommand(
        OPEN_ERROR_REPORT_PAGE_COMMAND,
        this.openErrorReportPage,
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
