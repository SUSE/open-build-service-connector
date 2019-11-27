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
      mocha.run(failures => {
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
