import * as keytar from "keytar";
import * as obs from "obs-ts";

import { afterEach, beforeEach, describe, it } from "mocha";
import { expect, use, should } from "chai";
import * as chaiAsPromised from "chai-as-promised";
import * as chaiThings from "chai-things";
import { ImportMock } from "ts-mock-imports";
import { assert, fake, spy } from "sinon";

import {
  AccountTreeElement,
  AccountTreeProvider,
  AccountStorage
} from "../../accounts";

use(chaiAsPromised);
use(chaiThings);
should();

/**
 * Initialize a fake Memento and a fake existing account that the Memento
 * returns.
 */
function setupFakeExistingAccount(this: any) {
  this.fakePresentAccount = {
    accountName: "foo",
    aliases: [],
    apiUrl: "https://api.baz.org",
    username: "fooUser"
  };
  this.mockMemento = {
    get: fake.returns([this.fakePresentAccount]),
    update: fake.returns(Promise.resolve())
  };
}

describe("AccountTreeProvider", () => {
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
  });

  describe("No accounts stored", () => {
    beforeEach(function() {
      this.mockMemento = {
        get: fake.returns([]),
        update: fake.returns(Promise.resolve())
      };
    });

    it("returns no top level children", async function() {
      const testAccount = new AccountTreeProvider(this.mockMemento);
      await testAccount.initAccounts().should.be.fulfilled;

      expect(testAccount.getChildren(undefined))
        .to.eventually.be.a("array")
        .and.to.have.length(0);

      assert.calledOnce(this.mockMemento.get);
      assert.notCalled(this.mockMemento.update);
      assert.notCalled(this.keytarGetPasswordMock);
    });
  });

  describe("#importAccountsFromOsrc", function() {
    beforeEach(setupFakeExistingAccount);

    it("imports an account with a set password", async function() {
      const fakeNewOscrcAccount = {
        aliases: [],
        username: "barUser",
        password: "barrr",
        apiUrl: "https://api.bar.org"
      };

      this.readAccountsFromOscrcMock.returns(
        Promise.resolve([fakeNewOscrcAccount])
      );

      const testAccount = new AccountTreeProvider(this.mockMemento);
      await testAccount.initAccounts().should.be.fulfilled;
      await testAccount.importAccountsFromOsrc().should.be.fulfilled;

      assert.calledOnce(this.keytarSetPasswordMock);

      expect(this.keytarSetPasswordMock.getCall(0).args).to.include.members([
        "https://api.bar.org",
        "barrr"
      ]);
      expect(this.mockMemento.update.getCall(0).args).to.deep.include([
        this.fakePresentAccount,
        {
          accountName: "https://api.bar.org",
          ...(({ password, ...others }) => ({ ...others }))(fakeNewOscrcAccount)
        }
      ]);
    });

    it("imports an account without a set password", async function() {
      const fakeOscrcAccount = {
        aliases: [],
        apiUrl: "https://api.bar.org",
        password: undefined,
        username: "barUser"
      };

      this.readAccountsFromOscrcMock.returns(
        Promise.resolve([fakeOscrcAccount])
      );

      const testAccount = new AccountTreeProvider(this.mockMemento);
      await testAccount.initAccounts().should.be.fulfilled;
      await testAccount.importAccountsFromOsrc().should.be.fulfilled;

      assert.notCalled(this.keytarSetPasswordMock);

      expect(this.mockMemento.update.getCall(0).args[1]).to.eql([
        this.fakePresentAccount,
        {
          accountName: "https://api.bar.org",
          ...(({ password, ...others }) => ({ ...others }))(fakeOscrcAccount)
        }
      ]);
    });

    it("doesn't import a present account", async function() {
      const fakeOscrcAccount = {
        aliases: [],
        apiUrl: "https://api.baz.org",
        password: undefined,
        username: "barUser"
      };

      this.readAccountsFromOscrcMock.returns(
        Promise.resolve([fakeOscrcAccount])
      );

      const testAccount = new AccountTreeProvider(this.mockMemento);
      await testAccount.initAccounts().should.be.fulfilled;

      const curConEventSpy = spy();
      testAccount.onConnectionChange(curConEventSpy);

      await testAccount.importAccountsFromOsrc().should.be.fulfilled;

      assert.notCalled(curConEventSpy);
    });
  });

  describe("#removeAccount", () => {
    beforeEach(setupFakeExistingAccount);

    it("removes a present account", async function() {
      // removal succeeds
      this.keytarDeletePasswordMock.resolves(true);

      const testAccount = new AccountTreeProvider(this.mockMemento);
      await testAccount.initAccounts().should.be.fulfilled;

      await testAccount.removeAccount(
        new AccountTreeElement(this.fakePresentAccount)
      ).should.be.fulfilled;

      assert.calledOnce(this.keytarDeletePasswordMock);
      assert.calledOnce(this.mockMemento.get);
      assert.calledOnce(this.mockMemento.update);

      expect(this.keytarDeletePasswordMock.getCall(0).args).to.deep.include(
        this.fakePresentAccount.apiUrl
      );
      expect(this.mockMemento.update.getCall(0).args[1]).to.eql([]);
    });

    it("reports an error when password removal fails", async function() {
      // pw removal fails
      this.keytarDeletePasswordMock.resolves(false);

      const testAccount = new AccountTreeProvider(this.mockMemento);
      await testAccount.initAccounts().should.be.fulfilled;

      await testAccount
        .removeAccount(new AccountTreeElement(this.fakePresentAccount))
        .should.be.rejectedWith(
          `Cannot remove password for account ${this.fakePresentAccount.accountName}`
        );

      assert.calledOnce(this.keytarDeletePasswordMock);
    });
  });

  describe("#initAccounts", () => {
    beforeEach(function() {
      this.callMe = setupFakeExistingAccount;
      this.callMe();
      this.keytarGetPasswordMock.resolves("fooPw");
    });

    it("populates the currentConnetions and fires the event", async function() {
      const curConEventSpy = spy();

      const testAccount = new AccountTreeProvider(this.mockMemento);
      testAccount.onConnectionChange(curConEventSpy);
      await testAccount.initAccounts().should.be.fulfilled;

      // password was retrieved?
      assert.calledOnce(this.keytarGetPasswordMock);
      expect(this.keytarGetPasswordMock.getCall(0).args[1]).to.eql(
        this.fakePresentAccount.apiUrl
      );

      // did the EventEmitter fire?
      assert.calledOnce(curConEventSpy);
      expect(curConEventSpy.getCall(0).args).to.have.length(1);
      const curCons = curConEventSpy.getCall(0).args[0];

      expect(curCons).to.have.property("mapping");
      const mappings: Array<[AccountStorage, obs.Connection | undefined]> = [
        ...curCons.mapping.values()
      ];
      expect(mappings).to.have.length(1);
      // AccountStorage
      expect(mappings[0][0]).to.include({ ...this.fakePresentAccount });
      // Connection is not undefined
      expect(mappings[0][1]).to.have.property(
        "url",
        this.fakePresentAccount.apiUrl
      );
    });

    it("sets the default connection when only one account is present", async function() {
      const curConEventSpy = spy();

      const testAccount = new AccountTreeProvider(this.mockMemento);
      testAccount.onConnectionChange(curConEventSpy);
      await testAccount.initAccounts().should.be.fulfilled;

      // did the EventEmitter fire?
      assert.calledOnce(curConEventSpy);
      const curCons = curConEventSpy.getCall(0).args[0];

      expect(curCons)
        .to.have.property("defaultApi")
        .that.equals(obs.normalizeUrl(this.fakePresentAccount.apiUrl));
    });

    it("does nothing when called a second time", async function() {
      const testAccount = new AccountTreeProvider(this.mockMemento);
      await testAccount.initAccounts().should.be.fulfilled;
      await testAccount.initAccounts().should.be.fulfilled;

      assert.calledOnce(this.keytarGetPasswordMock);
    });
  });

  afterEach(function() {
    this.keytarGetPasswordMock.restore();
    this.keytarSetPasswordMock.restore();
    this.keytarDeletePasswordMock.restore();
    this.readAccountsFromOscrcMock.restore();
  });
});
