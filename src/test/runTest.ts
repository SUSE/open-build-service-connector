import * as path from "path";

import { userInfo } from "os";
import { runTests } from "vscode-test";

async function main() {
  try {
    // The folder containing the Extension Manifest package.json
    // Passed to `--extensionDevelopmentPath`
    const extensionDevelopmentPath = path.resolve(__dirname, "../../");

    // The path to test runner
    // Passed to --extensionTestsPath
    const extensionTestsPath = path.resolve(__dirname, "./suite/index");

    const launchArgs = ["--disable-extensions"];

    // vscode insiders must be launched with --no-sandbox when running as root
    // (this should only happen on the CI anyway)
    if (
      process.env.VSCODE_VERSION !== undefined &&
      process.env.VSCODE_VERSION === "insiders" &&
      userInfo().uid === 0
    ) {
      launchArgs.push("--no-sandbox");
    }
    // Download VS Code, unzip it and run the integration test
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs,
      version: process.env.VSCODE_VERSION
    });
  } catch (err) {
    process.exit(1);
  }
}

main();
