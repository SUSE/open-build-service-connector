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
import * as keytar from "keytar";
import { afterEach, beforeEach, describe, it } from "mocha";
import * as obs from "obs-ts";
import { createSandbox, match, SinonSandbox } from "sinon";
import { ImportMock } from "ts-mock-imports";
import * as vscode from "vscode";
import {
  AccountManager,
  AccountStorage,
  ApiAccountMapping,
  configurationAccounts,
  configurationCheckUnimportedAccounts,
  configurationExtensionName
} from "../../accounts";
import { fakeAccount1, fakeAccount2 } from "./test-data";
import {
  createStubbedVscodeWindow,
  executeAndWaitForEvent,
  logger,
  waitForEvent
} from "./test-utils";

async function addFakeAcountsToConfig(
  accounts: AccountStorage[]
): Promise<void> {
  await vscode.workspace
    .getConfiguration(configurationExtensionName)
    .update(configurationAccounts, accounts, vscode.ConfigurationTarget.Global);
}

function extractApiAccountMapFromSpy(
  onConnectionChangeSpy: sinon.SinonSpy,
  call: number = 0
): ApiAccountMapping {
  return onConnectionChangeSpy.getCall(call).args[0] as ApiAccountMapping;
}

class FakeAccountFixture {
  public sandbox: SinonSandbox;
  constructor(public readonly fakeAccounts: AccountStorage[]) {
    this.sandbox = createSandbox();
  }

  public async beforeEach(context: Mocha.Context) {
    await addFakeAcountsToConfig(this.fakeAccounts);

    context.sandbox = this.sandbox;

    context.curConEventSpy = this.sandbox.spy();

    context.vscodeWindow = createStubbedVscodeWindow(this.sandbox);

    context.mngr = new AccountManager(logger, context.vscodeWindow);
    context.mngr.onConnectionChange(context.curConEventSpy);
  }

  public afterEach(context: Mocha.Context) {
    context.mngr.dispose();

    this.sandbox.restore();
  }
}

