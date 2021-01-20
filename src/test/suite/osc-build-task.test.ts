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

import { expect } from "chai";
import { afterEach, beforeEach, Context, describe, it } from "mocha";
import { Arch, ModifiedPackage, ProcessError } from "open-build-service-api";
import { UnifiedPackage } from "open-build-service-api/lib/package";
import { RepositoryWithFlags } from "open-build-service-api/lib/repository";
import { match, createSandbox } from "sinon";
import * as vscode from "vscode";
import { CurrentPackage } from "../../current-package-watcher";
import {
  OscBuildTask,
  OscBuildTaskProvider,
  OscTaskDefinition,
  OSC_BUILD_TASK_TYPE
} from "../../osc-build-task";
import {
  AccountMapInitializer,
  createFakeWorkspaceFolder,
  FakeAccountManager,
  FakeCurrentPackageWatcher,
  FakeVscodeWorkspace
} from "./fakes";
import {
  fakeAccount1,
  fakeAccount2,
  fakeApi1ValidAcc,
  fakeApi2ValidAcc
} from "./test-data";
import {
  castToAsyncFunc,
  createStubbedObsFetchers,
  LoggingFixture,
  testLogger
} from "./test-utils";

class OscBuildTaskProviderFixture extends LoggingFixture {
  public readonly sandbox = createSandbox();

  public readonly vscodeWorkspace = new FakeVscodeWorkspace(this.sandbox);

  private oscBuildTaskProvider: OscBuildTaskProvider | undefined;

  public readonly runProcessFunc = this.sandbox.stub();
  public readonly obsFetchers = createStubbedObsFetchers(this.sandbox);
  public fakeCurrentPackageWatcher: FakeCurrentPackageWatcher | undefined;

  public async createOscBuildTaskProvider(
    initialAccountMap?: AccountMapInitializer,
    initialCurrentPackage?: CurrentPackage
  ): Promise<OscBuildTaskProvider | undefined> {
    this.fakeCurrentPackageWatcher = new FakeCurrentPackageWatcher(
      initialCurrentPackage
    );
    const accMngr = new FakeAccountManager(initialAccountMap);

    this.oscBuildTaskProvider = await OscBuildTaskProvider.createOscBuildTaskProvider(
      this.fakeCurrentPackageWatcher,
      accMngr,
      testLogger,
      this.vscodeWorkspace,
      this.obsFetchers,
      this.runProcessFunc
    );
    return this.oscBuildTaskProvider;
  }

  public afterEach(ctx: Context) {
    super.afterEach(ctx);
    this.oscBuildTaskProvider?.dispose();
    this.sandbox.restore();
  }
}

const PATH = "/path/to/a/folder";
const wsFolder = createFakeWorkspaceFolder(vscode.Uri.file(PATH));
const BASE_PKG = {
  name: "test",
  projectName: "testProjec",
  md5Hash: "asdf",
  apiUrl: fakeAccount1.apiUrl
};

const PKG: UnifiedPackage = {
  ...BASE_PKG,
  files: [],
  repositories: [],
  users: [],
  groups: [],
  projectUsers: [],
  projectGroups: []
};
const MOD_PKG: ModifiedPackage = {
  ...BASE_PKG,
  path: PATH,
  filesInWorkdir: [],
  files: []
};

const EXTRA_FLAGS = {
  useForBuild: true,
  publish: false,
  debugInfo: true
};
const POPULATED_REPOSITORIES: RepositoryWithFlags[] = [
  {
    name: "allEnabled",
    arch: [Arch.X86_64, Arch.Aarch64],
    build: true
  },
  {
    name: "allDisabled",
    arch: [Arch.X86_64, Arch.I686],
    build: false
  },
  {
    name: "someDisabled",
    arch: [Arch.S390x, Arch.Riscv64],
    build: new Map([
      [Arch.Riscv64, true],
      [Arch.S390x, false]
    ])
  },
  { name: "noArches", build: true }
].map((r) => ({ ...r, ...EXTRA_FLAGS }));

const OSC_BINARY = `/usr/bin/osc
`;

type Ctx = Context & { fixture: OscBuildTaskProviderFixture };

