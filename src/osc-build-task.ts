import { ChildProcessWithoutNullStreams, spawn } from "child_process";
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

import { Arch, ModifiedPackage } from "open-build-service-api";
import { readInUnifiedPackage } from "open-build-service-api/lib/package";
import { Logger } from "pino";
import * as vscode from "vscode";
import { AccountManager } from "./accounts";
import {
  ConnectionListenerLoggerBase,
  DisposableBase
} from "./base-components";
import { CurrentPackageWatcher } from "./current-package-watcher";
import { dropUndefined } from "./util";

export const OSC_BUILD_TASK_TYPE = "osc";

export const RPMLINT_PROBLEM_MATCHER = "rpmlint";

interface OscTaskDefinition extends vscode.TaskDefinition {
  readonly repository: string;
  readonly arch?: Arch;
  readonly cleanBuildRoot?: boolean;
  readonly extraOscArgs?: string[];
}

/* "problemMatchers": [
      {
        "name": "rpmlint",
        "owner": "rpm-spec",
        "fileLocation": ["relative", "${workspaceRoot}"],
        "pattern": [
          {
            "regexp": "\\[\\s*\\d*s\\] RPMLINT report:$"
          },
          {
            "regexp": "\\[\\s*\\d*s\\] (.*): (W: (?<warnName>.*): (?<extraInfo>.*)|E: (?<errName>.*)\\(Badness:\\s*(?<badness>\\d+)\\)\\s*(?<path>.*))",
            "line": 1,
            "column": 2,
            "severity": 3,
            "message": 4,
            "code": 5,
            "loop": true
          }
        ]
      }
    ]
*/

export class CustomExecutionTerminal
  extends DisposableBase
  implements vscode.Pseudoterminal {
  private onDidWriteEmitter = new vscode.EventEmitter<string>();

  private onDidCloseEmitter = new vscode.EventEmitter<number>();

  private child: ChildProcessWithoutNullStreams | undefined = undefined;
  public stdout: string = "";
  public stderr: string = "";

  public readonly args: readonly string[];

  public readonly onDidWrite = this.onDidWriteEmitter.event;
  public readonly onDidClose = this.onDidCloseEmitter.event;

  public open(_initialDimensions: vscode.TerminalDimensions | undefined): void {
    const child = spawn(this.command, this.args, {
      cwd: this.cwd,
      shell: true
    });
    child.stdout.on("data", (data) => {
      const line = data.toString().concat("\n");
      this.stdout = this.stdout.concat(line);
      this.onDidWriteEmitter.fire(line);
    });
    child.stderr.on("data", (data) => {
      const line = data.toString().concat("\n");
      this.stderr = this.stdout.concat(line);
      this.onDidWriteEmitter.fire(line);
    });
    child.on("close", (code) => this.onDidCloseEmitter.fire(code));

    this.child = child;
  }

  public close(): void {
    if (this.child === undefined || this.child.exitCode !== null) {
      return;
    }
    this.child.kill("SIGTERM") || this.child.kill("SIGKILL");
  }

  public handleInput(data: string): void {
    if (this.child === undefined || this.child.exitCode !== null) {
      return;
    }
    // FIXME: will this actually work?
    this.child.stdin.write(data);
  }

  constructor(
    public readonly command: string,
    args?: readonly string[],
    public readonly cwd?: string
  ) {
    super();
    this.args = args ?? [];
    this.disposables.push(this.onDidWriteEmitter, this.onDidCloseEmitter);
  }

  public dispose() {
    this.close();
    super.dispose();
  }
}

export class OscBuildTask extends vscode.Task {
  constructor(
    taskDef: OscTaskDefinition,
    pkg: ModifiedPackage,
    folder: vscode.WorkspaceFolder
  ) {
    super(
      taskDef,
      folder,
      `Build ${pkg.name} for ${taskDef.repository}`.concat(
        taskDef.arch !== undefined ? ` for ${taskDef.arch}` : ""
      ),
      "osc",
      new vscode.ProcessExecution(
        "osc",
        dropUndefined(
          [
            "build",
            taskDef.cleanBuildRoot === undefined || taskDef.cleanBuildRoot
              ? "--clean"
              : undefined,
            taskDef.repository,
            taskDef.arch
          ].concat(taskDef.extraOscArgs)
        ),
        { cwd: pkg.path }
      )

      // [RPMLINT_PROBLEM_MATCHER]
    );
    this.group = [vscode.TaskGroup.Build];
  }
}

export class OscBuildTaskProvider
  extends ConnectionListenerLoggerBase
  implements vscode.TaskProvider<OscBuildTask> {
  private taskDisposables: vscode.Disposable[] = [];

  constructor(
    private readonly currentPackageWatcher: CurrentPackageWatcher,
    accountManager: AccountManager,
    protected readonly logger: Logger
  ) {
    super(accountManager, logger);
  }

  public dispose(): void {
    super.dispose();
    this.taskDisposables.forEach((task) => task.dispose());
  }

  public async provideTasks(
    _token?: vscode.CancellationToken
  ): Promise<OscBuildTask[]> {
    let res: OscBuildTask[] = [];
    for (const [
      wsFolder,
      pkgs
    ] of this.currentPackageWatcher.getAllLocalPackages()) {
      const tasksOfPkgs = await Promise.all(
        pkgs.map(async (pkg) => {
          const con = this.activeAccounts.getConfig(pkg.apiUrl)?.connection;

          if (con === undefined) {
            this.logger.debug(
              "Have a local package in %s, but no account is configured for its API (%s)",
              pkg.path,
              pkg.apiUrl
            );
            return [];
          }
          const unifPkg = await readInUnifiedPackage(con, pkg.path);
          const tasks: OscBuildTask[] = [];

          unifPkg.repositories.forEach((repo) => {
            (repo.arch ?? []).forEach((arch) => {
              if (
                (typeof repo.build === "boolean" && repo.build) ||
                (repo.build instanceof Map && repo.build.get(arch))
              ) {
                tasks.push(
                  new OscBuildTask(
                    {
                      type: OSC_BUILD_TASK_TYPE,
                      repository: repo.name,
                      arch
                    },
                    pkg,
                    wsFolder
                  )
                );
              }
            });
          });
          return tasks;
        })
      );
      res = res.concat(...tasksOfPkgs);
    }
    return res;
  }

  public async resolveTask(
    _task: OscBuildTask,
    _token?: vscode.CancellationToken
  ): Promise<OscBuildTask | undefined> {
    // FIXME:
    return undefined;
  }
}
