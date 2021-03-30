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

import {
  getExtensionLogger,
  getExtensionLoggerOpts,
  IVSCodeExtLogger,
  LogLevel
} from "@vscode-logging/logger";
import * as assert from "assert";
import { readFileSync } from "fs";
import { resolve } from "path";
import * as vscode from "vscode";
import { cmdPrefix, CONFIGURATION_EXTENSION_NAME } from "./constants";

const ext_name = JSON.parse(
  readFileSync(resolve(__dirname, "..", "package.json"), "utf-8")
).name as string;

assert(typeof ext_name === "string");

/** The name of this extension, extracted from `package.json` */
export const EXTENSION_NAME: string = ext_name;

/** Command to switch to the log output in the consoles */
export const DISPLAY_LOG_COMMAND = `${cmdPrefix}.logging.displayLog`;

/** sub-name of the log level configuration option */
export const LOG_LEVEL_SETTING = "logLevel";

/** full name of the log level configuration option */
export const CONFIGURATION_LOG_LEVEL = `${CONFIGURATION_EXTENSION_NAME}.${LOG_LEVEL_SETTING}`;

const DEFAULT_LOG_LEVEL: LogLevel = "error";

let logger: IVSCodeExtLogger | undefined;

/**
 * Returns the logger used by the extension.
 *
 * @return A [[IVSCodeExtLogger]] if the extension has been properly
 *     initialized, otherwise `undefined` is returned.
 */
export const getGlobalLogger = (): IVSCodeExtLogger | undefined => logger;

/**
 * Initialize the global logger and setup a event listener that adjusts the
 * logging level if it is modified in the settings.
 *
 * @param context  The [[vscode.ExtensionContext]] passed to the [[activate]]
 *     function of the extension.
 *
 * @param debugMode  When `true`, then the created logger's logging level is set
 *     to `trace` and source location tracking and logging to console is
 *     enabled.
 *     Otherwise, the later two options are kept at the default and the logging
 *     level is taken from [[CONFIGURATION_LOG_LEVEL]].
 *
 * @param getExtensionLoggerFunc  The function that returns the logger (only
 *     useful to change this for testing purposes).
 *
 * @return The created logger.
 */
export function setupLogger(
  context: vscode.ExtensionContext,
  {
    debugMode = false,
    getExtensionLoggerFunc = getExtensionLogger
  }: {
    debugMode?: boolean;
    getExtensionLoggerFunc?: typeof getExtensionLogger;
  } = {}
): IVSCodeExtLogger {
  const logOutputChannel = vscode.window.createOutputChannel(EXTENSION_NAME);
  const options: getExtensionLoggerOpts = {
    extName: EXTENSION_NAME,
    logPath: context.logUri.fsPath,
    logOutputChannel,
    level: debugMode
      ? "trace"
      : vscode.workspace
          .getConfiguration()
          .get<LogLevel>(CONFIGURATION_LOG_LEVEL, DEFAULT_LOG_LEVEL)
  };
  if (debugMode) {
    options.sourceLocationTracking = true;
    options.logConsole = true;
  }
  logger = getExtensionLoggerFunc(options);

  context.subscriptions.push(
    vscode.commands.registerCommand(DISPLAY_LOG_COMMAND, (): void => {
      logOutputChannel.show();
    }),
    logOutputChannel,
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIGURATION_LOG_LEVEL)) {
        const logLevel = vscode.workspace
          .getConfiguration()
          .get<LogLevel>(CONFIGURATION_LOG_LEVEL, DEFAULT_LOG_LEVEL);

        logger?.changeLevel(logLevel);
      }
    })
  );

  return logger;
}
