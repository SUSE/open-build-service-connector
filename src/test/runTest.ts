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

import * as path from "path";

import { userInfo } from "os";
import { runTests } from "vscode-test";

async function main() {
  let retval: number = 0;
  try {
    // The folder containing the Extension Manifest package.json
    // Passed to `--extensionDevelopmentPath`
    const extensionDevelopmentPath = path.resolve(__dirname, "../../");

    // The path to test runner
    // Passed to --extensionTestsPath
    const extensionTestsPath = path.resolve(__dirname, "./suite/index");

    const launchArgs = ["--disable-extensions", "--disable-gpu"];

    // vscode insiders must be launched with --no-sandbox when running as root
    // (this should only happen on the CI anyway)
    if (
      process.env.VSCODE_VERSION !== undefined &&
      process.env.VSCODE_VERSION === "insiders" &&
      userInfo().uid === 0
    ) {
      launchArgs.push("--no-sandbox");
    }
    // Download VS Code, unzip it and run the unit tests
    retval = await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs,
      version: process.env.VSCODE_VERSION
    });
  } catch (err) {
    console.error(err);
    retval = 1;
  }
  process.exit(retval);
}

main();
