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

import * as glob from "glob";
import * as Mocha from "mocha";
import * as path from "path";

function setupCoverage() {
  const NYC = require("nyc");
  const nyc = new NYC({
    all: true,
    cwd: path.join(__dirname, "..", "..", ".."),
    exclude: ["**/test/**", ".vscode-test/**"],
    hookRequire: true,
    hookRunInContext: true,
    hookRunInThisContext: true,
    instrument: true,
    reporter: ["text", "html", "lcov", "json-summary"]
  });

  nyc.reset();
  nyc.wrap();

  return nyc;
}

export async function run(): Promise<void> {
  const nyc = process.env.COVERAGE ? setupCoverage() : null;

  // Create the mocha test
  const mocha = new Mocha({
    ui: "tdd"
  });
  mocha.useColors(true);

  const testsRoot = path.resolve(__dirname, "..");

  for (const file of glob.sync("**/**.test.js", { cwd: testsRoot })) {
    // FIXME: make flycheck not create these files
    if (file.search("flycheck_") === -1) {
      mocha.addFile(path.resolve(testsRoot, file));
    }
  }

  try {
    await new Promise((resolve, reject) => {
      mocha.run((failures) => {
        failures > 0
          ? reject(new Error(`${failures} tests failed.`))
          : resolve();
      });
    });
  } finally {
    if (nyc) {
      nyc.writeCoverageFile();
      nyc.report();
    }
  }
}