describe("AccountManager", function() {
  this.timeout(5000);

  beforeEach(function() {
    this.keytarGetPasswordMock = ImportMock.mockFunction(keytar, "getPassword");
    this.keytarSetPasswordMock = ImportMock.mockFunction(keytar, "setPassword");
    this.keytarDeletePasswordMock = ImportMock.mockFunction(
      keytar,
      "deletePassword"
    );
    this.readAccountsFromOscrcMock = ImportMock.mockFunction(
      obs,
      "readAccountsFromOscrc"
    );

    this.accountSettingsBackup = vscode.workspace
      .getConfiguration(configurationExtensionName)
      .get<AccountStorage[]>(configurationAccounts, []);
  });

  afterEach(async function() {
    this.keytarGetPasswordMock.restore();
    this.keytarSetPasswordMock.restore();
    this.keytarDeletePasswordMock.restore();
    this.readAccountsFromOscrcMock.restore();

    await vscode.workspace
      .getConfiguration(configurationExtensionName)
      .update(
        configurationAccounts,
        this.accountSettingsBackup,
        vscode.ConfigurationTarget.Global
      );
  });

  describe("No accounts present", () => {
    const fixture = new FakeAccountFixture([]);

    beforeEach(async function() {
      await fixture.beforeEach(this);
    });

    afterEach(function() {
      fixture.afterEach(this);
    });

    it("AccountManager has no connections", async function() {
      await this.mngr.initializeMapping().should.be.fulfilled;

      this.sandbox.assert.calledOnce(this.curConEventSpy);

      expect(extractApiAccountMapFromSpy(this.curConEventSpy)).to.deep.equal({
        defaultApi: undefined,
        mapping: new Map()
      });
    });

    it("fires the onConnectionChange Event when adding accounts", async function() {
      await this.mngr.initializeMapping().should.be.fulfilled;
      this.sandbox.assert.calledOnce(this.curConEventSpy);

      await executeAndWaitForEvent(
        () => addFakeAcountsToConfig([fakeAccount2]),
        this.mngr.onConnectionChange
      );

      this.sandbox.assert.calledTwice(this.curConEventSpy);
    });
  });

  describe("#configurationChangeListener", () => {
    const fixture = new FakeAccountFixture([fakeAccount1, fakeAccount2]);

    beforeEach(async function() {
      await fixture.beforeEach(this);
      await this.mngr.initializeMapping();
      this.curConEventSpy.resetHistory();

      this.vscodeWindow.showErrorMessage.resolves();
    });

    afterEach(function() {
      fixture.afterEach(this);
    });

    const runRejectionTest = async (
      ctx: Mocha.Context,
      faultyAccounts: AccountStorage[]
    ) => {
      // change the configuration to something invalid => fires the
      // onDidChangeConfiguration event, our listener intercepts that and rolls
      // the config back, firing the event again
      await executeAndWaitForEvent(
        () => addFakeAcountsToConfig(faultyAccounts),
        vscode.workspace.onDidChangeConfiguration
      );

      await waitForEvent(vscode.workspace.onDidChangeConfiguration);

      ctx.sandbox.assert.calledOnce(ctx.vscodeWindow.showErrorMessage);
      ctx.sandbox.assert.notCalled(ctx.curConEventSpy);
    };

    it("rejects invalid urls", async function() {
      await runRejectionTest(this, [
        { accountName: "foo", username: "bar", apiUrl: "" }
      ]);

      expect(this.vscodeWindow.showErrorMessage.getCall(0).args[0])
        .to.be.a("string")
        .and.to.match(/invalid url/i);
    });

    it("rejects empty usernames", async function() {
      await runRejectionTest(this, [
        {
          accountName: "foo",
          apiUrl: "https://api.opensuse.org",
          username: ""
        }
      ]);

      expect(this.vscodeWindow.showErrorMessage.getCall(0).args[0])
        .to.be.a("string")
        .and.to.match(/username.*empty/i);
    });

    it("rejects two default accounts", async function() {
      await runRejectionTest(this, [
        {
          accountName: "foo",
          apiUrl: "https://api.opensuse.org",
          isDefault: true,
          username: "foo"
        },
        {
          accountName: "bar",
          apiUrl: "https://api.opensuse.org",
          isDefault: true,
          username: "baz"
        }
      ]);

      expect(this.vscodeWindow.showErrorMessage.getCall(0).args[0])
        .to.be.a("string")
        .and.to.match(/more than one default account/i);
    });
  });

  describe("import Accounts From ~/.config/osc/osrc", () => {
    const fixture = new FakeAccountFixture([fakeAccount1, fakeAccount2]);

    const setCheckForUnimportedAccounts = async (
      setting: boolean
    ): Promise<void> =>
      // executeAndWaitForEvent(
      //  async () =>
      vscode.workspace
        .getConfiguration(configurationExtensionName)
        .update(
          configurationCheckUnimportedAccounts,
          setting,
          vscode.ConfigurationTarget.Global
        ); //,
    //vscode.workspace.onDidChangeConfiguration
    //);

    beforeEach(async function() {
      await fixture.beforeEach(this);
      this.unimportedAccountsSetting = vscode.workspace
        .getConfiguration(configurationExtensionName)
        .get(configurationCheckUnimportedAccounts);
    });

    afterEach(async function() {
      fixture.afterEach(this);
      await vscode.workspace
        .getConfiguration(configurationExtensionName)
        .update(
          configurationCheckUnimportedAccounts,
          this.unimportedAccountsSetting,
          vscode.ConfigurationTarget.Global
        );
    });

    describe("#importAccountsFromOsrc", () => {
      it("imports an account with a set password", async function() {
        let apiUrl = "https://api.bar.org";
        const password = "barrr";
        const fakeNewOscrcAccount = {
          aliases: [],
          apiUrl,
          password,
          username: "barUser"
        };
        // ensure that everything that follows uses the normalized url
        apiUrl = obs.normalizeUrl(apiUrl);

        this.keytarGetPasswordMock.resolves(password);
        this.readAccountsFromOscrcMock.resolves([fakeNewOscrcAccount]);

        await this.mngr.initializeMapping().should.be.fulfilled;
        this.curConEventSpy.resetHistory();

        await executeAndWaitForEvent(
          async () => this.mngr.importAccountsFromOsrc(),
          this.mngr.onConnectionChange
        );

        this.sandbox.assert.calledWith(
          this.keytarSetPasswordMock.firstCall,
          match.string,
          apiUrl,
          password
        );
        this.sandbox.assert.calledWithMatch(
          this.keytarGetPasswordMock,
          match.string,
          apiUrl
        );

        this.sandbox.assert.calledOnce(this.curConEventSpy);
        expect(extractApiAccountMapFromSpy(this.curConEventSpy))
          .to.have.property("mapping")
          .that.is.a("Map");

        // the event listener will get the current apiUrl to account map
        const curCons = extractApiAccountMapFromSpy(this.curConEventSpy);
        expect([...curCons.mapping.keys()])
          .to.have.length(3)
          .and.include(apiUrl);

        // the map should contain a mapping for our apiUrl and the Connection
        // should have a set value
        let instanceInfo = curCons.mapping.get(apiUrl);
        expect(instanceInfo).to.not.be.undefined;
        instanceInfo = instanceInfo!;

        expect(instanceInfo.account).to.deep.equal({
          accountName: apiUrl,
          apiUrl,
          username: "barUser"
        });

        let con = instanceInfo.connection;
        expect(con).to.not.be.undefined;

        con = con!;
        expect(con).to.deep.include({
          password,
          url: apiUrl
        });
      });

      it("imports an account without a set password", async function() {
        const fakeOscrcAccount = {
          aliases: [],
          apiUrl: "https://api.bar.org",
          username: "barUser"
        };

        this.readAccountsFromOscrcMock.resolves([fakeOscrcAccount]);

        await this.mngr.initializeMapping().should.be.fulfilled;
        this.curConEventSpy.resetHistory();

        await executeAndWaitForEvent(
          () => this.mngr.importAccountsFromOsrc(),
          this.mngr.onConnectionChange
        );

        this.sandbox.assert.notCalled(this.keytarSetPasswordMock);

        this.sandbox.assert.calledOnce(this.curConEventSpy);
        const curCons = extractApiAccountMapFromSpy(this.curConEventSpy);

        const apiUrl = obs.normalizeUrl(fakeOscrcAccount.apiUrl);

        expect([...curCons.mapping.keys()])
          .to.have.length(3)
          .and.to.contain(apiUrl);
        // Connection object should be undefined, as it doesn't know the password
        expect(curCons.mapping.get(apiUrl)!.connection).to.be.undefined;
      });

      it("doesn't import a present account", async function() {
        this.readAccountsFromOscrcMock.resolves([fakeAccount1]);

        await this.mngr.initializeMapping().should.be.fulfilled;
        this.curConEventSpy.resetHistory();

        await this.mngr.importAccountsFromOsrc();

        this.sandbox.assert.notCalled(this.curConEventSpy);
      });
    });

    describe("#promptForUninmportedAccount", () => {
      const apiUrl = "https://api.bar.org";
      const newPassword = "barrr";
      const fakeNewOscrcAccount = {
        aliases: [],
        apiUrl,
        password: newPassword,
        username: "barUser"
      };

      beforeEach(async function() {
        await setCheckForUnimportedAccounts(true);

        await this.mngr.initializeMapping();
        this.sandbox.assert.notCalled(this.readAccountsFromOscrcMock);
        this.curConEventSpy.resetHistory();
      });

      it("does nothing when the user does not wish to be prompted for uninmported accounts", async function() {
        await setCheckForUnimportedAccounts(false);

        await this.mngr.promptForUninmportedAccount().should.be.fulfilled;

        this.sandbox.assert.notCalled(this.vscodeWindow.showInformationMessage);
      });

      it("checks for uninmported accounts, but does not prompt the user if none are to be imported", async function() {
        this.readAccountsFromOscrcMock.resolves([fakeAccount1]);

        await this.mngr.promptForUninmportedAccount().should.be.fulfilled;

        this.sandbox.assert.notCalled(this.vscodeWindow.showInformationMessage);
        this.sandbox.assert.calledOnce(this.readAccountsFromOscrcMock);
      });

      it("does nothing if the user let's the prompt time out", async function() {
        this.readAccountsFromOscrcMock.resolves([fakeNewOscrcAccount]);
        this.vscodeWindow.showInformationMessage.resolves();

        await this.mngr.promptForUninmportedAccount().should.be.fulfilled;

        this.sandbox.assert.calledOnce(
          this.vscodeWindow.showInformationMessage
        );
        this.sandbox.assert.calledWith(
          this.vscodeWindow.showInformationMessage,
          match("not been imported into Visual Studio Code"),
          "Import accounts now",
          "Never show this message again"
        );
        this.sandbox.assert.calledOnce(this.readAccountsFromOscrcMock);
        this.sandbox.assert.notCalled(this.keytarSetPasswordMock);
      });

      it("writes the config if the user never wants to get bothered again", async function() {
        this.readAccountsFromOscrcMock.resolves([fakeNewOscrcAccount]);
        this.vscodeWindow.showInformationMessage.resolves(
          "Never show this message again"
        );

        await this.mngr.promptForUninmportedAccount().should.be.fulfilled;

        this.sandbox.assert.calledOnce(
          this.vscodeWindow.showInformationMessage
        );

        this.sandbox.assert.calledOnce(this.readAccountsFromOscrcMock);
        this.sandbox.assert.notCalled(this.keytarSetPasswordMock);

        expect(
          vscode.workspace
            .getConfiguration(configurationExtensionName)
            .get(configurationCheckUnimportedAccounts)
        ).to.be.false;
      });

      it("actually imports the account if the user wants to", async function() {
        this.readAccountsFromOscrcMock.resolves([fakeNewOscrcAccount]);
        this.vscodeWindow.showInformationMessage.resolves(
          "Import accounts now"
        );

        await this.mngr.promptForUninmportedAccount().should.be.fulfilled;

        this.sandbox.assert.calledOnce(
          this.vscodeWindow.showInformationMessage
        );

        this.sandbox.assert.calledOnce(this.readAccountsFromOscrcMock);
        this.sandbox.assert.calledOnce(this.keytarSetPasswordMock);
        this.sandbox.assert.calledWith(
          this.keytarSetPasswordMock.firstCall,
          match.string,
          obs.normalizeUrl(apiUrl),
          newPassword
        );

        expect(
          vscode.workspace
            .getConfiguration(configurationExtensionName)
            .get(configurationCheckUnimportedAccounts)
        ).to.be.true;
      });
    });
  });

  describe("#removeAccountPassword", () => {
    const fixture = new FakeAccountFixture([fakeAccount1, fakeAccount2]);

    beforeEach(async function() {
      await fixture.beforeEach(this);
      await this.mngr.initializeMapping();
    });

    afterEach(function() {
      fixture.afterEach(this);
    });

    it("removes a present password", async function() {
      // removal succeeds
      this.keytarDeletePasswordMock.resolves(true);

      await this.mngr.removeAccountPassword(fakeAccount1.apiUrl).should.be
        .fulfilled;

      this.sandbox.assert.calledWith(
        this.keytarDeletePasswordMock.firstCall,
        match.string,
        fakeAccount1.apiUrl
      );
    });

    it("reports an error when password removal fails", async function() {
      // pw removal fails
      this.keytarDeletePasswordMock.resolves(false);

      await this.mngr.removeAccountPassword(fakeAccount1.apiUrl).should.be
        .rejected;
    });

    it("does nothing when the apiUrl does not exist", async function() {
      await this.mngr.removeAccountPassword("https://bla.xyz").should.be
        .fulfilled;

      this.sandbox.assert.notCalled(this.keytarDeletePasswordMock);
    });
  });

  describe("#initializeMapping", () => {
    const fixture = new FakeAccountFixture([fakeAccount1]);

    beforeEach(async function() {
      await fixture.beforeEach(this);
      this.keytarGetPasswordMock.resolves("fooPw");
    });

    afterEach(function() {
      fixture.afterEach(this);
    });

    it("does nothing when called a second time", async function() {
      await this.mngr.initializeMapping().should.be.fulfilled;
      this.sandbox.assert.calledOnce(this.curConEventSpy);

      this.curConEventSpy.resetHistory();

      await this.mngr.initializeMapping().should.be.fulfilled;
      this.sandbox.assert.notCalled(this.curConEventSpy);
    });

    it("populates the Connetions and fires the event", async function() {
      await this.mngr.initializeMapping().should.be.fulfilled;

      // password was retrieved?
      this.sandbox.assert.calledOnce(this.keytarGetPasswordMock);

      expect(this.keytarGetPasswordMock.getCall(0).args[1]).to.eql(
        fakeAccount1.apiUrl
      );

      // did the EventEmitter fire?
      this.sandbox.assert.calledOnce(this.curConEventSpy);
      expect(this.curConEventSpy.getCall(0).args).to.have.length(1);
      const curCons = extractApiAccountMapFromSpy(this.curConEventSpy);

      expect(curCons)
        .to.have.property("mapping")
        .that.is.a("Map");
      const mappings = [...curCons.mapping.values()];

      expect(mappings).to.have.length(1);
      // AccountStorage
      expect(mappings[0].account).to.deep.equal({ ...fakeAccount1 });
      // Connection is not undefined
      expect(mappings[0].connection).to.have.property(
        "url",
        fakeAccount1.apiUrl
      );
    });

    it("sets the default connection when only one account is present", async function() {
      await this.mngr.initializeMapping().should.be.fulfilled;

      // did the EventEmitter fire?
      this.sandbox.assert.calledOnce(this.curConEventSpy);
      const curCons = extractApiAccountMapFromSpy(this.curConEventSpy);

      expect(curCons)
        .to.have.property("defaultApi")
        .that.equals(obs.normalizeUrl(fakeAccount1.apiUrl));
    });
  });

  describe("#dispose", () => {
    const fixture = new FakeAccountFixture([fakeAccount1, fakeAccount2]);

    beforeEach(async function() {
      await fixture.beforeEach(this);
      this.keytarGetPasswordMock.resolves("barPw");

      // the configurationChangeListener will try to remove the passwords of the
      // two present accounts
      this.keytarDeletePasswordMock.resolves(true);
    });

    afterEach(function() {
      fixture.afterEach(this);
    });

    it("stops the onConnectionChangeEmitter", async function() {
      await this.mngr.initializeMapping();

      this.sandbox.assert.calledOnce(this.curConEventSpy);
      this.curConEventSpy.resetHistory();

      await executeAndWaitForEvent(
        () => addFakeAcountsToConfig([]),
        this.mngr.onConnectionChange
      );

      this.sandbox.assert.calledOnce(this.curConEventSpy);

      this.mngr.dispose();

      this.curConEventSpy.resetHistory();
      await addFakeAcountsToConfig([fakeAccount1]);
      this.sandbox.assert.notCalled(this.curConEventSpy);
    });
  });

  describe("accounts without a password", () => {
    const fixture = new FakeAccountFixture([fakeAccount1, fakeAccount2]);

    beforeEach(async function() {
      await fixture.beforeEach(this);

      await this.mngr.initializeMapping();
      this.keytarGetPasswordMock.resetHistory();

      // this.keytarGetPasswordMock.onCall(0).resolves("foo");
      // this.keytarGetPasswordMock.onCall(1).resolves(null);
    });

    afterEach(function() {
      fixture.afterEach(this);
    });

    describe("#findAccountsWithoutPassword", () => {
      it("finds the account with no password in the keyring", async function() {
        this.keytarGetPasswordMock.onCall(0).resolves("foo");
        this.keytarGetPasswordMock.onCall(1).resolves(null);

        await this.mngr
          .findAccountsWithoutPassword()
          .should.be.fulfilled.and.eventually.deep.equal([fakeAccount2]);

        this.sandbox.assert.calledTwice(this.keytarGetPasswordMock);
      });
    });

    describe("#promptForNotPresentAccountPasswords", () => {
      it("doesn't prompt the user when all accounts have a password", async function() {
        this.keytarGetPasswordMock.resolves("foo");

        await this.mngr.promptForNotPresentAccountPasswords().should.be
          .fulfilled;

        this.sandbox.assert.notCalled(this.vscodeWindow.showInformationMessage);
      });

      it("does nothing when the prompt times out", async function() {
        this.keytarGetPasswordMock.resolves(null);

        this.vscodeWindow.showInformationMessage.resolves(undefined);

        await this.mngr.promptForNotPresentAccountPasswords().should.be
          .fulfilled;

        this.sandbox.assert.calledWith(
          this.vscodeWindow.showInformationMessage.firstCall,
          "The following accounts have no password set: foo, bar. Would you like to set them now?",
          "Yes",
          "No"
        );

        this.sandbox.assert.notCalled(this.vscodeWindow.showInputBox);
      });

      it("does nothing when the user selects no", async function() {
        this.keytarGetPasswordMock.resolves(null);

        this.vscodeWindow.showInformationMessage.resolves("No");

        await this.mngr.promptForNotPresentAccountPasswords().should.be
          .fulfilled;

        this.sandbox.assert.calledOnce(
          this.vscodeWindow.showInformationMessage
        );

        this.sandbox.assert.notCalled(this.vscodeWindow.showInputBox);
      });

      it("prompts the user for a single password and writes it to the keytar", async function() {
        this.keytarGetPasswordMock.onCall(0).resolves("foo");
        this.keytarGetPasswordMock.onCall(1).resolves(null);

        const newPassword = "blaBla";
        this.vscodeWindow.showInformationMessage.resolves("Yes");
        this.vscodeWindow.showInputBox.resolves(newPassword);

        await this.mngr.promptForNotPresentAccountPasswords().should.be
          .fulfilled;
        this.sandbox.assert.calledWith(
          this.vscodeWindow.showInformationMessage.firstCall,
          "The following account has no password set: bar. Would you like to set it now?",
          "Yes",
          "No"
        );

        this.sandbox.assert.calledOnce(this.vscodeWindow.showInputBox);
        expect(
          this.vscodeWindow.showInputBox.getCall(0).args[0]
        ).to.deep.include({
          password: true,
          prompt: "add a password for the account ".concat(fakeAccount2.apiUrl)
        });

        this.sandbox.assert.calledOnce(this.keytarSetPasswordMock);
        this.sandbox.assert.calledWith(
          this.keytarSetPasswordMock.firstCall,
          match.string,
          fakeAccount2.apiUrl,
          newPassword
        );
      });

      it("prompts the user for a single password and doesn't put it into the keytar if the user cancels", async function() {
        this.keytarGetPasswordMock.onCall(0).resolves("foo");
        this.keytarGetPasswordMock.onCall(1).resolves(null);

        this.vscodeWindow.showInformationMessage.resolves("Yes");
        this.vscodeWindow.showInputBox.resolves(undefined);

        await this.mngr.promptForNotPresentAccountPasswords().should.be
          .fulfilled;

        this.sandbox.assert.notCalled(this.keytarSetPasswordMock);
      });
    });

    describe("#interactivelySetAccountPassword", () => {
      it("presents a QuickPick if no apiUrl is passed as an argument and sets the account password", async function() {
        const toChangeApi = fakeAccount1.apiUrl;
        const newPw = "dtruiae";
        this.curConEventSpy.resetHistory();

        this.vscodeWindow.showQuickPick.resolves(fakeAccount1.accountName);
        this.vscodeWindow.showInputBox.resolves(newPw);

        await this.mngr.interactivelySetAccountPassword().should.be.fulfilled;

        this.sandbox.assert.calledOnce(this.vscodeWindow.showQuickPick);
        this.sandbox.assert.calledWith(
          this.vscodeWindow.showQuickPick.firstCall,
          [fakeAccount1.accountName, fakeAccount2.accountName]
        );

        this.sandbox.assert.calledOnce(this.keytarSetPasswordMock);
        this.sandbox.assert.calledWith(
          this.keytarSetPasswordMock.firstCall,
          match.string,
          toChangeApi,
          newPw
        );

        this.sandbox.assert.calledOnce(this.curConEventSpy);
        const curCon = extractApiAccountMapFromSpy(this.curConEventSpy);
        const instanceInfo = curCon.mapping.get(toChangeApi);

        expect(instanceInfo).to.not.be.undefined;
        expect(instanceInfo!.account).to.deep.equal(fakeAccount1);
        expect(instanceInfo!.connection).to.deep.include({
          password: newPw,
          url: toChangeApi
        });
      });

      it("doesn't set the password if the user cancels the QuickPick", async function() {
        this.curConEventSpy.resetHistory();

        this.vscodeWindow.showQuickPick.resolves(undefined);

        await this.mngr.interactivelySetAccountPassword().should.be.fulfilled;

        this.sandbox.assert.calledOnce(this.vscodeWindow.showQuickPick);
        this.sandbox.assert.calledWith(
          this.vscodeWindow.showQuickPick.firstCall,
          [fakeAccount1.accountName, fakeAccount2.accountName]
        );

        this.sandbox.assert.notCalled(this.keytarSetPasswordMock);
        this.sandbox.assert.notCalled(this.curConEventSpy);
      });
    });
  });
});
