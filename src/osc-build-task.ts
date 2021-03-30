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

import { IVSCodeExtLogger } from "@vscode-logging/logger";
import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import {
  Arch,
  ModifiedPackage,
  ProcessError,
  runProcess
} from "open-build-service-api";
import { inspect } from "util";
import * as vscode from "vscode";
import { AccountManager } from "./accounts";
import {
  ConnectionListenerLoggerBase,
  DisposableBase
} from "./base-components";
import { CurrentPackageWatcher } from "./current-package-watcher";
import {
  DEFAULT_OBS_FETCHERS,
  ObsFetchers,
  VscodeWorkspace
} from "./dependency-injection";
import { dropUndefined } from "./util";

export const OSC_BUILD_TASK_TYPE = "osc";

/**
 * Taskdefinition for a [[OscBuildTask]].
 *
 * **WARNING:** if you change anything in here, then you **must** also change
 *              the corresponding entry in `package.json`
 */
export interface OscTaskDefinition {
  readonly type: "osc";

  /** Name of the repository that will be build */
  readonly repository: string;
  /** Path to the root folder in which the package resides */
  readonly pkgPath: string;
  /**
   * Build architecture of the package.
   * in case a new architecture gets added, add it to package.json as well
   */
  readonly arch: Arch;

  /** If true or undefined, then `osc build` is run with `--clean` */
  readonly cleanBuildRoot?: boolean;

  /** Additional arguments that should be added to the osc invocation */
  readonly extraOscArgs?: string[];

  /** path to the `osc` binary */
  readonly oscBinaryPath?: string;
}

function isOscTaskDefinition(
  task: vscode.TaskDefinition
): task is OscTaskDefinition {
  if (task.type !== OSC_BUILD_TASK_TYPE) {
    return false;
  }
  const keys: (keyof OscTaskDefinition)[] = ["repository", "pkgPath", "arch"];
  for (const key of keys) {
    if (task[key] === undefined || typeof task[key] !== "string") {
      return false;
    }
  }
  return (
    (typeof task["oscBinaryPath"] === "undefined" ||
      typeof task["oscBinaryPath"] === "string") &&
    (typeof task["cleanBuildRoot"] === "undefined" ||
      typeof task["cleanBuildRoot"] === "boolean") &&
    (typeof task["extraOscArgs"] === "undefined" ||
      Array.isArray(task["extraOscArgs"]))
  );
}

