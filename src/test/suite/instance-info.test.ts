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
import * as openBuildServiceApi from "open-build-service-api";
import { createSandbox, match } from "sinon";
import { URL } from "url";
import * as vscode from "vscode";
import {
  GET_INSTANCE_INFO_COMMAND,
  ObsServerInformation,
  UPDATE_INSTANCE_INFO_COMMAND
} from "../../instance-info";
import { AccountMapInitializer, FakeAccountManager } from "./fakes";
import {
  fakeAccount1,
  fakeAccount2,
  fakeApi1ValidAcc,
  fakeApi2ValidAcc
} from "./test-data";
import {
  castToAsyncFunc,
  createStubbedVscodeWindow,
  LoggingFixture,
  sleep,
  testLogger
} from "./test-utils";

class ObsServerInformationFixture extends LoggingFixture {
  public readonly sandbox = createSandbox();

  public readonly vscodeWindow = createStubbedVscodeWindow(this.sandbox);

  public fetchConfigurationMock = this.sandbox.stub();
  public fetchHostedDistributionsMock = this.sandbox.stub();
  public fetchProjectListMock = this.sandbox.stub();

  public fakeAccountManager?: FakeAccountManager;

  public disposables: vscode.Disposable[] = [];

  public afterEach(ctx: Context) {
    this.sandbox.restore();

    this.disposables.forEach((disposable) => disposable.dispose());
    this.disposables = [];

    super.afterEach(ctx);
  }

  public async createObsServerInformation(
    initialAccountMap?: AccountMapInitializer
  ): Promise<ObsServerInformation> {
    this.fakeAccountManager = new FakeAccountManager(initialAccountMap);

    const serverInfo = new ObsServerInformation(
      this.fakeAccountManager,
      testLogger,
      {
        fetchConfiguration: this.fetchConfigurationMock,
        fetchHostedDistributions: this.fetchHostedDistributionsMock,
        fetchProjectList: this.fetchProjectListMock
      }
    );

    await serverInfo.initialInstanceInfoRetrieved;

    this.disposables.push(serverInfo);

    return serverInfo;
  }
}

type FixtureContext = Context & { fixture: ObsServerInformationFixture };

