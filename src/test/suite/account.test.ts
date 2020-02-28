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
import { promises as fsPromises } from "fs";
import * as keytar from "keytar";
import { afterEach, beforeEach, describe, it } from "mocha";
import * as obs from "obs-ts";
import { createSandbox, match, SinonSandbox, SinonStub } from "sinon";
import { ImportMock } from "ts-mock-imports";
import * as vscode from "vscode";
import {
  AccountManager,
  AccountStorage,
  configurationAccounts,
  configurationCheckUnimportedAccounts,
  configurationExtensionName
} from "../../accounts";
import { fakeAccount1, fakeAccount2 } from "./test-data";
import {
  castToAsyncFunc,
  createStubbedVscodeWindow,
  executeAndWaitForEvent,
  LoggingFixture,
  testLogger
} from "./test-utils";

const newFakeAccount1: AccountStorage = {
  accountName: fakeAccount1.accountName,
  apiUrl: fakeAccount1.apiUrl,
  username: "newFoo"
};

async function addFakeAcountsToConfig(
  accounts: AccountStorage[]
): Promise<void> {
  await vscode.workspace
    .getConfiguration(configurationExtensionName)
    .update(configurationAccounts, accounts, vscode.ConfigurationTarget.Global);
}

interface FixtureContext extends Mocha.Context {
  fixture: AccountManagerFixture;
}

class AccountManagerFixture extends LoggingFixture {
  public readonly sandbox: SinonSandbox = createSandbox();

  public readonly keytarGetPasswordMock = ImportMock.mockFunction(
    keytar,
    "getPassword"
  );
  public readonly keytarSetPasswordMock = ImportMock.mockFunction(
    keytar,
    "setPassword"
  );
  public readonly keytarDeletePasswordMock = ImportMock.mockFunction(
    keytar,
    "deletePassword"
  );
  public readonly readAccountsFromOscrcMock = ImportMock.mockFunction(
    obs,
    "readAccountsFromOscrc"
  );

  public readonly vscodeWindow = createStubbedVscodeWindow(this.sandbox);

  public readonly accountChangeSpy = this.sandbox.spy();

  public disposables: vscode.Disposable[] = [];

  private readonly accountSettingsBackup: AccountStorage[];

  constructor(context: Mocha.Context) {
    super();
    super.beforeEach(context);

    this.accountSettingsBackup = vscode.workspace
      .getConfiguration(configurationExtensionName)
      .get<AccountStorage[]>(configurationAccounts, []);
  }

  public async createAccountManager(
    fakeAccounts: AccountStorage[] = [],
    returnedPasswords: Array<string | null> = []
  ): Promise<AccountManager> {
    await addFakeAcountsToConfig(fakeAccounts);

    returnedPasswords.forEach((pw, index) =>
      this.keytarGetPasswordMock.onCall(index).resolves(pw)
    );

    const mngr = await AccountManager.createAccountManager(
      testLogger,
      this.vscodeWindow
    );
    mngr.onAccountChange(this.accountChangeSpy);

    this.disposables.push(mngr);

    return mngr;
  }

  public async afterEach(context: FixtureContext) {
    this.disposables.forEach(disp => disp.dispose());
    this.disposables = [];

    this.keytarGetPasswordMock.restore();
    this.keytarSetPasswordMock.restore();
    this.keytarDeletePasswordMock.restore();
    this.readAccountsFromOscrcMock.restore();

    this.sandbox.restore();

    await vscode.workspace
      .getConfiguration(configurationExtensionName)
      .update(
        configurationAccounts,
        this.accountSettingsBackup,
        vscode.ConfigurationTarget.Global
      );
    super.afterEach(context);
  }
}