// export const RPMLINT_PROBLEM_MATCHER = "rpmlint";
/*
 WIP: problemmatcher for the rpmlint output of `osc build`
 "problemMatchers": [
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

/** WIP custom terminal for logging the output of the executed process */
export class CustomExecutionTerminal
  extends DisposableBase
  implements vscode.Pseudoterminal {
  private onDidWriteEmitter = new vscode.EventEmitter<string>();

  private onDidCloseEmitter = new vscode.EventEmitter<number | undefined>();

  private child: ChildProcessWithoutNullStreams | undefined = undefined;
  public stdout: string = "";
  public stderr: string = "";

  public readonly args: readonly string[];

  public readonly onDidWrite = this.onDidWriteEmitter.event;
  public readonly onDidClose = this.onDidCloseEmitter.event;

  public open(): void {
    const child = spawn(this.command, this.args, {
      cwd: this.cwd,
      shell: true
    });
    /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
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
    child.on("close", (code) => {
      this.onDidCloseEmitter.fire(code === null ? undefined : code);
    });

    /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
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

  public dispose(): void {
    this.close();
    super.dispose();
  }
}

/** A [[Task]] that runs `osc build $repo $arch` */
export class OscBuildTask extends vscode.Task {
  public readonly definition: OscTaskDefinition;

  /** Create a new from a task definition, a workspace folder and a task name */
  constructor(
    taskDef: vscode.TaskDefinition,
    folder: vscode.WorkspaceFolder,
    taskName: string
  );
  /** Create a new task from a task definition, a workspace folder and a package */
  constructor(
    taskDef: vscode.TaskDefinition,
    folder: vscode.WorkspaceFolder,
    pkg: ModifiedPackage
  );

  constructor(
    taskDef: vscode.TaskDefinition,
    folder: vscode.WorkspaceFolder,
    pkgOrTaskName: ModifiedPackage | string
  ) {
    super(
      taskDef,
      folder,
      typeof pkgOrTaskName === "string"
        ? pkgOrTaskName
        : `Build ${pkgOrTaskName.name} for ${
            (taskDef as OscTaskDefinition).repository
          } for ${(taskDef as OscTaskDefinition).arch}`,
      "osc",
      new vscode.ProcessExecution(
        taskDef.oscBinaryPath ?? "osc",
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
        { cwd: (taskDef as OscTaskDefinition).pkgPath }
      )
    );
    if (!isOscTaskDefinition(taskDef)) {
      throw new Error(
        `Received an invalid task definition for a osc build task: ${inspect(
          taskDef
        )}`
      );
    }
    this.definition = taskDef;
    this.group = [vscode.TaskGroup.Build];
  }

  /** Creates a new task from an existing one recreating its execution. */
  public static from(
    task: vscode.Task,
    folder: vscode.WorkspaceFolder
  ): OscBuildTask | undefined {
    if (!isOscTaskDefinition(task.definition)) {
      return undefined;
    }
    return new OscBuildTask(task.definition, folder, task.name);
  }
}

/**
 * TaskProvider that provides the osc build task to vscode.
 *
 * To use this Provider, simply invoke [[createOscBuildTaskProvider]], which
 * will either resolve to a disposable that removes the task provider or to
 * undefined if no `osc` binary was found.
 */
export class OscBuildTaskProvider
  extends ConnectionListenerLoggerBase
  implements vscode.TaskProvider<OscBuildTask> {
  /**
   * Path to the osc binary.
   * This value is obtained via `which osc`
   */
  private oscPath: string | undefined;

  /**
   * Constructor replacement that creates a [[OscBuildTaskProvider]].
   *
   * @param currentPackageWatcher  The watcher for the currently active
   *     package. It is used to retrieve the list of packages in the current
   *     workspace.
   * @param accountManager  The provider of connections to the Buildservice.
   * @param logger  Extension logger for this class.
   * @param vscodeWorkspace  Dependency injection of [[vscode.workspace]]
   * @param obsFetchers Dependency injection of parts of the
   *     `open-build-service-api` module that perform remote reads & writes
   * @param runProcessFunc Function that can invoke external processes and
   *     resolves to their stdout.
   */
  public static async createOscBuildTaskProvider(
    currentPackageWatcher: CurrentPackageWatcher,
    accountManager: AccountManager,
    logger: IVSCodeExtLogger,
    vscodeWorkspace: VscodeWorkspace = vscode.workspace,
    obsFetchers: ObsFetchers = DEFAULT_OBS_FETCHERS,
    runProcessFunc: typeof runProcess = runProcess
  ): Promise<OscBuildTaskProvider | undefined> {
    const oscTaskProvider = new OscBuildTaskProvider(
      currentPackageWatcher,
      accountManager,
      logger,
      vscodeWorkspace,
      obsFetchers
    );

    try {
      const oscPath = await runProcessFunc("which", {
        args: ["osc"]
      });
      oscTaskProvider.oscPath = oscPath.replace(/\s+/g, "");
      oscTaskProvider.disposables.push(
        vscode.tasks.registerTaskProvider(OSC_BUILD_TASK_TYPE, oscTaskProvider)
      );
      return oscTaskProvider;
    } catch (err) {
      logger.error(
        "Tried to find the osc executable, but got an error instead: %s",
        (err as ProcessError).toString()
      );
      oscTaskProvider.dispose();
      return undefined;
    }
  }

  private constructor(
    private readonly currentPackageWatcher: CurrentPackageWatcher,
    accountManager: AccountManager,
    protected readonly logger: IVSCodeExtLogger,
    private readonly vscodeWorkspace: VscodeWorkspace,
    private readonly obsFetchers: ObsFetchers
  ) {
    super(accountManager, logger);
  }

  /**
   * Main function that returns possible tasks for all workspaces.
   *
   * It creates a osc build task for each repository & architecture combination
   * that has the build flag set for every package in all workspaces that are
   * currently open and returns them.
   *
   * Packages for which no account is configured are skipped.
   */
  public async provideTasks(): Promise<OscBuildTask[]> {
    if (this.oscPath === undefined) {
      this.logger.error("provideTasks called although oscPath is undefined");
      return [];
    }

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
          const unifPkg = await this.obsFetchers.readInUnifiedPackage(
            con,
            pkg.path
          );
          const tasks: OscBuildTask[] = [];

          unifPkg.repositories.forEach((repo) => {
            (repo.arch ?? []).forEach((arch) => {
              if (
                (typeof repo.build === "boolean" && repo.build) ||
                (repo.build instanceof Map && repo.build.get(arch))
              ) {
                const taskDef: OscTaskDefinition = {
                  type: OSC_BUILD_TASK_TYPE,
                  repository: repo.name,
                  arch,
                  oscBinaryPath: this.oscPath,
                  pkgPath: pkg.path
                };
                tasks.push(new OscBuildTask(taskDef, wsFolder, pkg));
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

  /**
   * Recreates the provided `task`, ensuring that it has a valid execution setup.
   *
   * @param task  A [[OscBuildTask]] without an `execution` field
   *
   * @return A [[OscBuildTask]] with `execution` set or undefined if either
   *     `task` is not a [[OscBuildTask]] or the current task's WorkspaceFolder
   *     cannot be determined.
   */
  public resolveTask(task: vscode.Task): OscBuildTask | undefined {
    if (this.oscPath === undefined) {
      this.logger.error("resolveTask called although oscPath is undefined");
      return undefined;
    }
    if (!isOscTaskDefinition(task.definition)) {
      this.logger.error(
        "resolveTask called on a task which does not have a OscTaskDefinition as its TaskDefinition, got '%s' instead",
        task.definition.type
      );
      return undefined;
    }

    if (task.execution !== undefined) {
      this.logger.debug(
        "resolveTask called on task with an already set execution"
      );
    }

    const wsFolder: vscode.WorkspaceFolder | undefined =
      task.scope !== undefined && typeof task.scope !== "number"
        ? task.scope
        : this.vscodeWorkspace.getWorkspaceFolder(
            vscode.Uri.file(task.definition.pkgPath)
          );

    return wsFolder !== undefined
      ? OscBuildTask.from(task, wsFolder)
      : undefined;
  }
}