describe("ObsServerInformation", () => {
  beforeEach(function () {
    this.fixture = new ObsServerInformationFixture(this);
  });

  afterEach(function () {
    this.fixture.afterEach(this);
  });

  describe("#createObsServerInformation", () => {
    it(
      "does not fetch anything if no accounts are present",
      castToAsyncFunc<FixtureContext>(async function () {
        await this.fixture.createObsServerInformation();

        this.fixture.sandbox.assert.notCalled(
          this.fixture.fetchConfigurationMock
        );
        this.fixture.sandbox.assert.notCalled(
          this.fixture.fetchHostedDistributionsMock
        );
      })
    );

    it(
      "registers the update & get instance info commands",
      castToAsyncFunc<FixtureContext>(async function () {
        await this.fixture.createObsServerInformation();

        await vscode.commands
          .executeCommand(GET_INSTANCE_INFO_COMMAND)
          .should.eventually.equal(undefined);

        await vscode.commands.executeCommand(UPDATE_INSTANCE_INFO_COMMAND);
      })
    );

    it(
      "de-registers the update & get instance info commands after being disposed",
      castToAsyncFunc<FixtureContext>(async function () {
        const serverInfo = await this.fixture.createObsServerInformation();

        serverInfo.dispose();

        await vscode.commands
          .executeCommand(GET_INSTANCE_INFO_COMMAND)
          .should.be.rejectedWith(/command.*not found/i);

        await vscode.commands
          .executeCommand(UPDATE_INSTANCE_INFO_COMMAND)
          .should.be.rejectedWith(/command.*not found/i);
      })
    );
  });

  describe("#getInfo", () => {
    const ObsConfig: openBuildServiceApi.Configuration = {
      description:
        "The openSUSE Build Service is the public instance of the Open Build Service (OBS)",
      disableBranchPublishing: true,
      schedulers: [
        openBuildServiceApi.Arch.X86_64,
        openBuildServiceApi.Arch.Aarch64
      ],
      title: "openSUSE Build Service"
    };

    const FooInstanceConfig: openBuildServiceApi.Configuration = {
      description: "This is just a test instance",
      disableBranchPublishing: true,
      schedulers: [],
      title: "Test"
    };

    const Tumbleweed: openBuildServiceApi.Distribution = {
      link: new URL("http://www.opensuse.org/"),
      name: "openSUSE Tumbleweed",
      project: "openSUSE:Factory",
      repository: "snapshot",
      repositoryName: "openSUSE_Tumbleweed",
      vendor: "openSUSE",
      version: "Tumbleweed"
    };

    const projectList = ["openSUSE:Factory", "openSUSE", "home:fooUser"];

    const barInstanceInfo = {
      apiUrl: fakeAccount2.apiUrl,
      hostedDistributions: [Tumbleweed],
      supportedArchitectures: ObsConfig.schedulers,
      projectList
    };

    beforeEach(function () {
      this.fixture.fetchConfigurationMock
        .withArgs(match.has("url", fakeAccount2.apiUrl))
        .resolves(ObsConfig);
      this.fixture.fetchConfigurationMock
        .withArgs(match.has("url", fakeAccount1.apiUrl))
        .resolves(FooInstanceConfig);
      this.fixture.fetchConfigurationMock.rejects(
        Error("Cannot fetch the configuration for this API")
      );

      this.fixture.fetchHostedDistributionsMock.resolves([Tumbleweed]);

      this.fixture.fetchProjectListMock.resolves(
        projectList.map((name) => ({ name }))
      );
    });

    it(
      "returns the server infos about known instances",
      castToAsyncFunc<FixtureContext>(async function () {
        const serverInfo = await this.fixture.createObsServerInformation([
          [fakeAccount1.apiUrl, fakeApi1ValidAcc],
          [fakeAccount2.apiUrl, fakeApi2ValidAcc]
        ]);

        serverInfo.getInfo(fakeAccount1.apiUrl)!.should.deep.equal({
          apiUrl: fakeAccount1.apiUrl,
          hostedDistributions: [Tumbleweed],
          supportedArchitectures: [],
          projectList
        });

        expect(serverInfo.getInfo("https://api.opensuse.org/")).to.equal(
          undefined
        );

        expect(serverInfo.getInfo(fakeAccount2.apiUrl)).to.deep.equal(
          barInstanceInfo
        );

        [
          fakeAccount1.apiUrl,
          fakeAccount2.apiUrl,
          "https://api.opensuse.org/"
        ].forEach(async (apiUrl) => {
          await vscode.commands
            .executeCommand(GET_INSTANCE_INFO_COMMAND, apiUrl)
            .should.eventually.deep.equal(serverInfo.getInfo(apiUrl));
        });
      })
    );

    it(
      "updates the server info on account changes",
      castToAsyncFunc<FixtureContext>(async function () {
        await this.fixture.createObsServerInformation([
          [fakeAccount1.apiUrl, fakeApi1ValidAcc]
        ]);

        await this.fixture.fakeAccountManager!.activeAccounts.addAccount(
          fakeApi2ValidAcc
        );

        // HACK: the fetching of the infos is asynchronous and events are not,
        // so we need to manually delay here
        await sleep(500);

        await vscode.commands
          .executeCommand(GET_INSTANCE_INFO_COMMAND, fakeAccount2.apiUrl)
          .should.eventually.deep.equal(barInstanceInfo);
      })
    );

    it(
      "handles exceptions being thrown by the fetch functions",
      castToAsyncFunc<FixtureContext>(async function () {
        const thirdAccount = {
          accountName: "OBS",
          apiUrl: "https://api.opensuse.org/",
          username: "meee"
        };
        const thirdCon = new openBuildServiceApi.Connection(
          thirdAccount.username,
          "secure",
          { url: thirdAccount.apiUrl }
        );

        const serverInfo = await this.fixture.createObsServerInformation([
          [fakeAccount1.apiUrl, fakeApi1ValidAcc],
          [thirdAccount.apiUrl, { account: thirdAccount, connection: thirdCon }]
        ]);

        this.fixture.sandbox.assert.calledTwice(
          this.fixture.fetchConfigurationMock
        );
        this.fixture.sandbox.assert.calledTwice(
          this.fixture.fetchHostedDistributionsMock
        );

        expect(serverInfo.getInfo(thirdAccount.apiUrl)).to.deep.equal({
          apiUrl: thirdAccount.apiUrl,
          hostedDistributions: [Tumbleweed],
          supportedArchitectures: undefined,
          projectList
        });
      })
    );
  });
});
