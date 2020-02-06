import mockFs = require("mock-fs");

import { expect, should } from "chai";
import { existsSync } from "fs";
import { afterEach, beforeEach, describe, it, xit } from "mocha";
import { Logger } from "pino";
import { assert, createSandbox, SinonSandbox, SinonStub, stub } from "sinon";
import { LoggingBase } from "../../base-components";
import {
  deepCopyProperties,
  loadMapFromMemento,
  logAndReportExceptions,
  rmRf,
  saveMapToMemento,
  setDifference
} from "../../util";
import { VscodeWindow } from "../../vscode-dep";
import { createStubbedVscodeWindow } from "./test-utils";

should();

describe("utilities", () => {
  describe("#setDifference", () => {
    it("works for empty sets", () => {
      expect(setDifference(new Set(), new Set()))
        .to.be.a("set")
        .and.have.length(0);
    });

    it("works when one set is empty", () => {
      expect(setDifference(new Set([1, 2]), new Set()))
        .to.be.a("set")
        .and.have.length(2)
        .and.to.eql(new Set([1, 2]));

      expect(setDifference(new Set(), new Set([1, 2])))
        .to.be.a("set")
        .and.have.length(0);
    });

    it("outputs calculates the correct difference", () => {
      expect(setDifference(new Set([1, 2, 3]), new Set([2, 3])))
        .to.be.a("set")
        .and.to.have.length(1)
        .and.to.include(1);
    });
  });

  describe("load and save Map to Memento", () => {
    beforeEach(function() {
      this.mockMemento = {
        get: stub(),
        update: stub()
      };
    });

    afterEach(function() {
      this.mockMemento.get.resetHistory();
      this.mockMemento.update.resetHistory();
    });

    it("calls get on loadMapFromMemento", function() {
      this.mockMemento.get.returns([]);

      expect(loadMapFromMemento(this.mockMemento, "foo"))
        .to.be.a("Map")
        .and.have.lengthOf(0);

      assert.calledOnce(this.mockMemento.get);
      assert.calledWith(this.mockMemento.get, "foo", []);
    });

    it("saveMapToMemento is the inverse to loadMapFromMemento", async function() {
      this.mockMemento.update.resolves();

      const testMap = new Map<string, number | string>();
      testMap.set("one", 1);
      testMap.set("two", 2);
      testMap.set("cake", "a lie");

      await saveMapToMemento(this.mockMemento, "bar", testMap).should.be
        .fulfilled;

      assert.calledOnce(this.mockMemento.update);
      expect(this.mockMemento.update.getCall(0).args[0]).to.equal("bar");

      this.mockMemento.get.returns(this.mockMemento.update.getCall(0).args[1]);

      expect(loadMapFromMemento(this.mockMemento, "bar"))
        .to.be.a("Map")
        .and.deep.equal(testMap);

      assert.calledOnce(this.mockMemento.get);
      assert.calledWith(this.mockMemento.get, "bar");
    });
  });

  describe("#rmRf", () => {
    beforeEach(() => {
      mockFs({
        "fooDir/dturinae/asdf": "something",
        "fooDir/foo/bar/baz": "nested",
        "fooDir/testFile": "It's something",
        thisShouldStay: "I'm still there"
      });
    });

    afterEach(() => {
      mockFs.restore();
    });

    // FIXME: this does not work as mock-fs doesn't support fs.Dirent:
    // https://github.com/tschaub/mock-fs/issues/272#issuecomment-513847569
    xit("removes the directory fooDir and all its contents", async () => {
      expect(existsSync("fooDir")).to.be.true;

      await rmRf("fooDir").should.be.fulfilled;

      expect(existsSync("fooDir")).to.be.false;
    });
  });

  describe("#deepCopyPropierts", () => {
    it("copies an object with nested properties", () => {
      const obj = {
        foo: "bar",
        someObj: {
          aArray: [16, 28],
          hello: "world"
        },
        someValues: [1, 2, 890, 3, "baz"]
      };
      const newObj = deepCopyProperties(obj);
      expect(newObj).to.deep.equal(obj);

      newObj.someObj.hello = "all";
      expect(newObj.someObj.hello).to.deep.equal("all");
      expect(obj.someObj.hello).to.deep.equal("world");
    });

    it("does not copy functions", () => {
      const objWithFunc = {
        baz: () => 16,
        foo: "bar"
      };

      expect(deepCopyProperties(objWithFunc))
        .to.deep.equal({ foo: "bar" })
        .and.to.not.have.property("baz");
    });
  });

  describe("#logAndReportExceptions", () => {
    class ClassMakingApiCalls extends LoggingBase {
      public readonly sandbox: SinonSandbox;
      public loggingStub: { error: SinonStub };
      public readonly vscodeWindow: VscodeWindow;

      constructor() {
        const sandbox = createSandbox();
        const loggingStub = { error: sandbox.stub() };
        super((loggingStub as any) as Logger);
        this.loggingStub = loggingStub;
        this.sandbox = sandbox;
        this.vscodeWindow = createStubbedVscodeWindow(this.sandbox);
      }

      @logAndReportExceptions()
      public async doesNothingOrThrows(throwUp: boolean, exception?: any) {
        if (throwUp) {
          throw exception ?? new Error("Barf");
        }
      }

      @logAndReportExceptions(false)
      public async decoratedButNoUserReport(throwUp: boolean) {
        if (throwUp) {
          throw new Error("BarfBarf");
        }
      }
    }

    beforeEach(function() {
      this.testClass = new ClassMakingApiCalls();
    });

    afterEach(function() {
      this.testClass.sandbox.restore();
    });

    it("reports the thrown exception", async function() {
      await this.testClass.doesNothingOrThrows(true).should.be.fulfilled;

      assert.calledOnce(this.testClass.loggingStub.error);
      assert.calledOnce(this.testClass.vscodeWindow.showErrorMessage);

      const errMsg = "Error performing an API call, got: Error: Barf";
      assert.calledWith(this.testClass.loggingStub.error.firstCall, errMsg);
      assert.calledWith(
        this.testClass.vscodeWindow.showErrorMessage.firstCall,
        errMsg
      );
    });

    it("reports the thrown ApiError in a more readable fashion", async function() {
      const summary = "package not found";
      await this.testClass.doesNothingOrThrows(true, {
        status: { summary }
      }).should.be.fulfilled;

      const errMsg = `Error performing an API call, got: ${summary}`;
      assert.calledWith(this.testClass.loggingStub.error.firstCall, errMsg);
      assert.calledWith(
        this.testClass.vscodeWindow.showErrorMessage.firstCall,
        errMsg
      );
    });

    it("does nothing when no exception is thrown", async function() {
      await this.testClass.doesNothingOrThrows(false).should.be.fulfilled;

      assert.notCalled(this.testClass.loggingStub.error);
      assert.notCalled(this.testClass.vscodeWindow.showErrorMessage);
    });

    it("does not report the exception to the user but logs it", async function() {
      await this.testClass.decoratedButNoUserReport(true).should.be.fulfilled;

      assert.notCalled(this.testClass.vscodeWindow.showErrorMessage);

      assert.calledOnce(this.testClass.loggingStub.error);
      assert.calledWith(
        this.testClass.loggingStub.error.firstCall,
        "Error performing an API call, got: Error: BarfBarf"
      );
    });
  });
});