describe("OscBuildTaskProvider", () => {
  beforeEach(function () {
    this.fixture = new OscBuildTaskProviderFixture(this);
  });

  afterEach(function () {
    return this.fixture.afterEach(this);
  });

  describe("#createOscBuildTaskProvider", () => {
    it(
      "does not register the osc task provider if a osc binary is not found",
      castToAsyncFunc<Ctx>(async function () {
        this.fixture.runProcessFunc.rejects(
          new ProcessError("which", 1, [], [])
        );
        await this.fixture
          .createOscBuildTaskProvider()
          .should.eventually.equal(undefined);
      })
    );

    it(
      "registers the osc task provider if a osc binary is found",
      castToAsyncFunc<Ctx>(async function () {
        this.fixture.runProcessFunc.resolves("/usr/bin/osc");
        await this.fixture
          .createOscBuildTaskProvider()
          .should.eventually.have.property("provideTasks");
      })
    );
  });

  describe("#provideTasks and #resolveTasks", () => {
    type ProvCtx = Ctx & { taskProvider: OscBuildTaskProvider };

    beforeEach(async function () {
      this.fixture.runProcessFunc.resolves(OSC_BINARY);
      this.taskProvider = await (this
        .fixture as OscBuildTaskProviderFixture).createOscBuildTaskProvider([
        [fakeAccount1.apiUrl, fakeApi1ValidAcc]
      ]);
    });

    describe("#provideTasks", () => {
      it(
        "provides no tasks if the package has no repositories configured",
        castToAsyncFunc<ProvCtx>(async function () {
          this.fixture.fakeCurrentPackageWatcher!.allLocalPackages = [
            [wsFolder, [MOD_PKG]]
          ];
          this.fixture.obsFetchers.readInUnifiedPackage.resolves(PKG);

          await this.taskProvider
            .provideTasks()
            .should.eventually.deep.equal([]);
        })
      );

      it(
        "uses the correct Connection to read in the package",
        castToAsyncFunc<ProvCtx>(async function () {
          const taskProvider = await this.fixture.createOscBuildTaskProvider([
            [fakeAccount1.apiUrl, fakeApi1ValidAcc],
            [fakeAccount2.apiUrl, fakeApi2ValidAcc]
          ]);

          this.fixture.fakeCurrentPackageWatcher!.allLocalPackages = [
            [wsFolder, [MOD_PKG]]
          ];
          this.fixture.obsFetchers.readInUnifiedPackage.resolves(PKG);

          await taskProvider!.provideTasks().should.eventually.deep.equal([]);

          this.fixture.obsFetchers.readInUnifiedPackage.should.have.been.calledOnceWithExactly(
            match(fakeApi1ValidAcc.connection),
            PATH
          );
        })
      );

      it(
        "provides no tasks if there is no account configured for this package",
        castToAsyncFunc<ProvCtx>(async function () {
          const taskProvider = await this.fixture.createOscBuildTaskProvider();
          this.fixture.fakeCurrentPackageWatcher!.allLocalPackages = [
            [wsFolder, [MOD_PKG]]
          ];

          await taskProvider!.provideTasks().should.eventually.deep.equal([]);
        })
      );

      it(
        "provides a task for each repository and architecture",
        castToAsyncFunc<ProvCtx>(async function () {
          this.fixture.fakeCurrentPackageWatcher!.allLocalPackages = [
            [wsFolder, [MOD_PKG]]
          ];
          this.fixture.obsFetchers.readInUnifiedPackage.resolves({
            ...PKG,
            repositories: POPULATED_REPOSITORIES
          });

          const tasks = await this.taskProvider.provideTasks();

          expect(tasks).to.be.an("array").and.have.length(3);

          const taskDefs = tasks.map((t) => t.definition);
          testLogger.info(taskDefs);

          const commonDef = {
            oscBinaryPath: "/usr/bin/osc",
            pkgPath: PATH,
            type: OSC_BUILD_TASK_TYPE
          };

          taskDefs.should.include.a.thing.that.deep.equals({
            repository: "allEnabled",
            arch: Arch.X86_64,
            ...commonDef
          });
          taskDefs.should.include.a.thing.that.deep.equals({
            repository: "allEnabled",
            arch: Arch.Aarch64,
            ...commonDef
          });
          taskDefs.should.include.a.thing.that.deep.equals({
            repository: "someDisabled",
            arch: Arch.Riscv64,
            ...commonDef
          });
        })
      );
    });

    describe("#resolveTasks", () => {
      it(
        "creates new tasks from skeletons",
        castToAsyncFunc<ProvCtx>(async function () {
          const taskDef: OscTaskDefinition = {
            repository: POPULATED_REPOSITORIES[0].name,
            type: OSC_BUILD_TASK_TYPE,
            arch: POPULATED_REPOSITORIES[0].arch![0],
            pkgPath: PATH
          };
          this.fixture.vscodeWorkspace.getWorkspaceFolder.returns(wsFolder);
          this.fixture.obsFetchers.readInUnifiedPackage.resolves({
            ...PKG,
            repositories: POPULATED_REPOSITORIES
          });

          const task = new vscode.Task(taskDef, wsFolder, "testTask", "osc");

          const resolvedTask = this.taskProvider.resolveTask(task);
          expect(resolvedTask?.definition).to.deep.equal(taskDef);
          expect(resolvedTask?.name).to.deep.equal(task.name);
          expect(resolvedTask?.execution).to.not.equal(undefined);
        })
      );

      it(
        "does not create new tasks when the provided initial task is not a valid one",
        castToAsyncFunc<ProvCtx>(async function () {
          expect(
            this.taskProvider.resolveTask(
              new vscode.Task({ type: "not osc" }, wsFolder, "testTask", "osc")
            )
          ).to.equal(undefined);

          expect(
            OscBuildTask.from(
              new vscode.Task(
                { type: OSC_BUILD_TASK_TYPE, arch: 1 },
                wsFolder,
                "testTask2",
                "osc"
              ),
              wsFolder
            )
          ).to.equal(undefined);
        })
      );

      it(
        "reuses the WorkspaceFolder from the original task",
        castToAsyncFunc<ProvCtx>(async function () {
          const taskDef: OscTaskDefinition = {
            repository: POPULATED_REPOSITORIES[0].name,
            type: OSC_BUILD_TASK_TYPE,
            arch: POPULATED_REPOSITORIES[0].arch![0],
            pkgPath: PATH
          };
          this.fixture.obsFetchers.readInUnifiedPackage.resolves({
            ...PKG,
            repositories: POPULATED_REPOSITORIES
          });

          const task = new vscode.Task(taskDef, wsFolder, "testTask", "osc");

          const resolvedTask = this.taskProvider.resolveTask(task);
          expect(resolvedTask?.scope).to.deep.equal(wsFolder);
        })
      );

      it(
        "retrieves the WorkspaceFolder from vscode if the task has none set",
        castToAsyncFunc<ProvCtx>(async function () {
          const taskDef: OscTaskDefinition = {
            repository: POPULATED_REPOSITORIES[0].name,
            type: OSC_BUILD_TASK_TYPE,
            arch: POPULATED_REPOSITORIES[0].arch![0],
            pkgPath: PATH
          };
          this.fixture.vscodeWorkspace.getWorkspaceFolder.returns(wsFolder);
          this.fixture.obsFetchers.readInUnifiedPackage.resolves({
            ...PKG,
            repositories: POPULATED_REPOSITORIES
          });

          const task = new vscode.Task(
            taskDef,
            vscode.TaskScope.Workspace,
            "testTask",
            "osc"
          );

          const resolvedTask = this.taskProvider.resolveTask(task);
          expect(resolvedTask?.scope).to.deep.equal(wsFolder);
        })
      );

      it(
        "does not resolve a task if it cannot resolve the WorkspaceFolder",
        castToAsyncFunc<ProvCtx>(async function () {
          const taskDef: OscTaskDefinition = {
            repository: POPULATED_REPOSITORIES[0].name,
            type: OSC_BUILD_TASK_TYPE,
            arch: POPULATED_REPOSITORIES[0].arch![0],
            pkgPath: PATH
          };
          this.fixture.vscodeWorkspace.getWorkspaceFolder.returns(undefined);

          expect(
            this.taskProvider.resolveTask(
              new vscode.Task(
                taskDef,
                vscode.TaskScope.Workspace,
                "testTask",
                "osc"
              )
            )
          ).to.deep.equal(undefined);
        })
      );
    });
  });
});

