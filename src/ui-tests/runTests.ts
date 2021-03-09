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
import { should, use } from "chai";
import * as chaiAsPromised from "chai-as-promised";
import * as chaiThings from "chai-things";
import { promises as fsPromises } from "fs";
import { pathExists, PathType } from "open-build-service-api";
import * as path from "path";
import { join } from "path";
import { ExTester, logging } from "vscode-extension-tester";
import { ReleaseQuality } from "vscode-extension-tester/out/util/codeUtil";
import { testUser } from "./testEnv";

use(chaiAsPromised);
use(chaiThings);
should();

async function getDirectoryNames(
  sourceDir: string,
  includeHidden: boolean = false
): Promise<string[]> {
  const dentries = await fsPromises.readdir(sourceDir, { withFileTypes: true });

  return dentries
    .filter(
      (dentry) =>
        dentry.isDirectory() && (includeHidden ? true : dentry.name[0] !== ".")
    )
    .map((dentry) => dentry.name);
}

async function copyRecursive(
  sourceDir: string,
  destDir: string
): Promise<void> {
  await fsPromises.mkdir(destDir, { recursive: true });
  const dentries = await fsPromises.readdir(sourceDir, { withFileTypes: true });

  await Promise.all(
    dentries.map(async (dentry) => {
      if (dentry.isFile()) {
        await fsPromises.copyFile(
          path.join(sourceDir, dentry.name),
          path.join(destDir, dentry.name)
        );
      } else if (dentry.isDirectory()) {
        await copyRecursive(
          path.join(sourceDir, dentry.name),
          path.join(destDir, dentry.name)
        );
      }
    })
  );
}

interface Credentials {
  account: string;
  password: string;
}

class TestEnv {
  public readonly fakeHomeDir: string;

  private restoreSettingsJson: boolean;
  private oldSettingsJson: any | undefined = undefined;
  private readonly settingsJson = path.join(this.testSrcDir, "settings.json");

  /**
   * @param testSrcDir  The directory in which the test source files are stored
   *     (i.e. the typescript files, the `settings.json` and optionally
   *     additional home directory overrides)
   * @param credentials  An array of credentials that should be put into the
   *     fake OS keychain.
   * @param injectTestUserIntoSettings  Flag whether to add the test user
   *     ([[testUser]]) to this test environment's `settings.json`.
   */
  constructor(
    private readonly testSrcDir: string,
    private readonly credentials: Credentials[],
    public readonly injectTestUserIntoSettings: boolean = true
  ) {
    this.restoreSettingsJson = false;

    this.fakeHomeDir = path.join(this.testSrcDir, "fakeHome");

    if (this.injectTestUserIntoSettings) {
      this.credentials.push({
        account: testUser.apiUrl,
        password: testUser.password
      });
    }
  }

  public async setUp(): Promise<void> {
    if (await pathExists(this.settingsJson, PathType.File)) {
      this.restoreSettingsJson = true;
      try {
        this.oldSettingsJson = JSON.parse(
          (await fsPromises.readFile(this.settingsJson)).toString()
        );
      } catch (err) {
        this.oldSettingsJson = undefined;
      }
    }

    if (
      (await pathExists(this.fakeHomeDir, PathType.Directory)) === undefined
    ) {
      await fsPromises.mkdir(this.fakeHomeDir);
    }

    await fsPromises.writeFile(
      join(this.fakeHomeDir, "passwords.ini"),
      // nasty hack: copy-pasta the service name from accounts.ts, because we
      // cannot import it from there (would require importing vscode, which is
      // not present under ui tests)
      `[vscode-obs.accounts]
`.concat(
        ...this.credentials.map(
          (c) => `${c.account} = ${c.password}
`
        )
      )
    );

    const newSettingsJson: any = this.oldSettingsJson ?? {};

    // disables annoying telemetry notifications (in theory, in practice vscode
    // ignores this setting unfortunately)
    newSettingsJson["telemetry.enableCrashReporter"] = false;
    newSettingsJson["telemetry.enableTelemetry"] = false;
    newSettingsJson["window.newWindowDimensions"] = "maximized";
    newSettingsJson["window.restoreFullscreen"] = true;
    newSettingsJson["workbench.enableExperiments"] = false;

    // to get modal dialogs to work with vscode-extension-tester
    newSettingsJson["window.dialogStyle"] = "custom";

    newSettingsJson["vscode-obs.logLevel"] = "trace";
    // the docker compose setup uses http
    newSettingsJson["vscode-obs.forceHttps"] = false;

    if (this.injectTestUserIntoSettings) {
      const { accountName, apiUrl, username } = testUser;
      newSettingsJson["vscode-obs.accounts"] = [
        { accountName, apiUrl, username }
      ];
    }

    await fsPromises.writeFile(
      this.settingsJson,
      JSON.stringify(newSettingsJson)
    );

    await fsPromises.mkdir(this.fakeHomeDir, { recursive: true });
  }

  public async tearDown(): Promise<void> {
    if (this.restoreSettingsJson) {
      await fsPromises.writeFile(
        this.settingsJson,
        JSON.stringify(this.oldSettingsJson)
      );
    } else {
      await fsPromises.unlink(path.join(this.testSrcDir, "settings.json"));
    }
  }
}

/** extension root */
const extDir = path.resolve(__dirname, "../../");

/** path to our custom libsecret.so */
const pathToLibsecret = path.join(
  extDir,
  "mocklibsecret",
  "build",
  "libsecret.so"
);

/** the directory where the typescript ui-test files are */
const baseTestSrcDir = path.resolve(path.join(extDir, "src", "ui-tests"));

/** directory where vscode-extension-tester stores its data */
const storageBaseFolder = path.resolve(path.join(extDir, "test-resources"));

async function main() {
  assert(
    (await pathExists(pathToLibsecret, PathType.File)) !== undefined,
    "libsecret.so has not been built yet"
  );

  const dir = process.argv[2];

  const testDir = path.join(__dirname, dir);
  const testSrcDir = path.join(baseTestSrcDir, dir);

  const usersJson = JSON.parse(
    await fsPromises.readFile(path.join(testSrcDir, "users.json"), "utf8")
  );

  const credentials: Credentials[] = [];
  usersJson.users.forEach((u: Credentials) => credentials.push(u));

  const testEnv = new TestEnv(
    testSrcDir,
    credentials,
    usersJson.injectTestUserIntoSettings
  );

  try {
    await testEnv.setUp();

    const vscodeVersion = process.env.VSCODE_VERSION;
    const releaseType =
      vscodeVersion !== undefined
        ? vscodeVersion.match(/insider/)
          ? ReleaseQuality.Insider
          : ReleaseQuality.Stable
        : ReleaseQuality.Stable;

    process.env.LD_PRELOAD = pathToLibsecret;
    process.env.HOME = testEnv.fakeHomeDir;
    process.env.EXTENSION_DEBUG = "1";

    const exTester = new ExTester(
      path.join(storageBaseFolder, dir),
      releaseType
    );
    await exTester.setupAndRunTests(
      `${testDir}/!(flycheck_)**.js`,
      vscodeVersion === "insider" ? "latest" : vscodeVersion,
      { useYarn: true, installDependencies: true },
      {
        settings: path.join(testSrcDir, "settings.json"),
        cleanup: true,
        logLevel: logging.Level.ALL
      }
    );
  } catch (err) {
    console.error(`Tests ${dir} failed with: ${err.toString()}`);
    process.exitCode = 1;
  } finally {
    await testEnv.tearDown();
  }
}

main();