describe("AccountManager", function() {
  this.timeout(5000);

  beforeEach(async function() {
    this.fixture = new AccountManagerFixture(this);
  });

  afterEach(async function() {
    await this.fixture.afterEach(this);
  });

  describe("#createAccountManager", () => {
    it(
      "AccountManager has no accounts by default",
      castToAsyncFunc<FixtureContext>(async function() {
        const mngr = await this.fixture.createAccountManager([]);
        expect(mngr.activeAccounts.getAllApis())
          .to.be.an("array")
          .and.have.length(0);
      })
    );

    it(
      "populates the activeAccounts property",
      castToAsyncFunc<FixtureContext>(async function() {
        const mngr = await this.fixture.createAccountManager(
          [fakeAccount1],
          ["fooPw"]
        );

        // password was retrieved?
        this.fixture.sandbox.assert.calledOnce(
          this.fixture.keytarGetPasswordMock
        );
        this.fixture.sandbox.assert.calledWithMatch(
          this.fixture.keytarGetPasswordMock,
          match.string,
          fakeAccount1.apiUrl
        );

        // the event shouldn't be fired, as we only created the object and nothing
        // could have subscribed to the event anyway
        this.fixture.sandbox.assert.notCalled(this.fixture.accountChangeSpy);

        const validAccount = mngr.activeAccounts.getConfig(fakeAccount1.apiUrl);
        expect(validAccount)
          .to.have.property("account")
          .that.deep.equals(fakeAccount1);
        expect(validAccount)
          .to.have.property("connection")
          .that.deep.includes({ url: fakeAccount1.apiUrl });
      })
    );

    it(
      "reports configuration issues to the user",
      castToAsyncFunc<FixtureContext>(async function() {
        this.fixture.vscodeWindow.showErrorMessage.resolves();

        const mngr = await this.fixture.createAccountManager([
          { apiUrl: "", username: "foo", accountName: "foo" },
          { apiUrl: fakeAccount2.apiUrl, username: "", accountName: "bar" }
        ]);

        this.fixture.sandbox.assert.calledOnce(
          this.fixture.vscodeWindow.showErrorMessage
        );
        const callArgs = this.fixture.vscodeWindow.showErrorMessage.getCall(0)
          .args;
        expect(callArgs[0]).to.be.a("string");
        expect(callArgs).to.not.include.a.thing.that.deep.includes({
          modal: true
        });

        expect(callArgs[0])
          .and.to.include(
            "Got the following errors when loading your configuration: "
          )
          .and.to.match(/invalid\s+url/i)
          .and.to.match(/empty username.*bar/i)
          .and.not.to.match(/(ERR_INVALID_URL|TypeError)/);

        this.fixture.sandbox.assert.notCalled(this.fixture.accountChangeSpy);
        expect(mngr.activeAccounts.getAllApis()).to.have.length(0);
      })
    );
  });

  describe("#configurationChangeListener", () => {
    beforeEach(async function() {
      this.fixture.vscodeWindow.showErrorMessage.resolves();
    });

    const runRejectionTest = async (
      ctx: FixtureContext,
      mngr: AccountManager,
      faultyAccounts: AccountStorage[]
    ) => {
      // change the configuration to something invalid
      // => fires the onDidChangeConfiguration event, our listener intercepts
      // that and tells the user that they screwed up
      //
      await executeAndWaitForEvent(
        async () => addFakeAcountsToConfig(faultyAccounts),
        mngr.onAccountChange
      );

      ctx.fixture.sandbox.assert.calledOnce(
        ctx.fixture.vscodeWindow.showErrorMessage
      );
    };

    it(
      "rejects invalid urls",
      castToAsyncFunc<FixtureContext>(async function(this: FixtureContext) {
        const mngr = await this.fixture.createAccountManager(
          [fakeAccount1, fakeAccount2],
          ["a", "b"]
        );

        await runRejectionTest(this, mngr, [
          { accountName: "foo", username: "bar", apiUrl: "" }
        ]);

        this.fixture.sandbox.assert.calledWithMatch(
          this.fixture.vscodeWindow.showErrorMessage,
          match(/invalid.*url/i)
        );
      })
    );

    it(
      "rejects empty usernames",
      castToAsyncFunc<FixtureContext>(async function() {
        const mngr = await this.fixture.createAccountManager(
          [fakeAccount1, fakeAccount2],
          ["a", "b"]
        );
        await runRejectionTest(this, mngr, [
          {
            accountName: "foo",
            apiUrl: "https://api.opensuse.org",
            username: ""
          }
        ]);

        this.fixture.sandbox.assert.calledWithMatch(
          this.fixture.vscodeWindow.showErrorMessage,
          match(/empty.*username.*foo/i)
        );
      })
    );

    it(
      "removes accounts that are dropped from the config",
      castToAsyncFunc<FixtureContext>(async function() {
        const mngr = await this.fixture.createAccountManager(
          [fakeAccount1, fakeAccount2],
          ["a", "b"]
        );

        await executeAndWaitForEvent(
          async () => addFakeAcountsToConfig([fakeAccount1]),
          mngr.onAccountChange
        );

        expect(mngr.activeAccounts.getAllApis()).to.deep.equal([
          fakeAccount1.apiUrl
        ]);
        expect(
          mngr.activeAccounts.getConfig(fakeAccount1.apiUrl)
        ).to.deep.include({ account: fakeAccount1 });
      })
    );

    it(
      "reflects changes in the username in stored accounts",
      castToAsyncFunc<FixtureContext>(async function() {
        const mngr = await this.fixture.createAccountManager(
          [fakeAccount1, fakeAccount2],
          ["a", "b"]
        );

        await executeAndWaitForEvent(
          async () => addFakeAcountsToConfig([newFakeAccount1, fakeAccount2]),
          mngr.onAccountChange
        );

        expect(mngr.activeAccounts.getAllApis())
          .to.be.an("array")
          .and.have.length(2);
        expect(mngr.activeAccounts.getAllApis())
          .to.contain(fakeAccount1.apiUrl)
          .and.to.contain(fakeAccount2.apiUrl);
        expect(
          mngr.activeAccounts.getConfig(fakeAccount1.apiUrl)
        ).to.deep.include({ account: newFakeAccount1 });
        expect(
          mngr.activeAccounts.getConfig(fakeAccount1.apiUrl)?.connection
        ).to.deep.include({
          url: newFakeAccount1.apiUrl,
          username: newFakeAccount1.username
        });
      })
    );

    it(
      "prompts the user to provide a password for a newly added account",
      castToAsyncFunc<FixtureContext>(async function() {
        const mngr = await this.fixture.createAccountManager([]);

        const pw = "aFakePassword";
        this.fixture.vscodeWindow.showInputBox.resolves(pw);

        await executeAndWaitForEvent(
          async () => addFakeAcountsToConfig([fakeAccount1]),
          mngr.onAccountChange
        );

        this.fixture.sandbox.assert.calledOnce(this.fixture.accountChangeSpy);
        this.fixture.sandbox.assert.calledWith(this.fixture.accountChangeSpy, [
          fakeAccount1.apiUrl
        ]);
        expect(
          mngr.activeAccounts.getConfig(fakeAccount1.apiUrl)!.connection
        ).to.deep.include({
          password: pw,
          url: fakeAccount1.apiUrl,
          username: fakeAccount1.username
        });
      })
    );

    it(
      "does not add an account if the user does not provide a password",
      castToAsyncFunc<FixtureContext>(async function() {
        const mngr = await this.fixture.createAccountManager(
          [fakeAccount1],
          ["foo"]
        );

        this.fixture.vscodeWindow.showInputBox.resolves(undefined);

        await executeAndWaitForEvent(
          async () => addFakeAcountsToConfig([newFakeAccount1, fakeAccount2]),
          mngr.onAccountChange
        );

        this.fixture.sandbox.assert.calledOnce(this.fixture.accountChangeSpy);

        expect(mngr.activeAccounts.getAllApis()).to.deep.equal([
          newFakeAccount1.apiUrl
        ]);
      })
    );
  });

  describe("import Accounts From ~/.config/osc/osrc", () => {
    const setCheckForUnimportedAccounts = async (
      setting: boolean
    ): Promise<void> =>
      vscode.workspace
        .getConfiguration(configurationExtensionName)
        .update(
          configurationCheckUnimportedAccounts,
          setting,
          vscode.ConfigurationTarget.Global
        );

    beforeEach(async function() {
      this.unimportedAccountsSetting = vscode.workspace
        .getConfiguration(configurationExtensionName)
        .get(configurationCheckUnimportedAccounts);
    });

    afterEach(async function() {
      await vscode.workspace
        .getConfiguration(configurationExtensionName)
        .update(
          configurationCheckUnimportedAccounts,
          this.unimportedAccountsSetting,
          vscode.ConfigurationTarget.Global
        );
    });

    describe("#importAccountsFromOscrc", () => {
      it(
        "imports an account with a set password",
        castToAsyncFunc<FixtureContext>(async function() {
          const mngr = await this.fixture.createAccountManager([
            fakeAccount1,
            fakeAccount2
          ]);

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

          this.fixture.readAccountsFromOscrcMock.resolves([
            fakeNewOscrcAccount
          ]);

          this.fixture.keytarGetPasswordMock.resetHistory();

          await executeAndWaitForEvent(
            async () => mngr.importAccountsFromOsrc(),
            mngr.onAccountChange
          );

          this.fixture.sandbox.assert.calledOnce(
            this.fixture.keytarSetPasswordMock
          );
          this.fixture.sandbox.assert.calledWith(
            this.fixture.keytarSetPasswordMock.firstCall,
            match.string,
            apiUrl,
            password
          );
          // we shouldn't need to get the password from the keyring as it is
          // obtained via the oscrc config file
          this.fixture.sandbox.assert.notCalled(
            this.fixture.keytarGetPasswordMock
          );

          this.fixture.sandbox.assert.calledOnce(this.fixture.accountChangeSpy);

          // the event listener will get the current apiUrl to account map
          expect(mngr.activeAccounts.getAllApis())
            .to.have.length(3)
            .and.include(apiUrl);

          // the map should contain a mapping for our apiUrl and the Connection
          // should have a set value
          let activeAccount = mngr.activeAccounts.getConfig(apiUrl);
          expect(activeAccount).to.not.be.undefined;
          activeAccount = activeAccount!;

          expect(activeAccount.account).to.deep.equal({
            accountName: apiUrl,
            apiUrl,
            username: "barUser"
          });

          let con = activeAccount.connection;
          expect(con).to.not.be.undefined;

          con = con!;
          expect(con).to.deep.include({
            password,
            url: apiUrl
          });
        })
      );

      it(
        "imports an account without a set password and asks the user to provide it",
        castToAsyncFunc<FixtureContext>(async function(this: FixtureContext) {
          const mngr = await this.fixture.createAccountManager([
            fakeAccount1,
            fakeAccount2
          ]);
          const fakeOscrcAccount: obs.Account = {
            aliases: [],
            apiUrl: "https://api.bar.org",
            password: undefined,
            username: "barUser"
          };

          const password = "SuperSecure!!";
          this.fixture.readAccountsFromOscrcMock.resolves([fakeOscrcAccount]);
          this.fixture.vscodeWindow.showInputBox.resolves(password);

          await executeAndWaitForEvent(
            () => mngr.importAccountsFromOsrc(),
            mngr.onAccountChange
          );

          this.fixture.sandbox.assert.calledOnce(
            this.fixture.keytarSetPasswordMock
          );

          this.fixture.sandbox.assert.calledOnce(this.fixture.accountChangeSpy);

          const apiUrl = obs.normalizeUrl(fakeOscrcAccount.apiUrl);

          expect(mngr.activeAccounts.getAllApis())
            .to.have.length(3)
            .and.to.contain(apiUrl);

          expect(
            mngr.activeAccounts.getConfig(apiUrl)!.connection
          ).to.deep.include({ password });
          expect(
            mngr.activeAccounts.getConfig(apiUrl)!.account
          ).to.deep.include({
            accountName: apiUrl,
            apiUrl,
            username: fakeOscrcAccount.username
          });
        })
      );

      it(
        "doesn't import an account if the user does not provide a password",
        castToAsyncFunc<FixtureContext>(async function(this: FixtureContext) {
          const mngr = await this.fixture.createAccountManager();
          const fakeOscrcAccount: obs.Account = {
            aliases: [],
            apiUrl: "https://api.bar.org",
            password: undefined,
            username: "barUser"
          };

          this.fixture.readAccountsFromOscrcMock.resolves([fakeOscrcAccount]);
          this.fixture.vscodeWindow.showInputBox.resolves(undefined);

          await mngr.importAccountsFromOsrc().should.be.fulfilled;

          this.fixture.sandbox.assert.notCalled(
            this.fixture.keytarSetPasswordMock
          );
          this.fixture.sandbox.assert.notCalled(this.fixture.accountChangeSpy);

          expect(mngr.activeAccounts.getAllApis()).to.deep.equal([]);
        })
      );

      it(
        "doesn't import a present account",
        castToAsyncFunc<FixtureContext>(async function() {
          const mngr = await this.fixture.createAccountManager([fakeAccount1]);

          this.fixture.readAccountsFromOscrcMock.resolves([
            { ...fakeAccount1, aliases: [] }
          ]);

          await mngr.importAccountsFromOsrc().should.be.fulfilled;

          this.fixture.sandbox.assert.notCalled(this.fixture.accountChangeSpy);
        })
      );
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

        this.fixture.sandbox.assert.notCalled(
          this.fixture.readAccountsFromOscrcMock
        );
      });

      it(
        "does nothing when the user does not wish to be prompted for uninmported accounts",
        castToAsyncFunc<FixtureContext>(async function() {
          const mngr = await this.fixture.createAccountManager();

          await setCheckForUnimportedAccounts(false);

          await mngr.promptForUninmportedAccountsInOscrc().should.be.fulfilled;

          this.fixture.sandbox.assert.notCalled(
            this.fixture.vscodeWindow.showInformationMessage
          );
        })
      );

      it(
        "checks for uninmported accounts, but does not prompt the user if none are to be imported",
        castToAsyncFunc<FixtureContext>(async function() {
          const mngr = await this.fixture.createAccountManager([fakeAccount1]);
          this.fixture.readAccountsFromOscrcMock.resolves([fakeAccount1]);

          await mngr.promptForUninmportedAccountsInOscrc().should.be.fulfilled;

          this.fixture.sandbox.assert.notCalled(
            this.fixture.vscodeWindow.showInformationMessage
          );
          this.fixture.sandbox.assert.calledOnce(
            this.fixture.readAccountsFromOscrcMock
          );
        })
      );

      it(
        "does nothing if the user let's the prompt time out",
        castToAsyncFunc<FixtureContext>(async function() {
          const mngr = await this.fixture.createAccountManager();

          this.fixture.readAccountsFromOscrcMock.resolves([
            fakeNewOscrcAccount
          ]);
          this.fixture.vscodeWindow.showInformationMessage.resolves();

          await mngr.promptForUninmportedAccountsInOscrc().should.be.fulfilled;

          this.fixture.sandbox.assert.calledOnce(
            this.fixture.vscodeWindow.showInformationMessage
          );
          this.fixture.sandbox.assert.calledWith(
            this.fixture.vscodeWindow.showInformationMessage,
            match("not been imported into Visual Studio Code"),
            "Import accounts now",
            "Not now",
            "Never show this message again"
          );
          this.fixture.sandbox.assert.calledOnce(
            this.fixture.readAccountsFromOscrcMock
          );
          this.fixture.sandbox.assert.notCalled(
            this.fixture.keytarSetPasswordMock
          );
        })
      );

      it(
        "writes the config if the user never wants to get bothered again",
        castToAsyncFunc<FixtureContext>(async function() {
          const mngr = await this.fixture.createAccountManager();

          this.fixture.readAccountsFromOscrcMock.resolves([
            fakeNewOscrcAccount
          ]);
          this.fixture.vscodeWindow.showInformationMessage.resolves(
            "Never show this message again"
          );

          await mngr.promptForUninmportedAccountsInOscrc().should.be.fulfilled;

          this.fixture.sandbox.assert.calledOnce(
            this.fixture.vscodeWindow.showInformationMessage
          );

          this.fixture.sandbox.assert.calledOnce(
            this.fixture.readAccountsFromOscrcMock
          );
          this.fixture.sandbox.assert.notCalled(
            this.fixture.keytarSetPasswordMock
          );

          expect(
            vscode.workspace
              .getConfiguration(configurationExtensionName)
              .get(configurationCheckUnimportedAccounts)
          ).to.be.false;
        })
      );

      it(
        "does nothing when the user selects 'Not now'",
        castToAsyncFunc<FixtureContext>(async function() {
          const mngr = await this.fixture.createAccountManager();

          this.fixture.readAccountsFromOscrcMock.resolves([
            fakeNewOscrcAccount
          ]);
          this.fixture.vscodeWindow.showInformationMessage.resolves("Not now");

          await mngr.promptForUninmportedAccountsInOscrc().should.be.fulfilled;

          this.fixture.sandbox.assert.calledOnce(
            this.fixture.vscodeWindow.showInformationMessage
          );

          this.fixture.sandbox.assert.calledOnce(
            this.fixture.readAccountsFromOscrcMock
          );
          this.fixture.sandbox.assert.notCalled(
            this.fixture.keytarSetPasswordMock
          );

          // config didn't get modified
          expect(
            vscode.workspace
              .getConfiguration(configurationExtensionName)
              .get(configurationCheckUnimportedAccounts)
          ).to.be.true;
        })
      );

      it(
        "actually imports the account if the user wants to",
        castToAsyncFunc<FixtureContext>(async function() {
          const mngr = await this.fixture.createAccountManager();
          this.fixture.readAccountsFromOscrcMock.resolves([
            fakeNewOscrcAccount
          ]);
          this.fixture.vscodeWindow.showInformationMessage.resolves(
            "Import accounts now"
          );

          await mngr.promptForUninmportedAccountsInOscrc().should.be.fulfilled;

          this.fixture.sandbox.assert.calledOnce(
            this.fixture.vscodeWindow.showInformationMessage
          );

          this.fixture.sandbox.assert.calledOnce(
            this.fixture.readAccountsFromOscrcMock
          );
          this.fixture.sandbox.assert.calledOnce(
            this.fixture.keytarSetPasswordMock
          );
          this.fixture.sandbox.assert.calledWith(
            this.fixture.keytarSetPasswordMock.firstCall,
            match.string,
            obs.normalizeUrl(apiUrl),
            newPassword
          );

          expect(
            vscode.workspace
              .getConfiguration(configurationExtensionName)
              .get(configurationCheckUnimportedAccounts)
          ).to.be.true;
        })
      );
    });
  });

  describe("#removeAccountInteractive", () => {
    it(
      "removes a present password",
      castToAsyncFunc<FixtureContext>(async function(this: FixtureContext) {
        const mngr = await this.fixture.createAccountManager(
          [fakeAccount1, fakeAccount2],
          ["secure", "lessSecure"]
        );
        // removal succeeds
        this.fixture.keytarDeletePasswordMock.resolves(true);
        this.fixture.vscodeWindow.showQuickPick.resolves(
          fakeAccount1.accountName
        );
        this.fixture.vscodeWindow.showInformationMessage.resolves("Yes");

        await mngr.removeAccountInteractive().should.be.fulfilled;

        this.fixture.sandbox.assert.calledOnce(
          this.fixture.keytarDeletePasswordMock
        );
        this.fixture.sandbox.assert.calledWith(
          this.fixture.keytarDeletePasswordMock.firstCall,
          match.string,
          fakeAccount1.apiUrl
        );
      })
    );

    it(
      "removes an account even if the password removal fails",
      castToAsyncFunc<FixtureContext>(async function() {
        const mngr = await this.fixture.createAccountManager(
          [fakeAccount1, fakeAccount2],
          ["secure", "lessSecure"]
        );
        // pw removal fails
        this.fixture.keytarDeletePasswordMock.resolves(false);
        this.fixture.vscodeWindow.showQuickPick.resolves(
          fakeAccount1.accountName
        );
        this.fixture.vscodeWindow.showInformationMessage.resolves("Yes");

        await mngr.removeAccountInteractive().should.be.fulfilled;
      })
    );

    it(
      "does nothing when the user cancels the request for the account to be removed",
      castToAsyncFunc<FixtureContext>(async function() {
        const mngr = await this.fixture.createAccountManager(
          [fakeAccount1, fakeAccount2],
          ["secure", "lessSecure"]
        );
        this.fixture.vscodeWindow.showQuickPick.resolves(undefined);

        await mngr.removeAccountInteractive().should.be.fulfilled;

        this.fixture.sandbox.assert.notCalled(
          this.fixture.keytarDeletePasswordMock
        );
      })
    );

    it(
      "does nothing when the user cancels the confirmation for the account removal",
      castToAsyncFunc<FixtureContext>(async function() {
        const mngr = await this.fixture.createAccountManager(
          [fakeAccount1, fakeAccount2],
          ["secure", "lessSecure"]
        );

        this.fixture.vscodeWindow.showQuickPick.resolves(
          fakeAccount1.accountName
        );
        this.fixture.vscodeWindow.showInformationMessage.resolves(undefined);

        await mngr.removeAccountInteractive().should.be.fulfilled;

        this.fixture.sandbox.assert.notCalled(
          this.fixture.keytarDeletePasswordMock
        );
      })
    );

    it(
      "does nothing when the user declines the account removal",
      castToAsyncFunc<FixtureContext>(async function() {
        const mngr = await this.fixture.createAccountManager(
          [fakeAccount1, fakeAccount2],
          ["secure", "lessSecure"]
        );

        this.fixture.vscodeWindow.showQuickPick.resolves(
          fakeAccount1.accountName
        );
        this.fixture.vscodeWindow.showInformationMessage.resolves("No");

        await mngr.removeAccountInteractive().should.be.fulfilled;

        this.fixture.sandbox.assert.notCalled(
          this.fixture.keytarDeletePasswordMock
        );
      })
    );
  });

  describe("#dispose", () => {
    it(
      "stops the onConnectionChangeEmitter",
      castToAsyncFunc<FixtureContext>(async function() {
        const mngr = await this.fixture.createAccountManager(
          [fakeAccount1, fakeAccount2],
          ["barPw"]
        );
        await executeAndWaitForEvent(
          async () => addFakeAcountsToConfig([]),
          mngr.onAccountChange
        );

        this.fixture.sandbox.assert.calledOnce(this.fixture.accountChangeSpy);

        mngr.dispose();

        this.fixture.accountChangeSpy.resetHistory();
        await addFakeAcountsToConfig([fakeAccount1]);
        this.fixture.sandbox.assert.notCalled(this.fixture.accountChangeSpy);
      })
    );
  });

  describe("#promptForNotPresentAccountPasswords", () => {
    it(
      "doesn't prompt the user when all accounts have a password",
      castToAsyncFunc<FixtureContext>(async function() {
        const mngr = await this.fixture.createAccountManager(
          [fakeAccount1, fakeAccount2],
          ["pw", "fooPw"]
        );

        expect(mngr.activeAccounts.getAllApis())
          .to.be.an("array")
          .and.have.length(2);

        await mngr.promptForNotPresentAccountPasswords().should.be.fulfilled;

        this.fixture.sandbox.assert.notCalled(
          this.fixture.vscodeWindow.showInformationMessage
        );
      })
    );

    it(
      "does nothing when the prompt times out",
      castToAsyncFunc<FixtureContext>(async function() {
        const mngr = await this.fixture.createAccountManager(
          [fakeAccount1, fakeAccount2],
          [null, "fooPw"]
        );

        this.fixture.vscodeWindow.showInformationMessage.resolves(undefined);

        await mngr.promptForNotPresentAccountPasswords().should.be.fulfilled;

        this.fixture.sandbox.assert.calledOnce(
          this.fixture.vscodeWindow.showInformationMessage
        );
        this.fixture.sandbox.assert.calledWith(
          this.fixture.vscodeWindow.showInformationMessage.firstCall,
          "The following account has no password set: foo. Would you like to set it now?",
          "Yes",
          "No"
        );

        this.fixture.sandbox.assert.notCalled(
          this.fixture.vscodeWindow.showInputBox
        );
      })
    );

    it(
      "does nothing when the user selects no",
      castToAsyncFunc<FixtureContext>(async function() {
        const mngr = await this.fixture.createAccountManager(
          [fakeAccount1, fakeAccount2],
          [null, "fooPw"]
        );

        this.fixture.vscodeWindow.showInformationMessage.resolves("No");

        await mngr.promptForNotPresentAccountPasswords().should.be.fulfilled;

        this.fixture.sandbox.assert.calledOnce(
          this.fixture.vscodeWindow.showInformationMessage
        );

        this.fixture.sandbox.assert.notCalled(
          this.fixture.vscodeWindow.showInputBox
        );
      })
    );

    it(
      "prompts the user for a single password and writes it to the keytar",
      castToAsyncFunc<FixtureContext>(async function() {
        const mngr = await this.fixture.createAccountManager(
          [fakeAccount1, fakeAccount2],
          [null, "fooPw"]
        );

        const newPassword = "blaBla";
        this.fixture.vscodeWindow.showInformationMessage.resolves("Yes");
        this.fixture.vscodeWindow.showInputBox.resolves(newPassword);

        await mngr.promptForNotPresentAccountPasswords().should.be.fulfilled;
        this.fixture.sandbox.assert.calledWith(
          this.fixture.vscodeWindow.showInformationMessage.firstCall,
          "The following account has no password set: foo. Would you like to set it now?",
          "Yes",
          "No"
        );

        this.fixture.sandbox.assert.calledOnce(
          this.fixture.vscodeWindow.showInputBox
        );
        expect(
          this.fixture.vscodeWindow.showInputBox.getCall(0).args[0]
        ).to.deep.include({
          password: true,
          prompt: "set the password for the account ".concat(
            fakeAccount1.apiUrl
          )
        });

        this.fixture.sandbox.assert.calledOnce(
          this.fixture.keytarSetPasswordMock
        );
        this.fixture.sandbox.assert.calledWith(
          this.fixture.keytarSetPasswordMock.firstCall,
          match.string,
          fakeAccount1.apiUrl,
          newPassword
        );
      })
    );

    it(
      "prompts the user for a single password and doesn't put it into the keytar if the user cancels",
      castToAsyncFunc<FixtureContext>(async function() {
        const mngr = await this.fixture.createAccountManager(
          [fakeAccount1, fakeAccount2],
          [null, "fooPw"]
        );

        this.fixture.vscodeWindow.showInformationMessage.resolves("Yes");
        this.fixture.vscodeWindow.showInputBox.resolves(undefined);

        await mngr.promptForNotPresentAccountPasswords().should.be.fulfilled;

        this.fixture.sandbox.assert.notCalled(
          this.fixture.keytarSetPasswordMock
        );
      })
    );
  });

  describe("#setAccountPasswordInteractive", () => {
    it(
      "does not set a password if the apiUrl is invalid",
      castToAsyncFunc<FixtureContext>(async function() {
        const mngr = await this.fixture.createAccountManager(
          [fakeAccount1],
          ["secure"]
        );

        await mngr.setAccountPasswordInteractive(
          "I'm not a url"
        ).should.be.fulfilled;

        this.fixture.sandbox.assert.notCalled(
          this.fixture.keytarSetPasswordMock
        );
        this.fixture.sandbox.assert.notCalled(this.fixture.accountChangeSpy);
      })
    );

    it(
      "presents a QuickPick if no apiUrl is passed as an argument and sets the account password",
      castToAsyncFunc<FixtureContext>(async function() {
        const mngr = await this.fixture.createAccountManager(
          [fakeAccount1, fakeAccount2],
          ["secure", "sooooSecure"]
        );

        const toChangeApi = fakeAccount1.apiUrl;
        const newPw = "dtruiae";

        this.fixture.vscodeWindow.showQuickPick.resolves(
          fakeAccount1.accountName
        );
        this.fixture.vscodeWindow.showInputBox.resolves(newPw);

        expect(mngr.activeAccounts.getAllApis()).to.have.length(2);

        await mngr.setAccountPasswordInteractive().should.be.fulfilled;

        this.fixture.sandbox.assert.calledOnce(
          this.fixture.vscodeWindow.showQuickPick
        );
        this.fixture.sandbox.assert.calledWithMatch(
          this.fixture.vscodeWindow.showQuickPick.firstCall,
          [fakeAccount1.accountName, fakeAccount2.accountName]
        );

        this.fixture.sandbox.assert.calledOnce(
          this.fixture.keytarSetPasswordMock
        );
        this.fixture.sandbox.assert.calledWith(
          this.fixture.keytarSetPasswordMock.firstCall,
          match.string,
          toChangeApi,
          newPw
        );

        this.fixture.sandbox.assert.calledOnce(this.fixture.accountChangeSpy);

        const activeAccount = mngr.activeAccounts.getConfig(toChangeApi);

        expect(activeAccount).to.not.be.undefined;
        expect(activeAccount!.account).to.deep.equal(fakeAccount1);
        expect(activeAccount!.connection).to.deep.include({
          password: newPw,
          url: toChangeApi
        });
      })
    );

    it(
      "presents no QuickPick if no apiUrl is passed and only one account exists",
      castToAsyncFunc<FixtureContext>(async function() {
        const mngr = await this.fixture.createAccountManager(
          [fakeAccount1],
          ["secure"]
        );

        const toChangeApi = fakeAccount1.apiUrl;
        const newPw = "dtruiae";

        this.fixture.vscodeWindow.showInputBox.resolves(newPw);

        expect(mngr.activeAccounts.getAllApis()).to.have.length(1);

        await mngr.setAccountPasswordInteractive().should.be.fulfilled;

        this.fixture.sandbox.assert.calledOnce(
          this.fixture.keytarSetPasswordMock
        );
        this.fixture.sandbox.assert.calledWith(
          this.fixture.keytarSetPasswordMock.firstCall,
          match.string,
          toChangeApi,
          newPw
        );

        this.fixture.sandbox.assert.calledOnce(this.fixture.accountChangeSpy);
      })
    );

    it(
      "doesn't set the password if the user cancels the QuickPick",
      castToAsyncFunc<FixtureContext>(async function() {
        const mngr = await this.fixture.createAccountManager(
          [fakeAccount1, fakeAccount2],
          ["secure", "sooooSecure"]
        );

        this.fixture.vscodeWindow.showQuickPick.resolves(undefined);

        await mngr.setAccountPasswordInteractive().should.be.fulfilled;

        this.fixture.sandbox.assert.calledOnce(
          this.fixture.vscodeWindow.showQuickPick
        );
        this.fixture.sandbox.assert.calledWith(
          this.fixture.vscodeWindow.showQuickPick.firstCall,
          [fakeAccount1.accountName, fakeAccount2.accountName]
        );

        this.fixture.sandbox.assert.notCalled(
          this.fixture.keytarSetPasswordMock
        );
        this.fixture.sandbox.assert.notCalled(this.fixture.accountChangeSpy);
      })
    );

    it(
      "doesn't set the password if the user cancels the password prompt",
      castToAsyncFunc<FixtureContext>(async function() {
        const mngr = await this.fixture.createAccountManager(
          [fakeAccount1],
          ["secure"]
        );

        this.fixture.vscodeWindow.showInputBox.resolves(undefined);

        await mngr.setAccountPasswordInteractive().should.be.fulfilled;

        this.fixture.sandbox.assert.notCalled(
          this.fixture.keytarSetPasswordMock
        );
        this.fixture.sandbox.assert.notCalled(this.fixture.accountChangeSpy);
      })
    );
  });

  describe("#newAccountWizzard", () => {
    const caCertRootCertificate = `-----BEGIN CERTIFICATE-----
MIIG7jCCBNagAwIBAgIBDzANBgkqhkiG9w0BAQsFADB5MRAwDgYDVQQKEwdSb290
IENBMR4wHAYDVQQLExVodHRwOi8vd3d3LmNhY2VydC5vcmcxIjAgBgNVBAMTGUNB
IENlcnQgU2lnbmluZyBBdXRob3JpdHkxITAfBgkqhkiG9w0BCQEWEnN1cHBvcnRA
Y2FjZXJ0Lm9yZzAeFw0wMzAzMzAxMjI5NDlaFw0zMzAzMjkxMjI5NDlaMHkxEDAO
BgNVBAoTB1Jvb3QgQ0ExHjAcBgNVBAsTFWh0dHA6Ly93d3cuY2FjZXJ0Lm9yZzEi
MCAGA1UEAxMZQ0EgQ2VydCBTaWduaW5nIEF1dGhvcml0eTEhMB8GCSqGSIb3DQEJ
ARYSc3VwcG9ydEBjYWNlcnQub3JnMIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIIC
CgKCAgEAziLA4kZ97DYoB1CW8qAzQIxL8TtmPzHlawI229Z89vGIj053NgVBlfkJ
8BLPRoZzYLdufujAWGSuzbCtRRcMY/pnCujW0r8+55jE8Ez64AO7NV1sId6eINm6
zWYyN3L69wj1x81YyY7nDl7qPv4coRQKFWyGhFtkZip6qUtTefWIonvuLwphK42y
fk1WpRPs6tqSnqxEQR5YYGUFZvjARL3LlPdCfgv3ZWiYUQXw8wWRBB0bF4LsyFe7
w2t6iPGwcswlWyCR7BYCEo8y6RcYSNDHBS4CMEK4JZwFaz+qOqfrU0j36NK2B5jc
G8Y0f3/JHIJ6BVgrCFvzOKKrF11myZjXnhCLotLddJr3cQxyYN/Nb5gznZY0dj4k
epKwDpUeb+agRThHqtdB7Uq3EvbXG4OKDy7YCbZZ16oE/9KTfWgu3YtLq1i6L43q
laegw1SJpfvbi1EinbLDvhG+LJGGi5Z4rSDTii8aP8bQUWWHIbEZAWV/RRyH9XzQ
QUxPKZgh/TMfdQwEUfoZd9vUFBzugcMd9Zi3aQaRIt0AUMyBMawSB3s42mhb5ivU
fslfrejrckzzAeVLIL+aplfKkQABi6F1ITe1Yw1nPkZPcCBnzsXWWdsC4PDSy826
YreQQejdIOQpvGQpQsgi3Hia/0PsmBsJUUtaWsJx8cTLc6nloQsCAwEAAaOCAX8w
ggF7MB0GA1UdDgQWBBQWtTIb1Mfz4OaO873SsDrusjkY0TAPBgNVHRMBAf8EBTAD
AQH/MDQGCWCGSAGG+EIBCAQnFiVodHRwOi8vd3d3LmNhY2VydC5vcmcvaW5kZXgu
cGhwP2lkPTEwMFYGCWCGSAGG+EIBDQRJFkdUbyBnZXQgeW91ciBvd24gY2VydGlm
aWNhdGUgZm9yIEZSRUUgaGVhZCBvdmVyIHRvIGh0dHA6Ly93d3cuY2FjZXJ0Lm9y
ZzAxBgNVHR8EKjAoMCagJKAihiBodHRwOi8vY3JsLmNhY2VydC5vcmcvcmV2b2tl
LmNybDAzBglghkgBhvhCAQQEJhYkVVJJOmh0dHA6Ly9jcmwuY2FjZXJ0Lm9yZy9y
ZXZva2UuY3JsMDIGCCsGAQUFBwEBBCYwJDAiBggrBgEFBQcwAYYWaHR0cDovL29j
c3AuY2FjZXJ0Lm9yZzAfBgNVHSMEGDAWgBQWtTIb1Mfz4OaO873SsDrusjkY0TAN
BgkqhkiG9w0BAQsFAAOCAgEAR5zXs6IX01JTt7Rq3b+bNRUhbO9vGBMggczo7R0q
Ih1kdhS6WzcrDoO6PkpuRg0L3qM7YQB6pw2V+ubzF7xl4C0HWltfzPTbzAHdJtja
JQw7QaBlmAYpN2CLB6Jeg8q/1Xpgdw/+IP1GRwdg7xUpReUA482l4MH1kf0W0ad9
4SuIfNWQHcdLApmno/SUh1bpZyeWrMnlhkGNDKMxCCQXQ360TwFHc8dfEAaq5ry6
cZzm1oetrkSviE2qofxvv1VFiQ+9TX3/zkECCsUB/EjPM0lxFBmu9T5Ih+Eqns9i
vmrEIQDv9tNyJHuLsDNqbUBal7OoiPZnXk9LH+qb+pLf1ofv5noy5vX2a5OKebHe
+0Ex/A7e+G/HuOjVNqhZ9j5Nispfq9zNyOHGWD8ofj8DHwB50L1Xh5H+EbIoga/h
JCQnRtxWkHP699T1JpLFYwapgplivF4TFv4fqp0nHTKC1x9gGrIgvuYJl1txIKmx
XdfJzgscMzqpabhtHOMXOiwQBpWzyJkofF/w55e0LttZDBkEsilV/vW0CJsPs3eN
aQF+iMWscGOkgLFlWsAS3HwyiYLNJo26aqyWPaIdc8E4ck7Sk08WrFrHIK3EHr4n
1FZwmLpFAvucKqgl0hr+2jypyh5puA3KksHF3CsUzjMUvzxMhykh9zrMxQAHLBVr
Gwc=
-----END CERTIFICATE-----
`;
    beforeEach(function() {
      this.readFileMock = ImportMock.mockFunction(fsPromises, "readFile");
    });

    afterEach(function() {
      (this.readFileMock as SinonStub).restore();
    });

    const checkAccountAndCon = (
      mngr: AccountManager,
      acc: AccountStorage,
      con: any
    ) => {
      const apiUrl = acc.apiUrl;
      expect(mngr.activeAccounts.getAllApis()).to.deep.equal([apiUrl]);
      expect(mngr.activeAccounts.getConfig(apiUrl)!.account).to.deep.equal(acc);
      expect(mngr.activeAccounts.getConfig(apiUrl)!.connection).to.deep.include(
        con
      );
    };

    describe("account on OBS", () => {
      const username = "me";
      const accountName = "OBS";
      const realname = "Jane Doe";
      const email = "jane@doe.org";
      const apiUrl = "https://api.opensuse.org/";
      const password = "foo";

      beforeEach(function() {
        this.fixture.vscodeWindow.showQuickPick
          .onCall(0)
          .resolves("build.opensuse.org (OBS)");
        this.fixture.vscodeWindow.showInputBox.onCall(0).resolves(username);
        this.fixture.vscodeWindow.showInputBox.onCall(1).resolves(accountName);
        this.fixture.vscodeWindow.showInputBox.onCall(2).resolves(realname);
        this.fixture.vscodeWindow.showInputBox.onCall(3).resolves(email);
        this.fixture.vscodeWindow.showInputBox.onCall(4).resolves(password);
      });

      it(
        "creates a new OBS account",
        castToAsyncFunc<FixtureContext>(async function() {
          const mngr = await this.fixture.createAccountManager();

          await mngr.newAccountWizzard().should.be.fulfilled;

          this.fixture.sandbox.assert.calledOnce(
            this.fixture.vscodeWindow.showQuickPick
          );
          this.fixture.sandbox.assert.callCount(
            this.fixture.vscodeWindow.showInputBox,
            5
          );

          this.fixture.sandbox.assert.calledOnce(this.fixture.accountChangeSpy);
          checkAccountAndCon(
            mngr,
            {
              accountName: "OBS",
              apiUrl,
              email,
              realname,
              username
            },
            {
              password,
              url: apiUrl,
              username
            }
          );
        })
      );

      it(
        "creates a OBS account without a real name and email",
        castToAsyncFunc<FixtureContext>(async function() {
          this.fixture.vscodeWindow.showInputBox.onCall(2).resolves(undefined);
          this.fixture.vscodeWindow.showInputBox.onCall(3).resolves("");

          const mngr = await this.fixture.createAccountManager();

          await mngr.newAccountWizzard().should.be.fulfilled;

          this.fixture.sandbox.assert.calledOnce(this.fixture.accountChangeSpy);
          checkAccountAndCon(
            mngr,
            {
              accountName: "OBS",
              apiUrl,
              username
            },
            {
              password,
              url: apiUrl,
              username
            }
          );
        })
      );
    });

    describe("custom account", () => {
      const username = "me";
      const accountName = "DOE";
      const realname = "Jane Doe";
      const email = "jane@doe.org";
      const apiUrl = "https://api.doe.org/";
      const password = "foo";
      const certPath = "/etc/custom_cert.pem";

      beforeEach(function() {
        this.fixture.vscodeWindow.showQuickPick
          .onCall(0)
          .resolves("other (custom)");
        this.fixture.vscodeWindow.showInputBox.onCall(0).resolves(apiUrl);
        this.fixture.vscodeWindow.showInputBox.onCall(1).resolves(username);
        this.fixture.vscodeWindow.showInputBox.onCall(2).resolves(accountName);
        this.fixture.vscodeWindow.showInputBox.onCall(3).resolves(realname);
        this.fixture.vscodeWindow.showInputBox.onCall(4).resolves(email);

        // add a custom cert?
        this.fixture.vscodeWindow.showQuickPick.onCall(1).resolves("Yes");
        this.fixture.vscodeWindow.showOpenDialog
          .onCall(0)
          .resolves([vscode.Uri.file(certPath)]);

        this.fixture.vscodeWindow.showInputBox.onCall(5).resolves(password);
      });

      it(
        "creates a new custom account",
        castToAsyncFunc<FixtureContext>(async function() {
          const mngr = await this.fixture.createAccountManager();

          this.readFileMock.resolves(
            Buffer.from(caCertRootCertificate, "ascii")
          );

          await mngr.newAccountWizzard().should.be.fulfilled;

          this.fixture.sandbox.assert.calledTwice(
            this.fixture.vscodeWindow.showQuickPick
          );
          this.fixture.sandbox.assert.callCount(
            this.fixture.vscodeWindow.showInputBox,
            6
          );

          this.fixture.sandbox.assert.calledOnce(this.fixture.accountChangeSpy);

          checkAccountAndCon(
            mngr,
            {
              accountName: "DOE",
              apiUrl,
              email,
              realname,
              serverCaCertificate: caCertRootCertificate,
              username
            },
            {
              password,
              serverCaCertificate: caCertRootCertificate,
              url: apiUrl,
              username
            }
          );
        })
      );

      it(
        "reports an error reading the certificate if the path is invalid",
        castToAsyncFunc<FixtureContext>(async function() {
          const mngr = await this.fixture.createAccountManager();

          const errMsg = `ENOENT: no such file or directory, open ${certPath}`;
          this.readFileMock.throws(Error(errMsg));

          await mngr.newAccountWizzard().should.be.fulfilled;

          this.fixture.sandbox.assert.calledTwice(
            this.fixture.vscodeWindow.showQuickPick
          );
          this.fixture.sandbox.assert.callCount(
            this.fixture.vscodeWindow.showInputBox,
            6
          );

          this.fixture.sandbox.assert.calledOnce(
            this.fixture.vscodeWindow.showErrorMessage
          );
          this.fixture.sandbox.assert.calledWith(
            this.fixture.vscodeWindow.showErrorMessage,
            `Could not read the server certificate from the file '${certPath}', got the following error: Error: ${errMsg}. This is not a fatal error.`
          );

          this.fixture.sandbox.assert.calledOnce(this.fixture.accountChangeSpy);

          checkAccountAndCon(
            mngr,
            {
              accountName: "DOE",
              apiUrl,
              email,
              realname,
              username
            },
            {
              password,
              url: apiUrl,
              username
            }
          );

          expect(
            mngr.activeAccounts.getConfig(apiUrl)!.connection[
              // tslint:disable-next-line: no-string-literal
              "serverCaCertificate"
            ]
          ).to.equal(undefined);
        })
      );
    });
  });
});