describe("OscBuildTask", () => {
  it("throws an error when the Task Definition has the wrong type", () => {
    (() => new OscBuildTask({ type: "foo" }, wsFolder, MOD_PKG)).should.throw(
      Error,
      /invalid task definition/i
    );
  });

  describe("#execution", () => {
    const repositoryName = "foo";
    const arch = Arch.Riscv64;

    const taskDef = {
      type: OSC_BUILD_TASK_TYPE,
      pkgPath: PATH,
      repository: repositoryName,
      arch
    };

    it("runs 'osc build --clean $repo $arch' by default", () => {
      const repositoryName = "foo";
      const arch = Arch.Riscv64;
      const task = new OscBuildTask(taskDef, wsFolder, MOD_PKG);

      expect(task.execution).to.not.equal(undefined);
      expect(task.execution)
        .to.have.property("process")
        .that.deep.equals("osc");
      expect(task.execution)
        .to.have.property("args")
        .that.deep.equals(["build", "--clean", repositoryName, arch]);
      expect(task.execution)
        .to.have.property("options")
        .that.deep.includes({ cwd: PATH });
    });

    it("runs 'osc build $repo $arch' when cleanBuildRoot is false", () => {
      const task = new OscBuildTask(
        { ...taskDef, cleanBuildRoot: false },
        wsFolder,
        MOD_PKG
      );

      expect(task.execution).to.not.equal(undefined);
      expect(task.execution)
        .to.have.property("process")
        .that.deep.equals("osc");
      expect(task.execution)
        .to.have.property("args")
        .that.deep.equals(["build", repositoryName, arch]);
      expect(task.execution)
        .to.have.property("options")
        .that.deep.includes({ cwd: PATH });
    });

    it("appends extra arguments passed via extraOscArgs", () => {
      const task = new OscBuildTask(
        { ...taskDef, extraOscArgs: ["--download-api-only"] },
        wsFolder,
        MOD_PKG
      );

      expect(task.execution)
        .to.have.property("args")
        .that.deep.equals([
          "build",
          "--clean",
          repositoryName,
          arch,
          "--download-api-only"
        ]);
    });

    it("supports non-default paths for the osc binary", () => {
      const task = new OscBuildTask(
        { ...taskDef, oscBinaryPath: "/opt/osc" },
        wsFolder,
        MOD_PKG
      );

      expect(task.execution)
        .to.have.property("process")
        .that.deep.equals("/opt/osc");
    });
  });
});
