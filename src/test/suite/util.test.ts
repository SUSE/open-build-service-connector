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

import { expect, should } from "chai";
import { afterEach, beforeEach, Context, describe, it } from "mocha";
import { Logger } from "pino";
import { assert, createSandbox, SinonSandbox, SinonStub, stub } from "sinon";
import { LoggingBase } from "../../base-components";
import {
  deepCopyProperties,
  loadMapFromMemento,
  logAndReportExceptions,
  saveMapToMemento,
  setDifference
} from "../../util";
import {
  castToAsyncFunc,
  castToFunc,
  createStubbedVscodeWindow
} from "./test-utils";

should();

type MementoCtx = Context & {
  mockMemento: { get: SinonStub; update: SinonStub };
};

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
    beforeEach(function () {
      this.mockMemento = {
        get: stub(),
        update: stub()
      };
    });

    afterEach(function () {
      this.mockMemento.get.resetHistory();
      this.mockMemento.update.resetHistory();
    });

    it(
      "calls get on loadMapFromMemento",
      castToFunc<MementoCtx>(function () {
        this.mockMemento.get.returns([]);

        expect(loadMapFromMemento(this.mockMemento, "foo"))
          .to.be.a("Map")
          .and.have.lengthOf(0);

        assert.calledOnce(this.mockMemento.get);
        assert.calledWith(this.mockMemento.get, "foo", []);
      })
    );

    it(
      "saveMapToMemento is the inverse to loadMapFromMemento",
      castToAsyncFunc<MementoCtx>(async function () {
        this.mockMemento.update.resolves();

        const testMap = new Map<string, number | string>();
        testMap.set("one", 1);
        testMap.set("two", 2);
        testMap.set("cake", "a lie");

        await saveMapToMemento(
          this.mockMemento,
          "bar",
          testMap
        ).should.be.fulfilled;

        assert.calledOnce(this.mockMemento.update);
        expect(this.mockMemento.update.getCall(0).args[0]).to.equal("bar");

        this.mockMemento.get.returns(
          this.mockMemento.update.getCall(0).args[1]
        );

        expect(loadMapFromMemento(this.mockMemento, "bar"))
          .to.be.a("Map")
          .and.deep.equal(testMap);

        assert.calledOnce(this.mockMemento.get);
        assert.calledWith(this.mockMemento.get, "bar");
      })
    );
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
      public readonly vscodeWindow: ReturnType<
        typeof createStubbedVscodeWindow
      >;

      constructor() {
        const sandbox = createSandbox();
        const loggingStub = { error: sandbox.stub() };
        super((loggingStub as any) as Logger);
        this.loggingStub = loggingStub;
        this.sandbox = sandbox;
        this.vscodeWindow = createStubbedVscodeWindow(this.sandbox);
      }

      @logAndReportExceptions()
      public async doesNothingOrThrowsAsync(
        throwUp: boolean,
        exception?: any
      ): Promise<number> {
        if (throwUp) {
          throw exception ?? new Error("Barf");
        }
        return 42;
      }

      @logAndReportExceptions()
      public doesNothingOrThrows(throwUp: boolean): boolean {
        if (throwUp) {
          throw new Error("Tripple Barf");
        }
        return false;
      }

      @logAndReportExceptions(false)
      public async decoratedButNoUserReport(throwUp: boolean) {
        if (throwUp) {
          throw new Error("BarfBarf");
        }
      }
    }

    type TestClassCtx = Context & { testClass: ClassMakingApiCalls };

    beforeEach(function () {
      this.testClass = new ClassMakingApiCalls();
    });

    afterEach(function () {
      this.testClass.sandbox.restore();
    });

    it(
      "reports the thrown exception",
      castToAsyncFunc<TestClassCtx>(async function () {
        await this.testClass.doesNothingOrThrowsAsync(true).should.be.fulfilled;

        assert.calledOnce(this.testClass.loggingStub.error);
        assert.calledOnce(this.testClass.vscodeWindow.showErrorMessage);

        // need to compare the errors by their .toString() as the Error class
        // includes the current call stack
        expect(
          this.testClass.loggingStub.error.getCall(0).args[0].toString()
        ).to.deep.equal(Error("Barf").toString());

        const errMsg = "Error: Barf";
        assert.calledWith(
          this.testClass.vscodeWindow.showErrorMessage.firstCall,
          errMsg
        );
      })
    );

    it(
      "reports the thrown ApiError in a more readable fashion",
      castToAsyncFunc<TestClassCtx>(async function () {
        const summary = "package not found";
        const err = {
          status: { summary }
        };
        await this.testClass.doesNothingOrThrowsAsync(
          true,
          err
        ).should.be.fulfilled;

        const errMsg = `Error performing API call: ${summary}`;
        assert.calledWith(this.testClass.loggingStub.error.firstCall, err);
        assert.calledWith(
          this.testClass.vscodeWindow.showErrorMessage.firstCall,
          errMsg
        );
      })
    );

    it(
      "does nothing when no exception is thrown",
      castToAsyncFunc<TestClassCtx>(async function () {
        await this.testClass.doesNothingOrThrowsAsync(
          false
        ).should.be.fulfilled;

        assert.notCalled(this.testClass.loggingStub.error);
        assert.notCalled(this.testClass.vscodeWindow.showErrorMessage);
      })
    );

    it(
      "does not report the exception to the user but logs it",
      castToAsyncFunc<TestClassCtx>(async function () {
        await this.testClass.decoratedButNoUserReport(true).should.be.fulfilled;

        assert.notCalled(this.testClass.vscodeWindow.showErrorMessage);

        assert.calledOnce(this.testClass.loggingStub.error);
        expect(
          this.testClass.loggingStub.error.getCall(0).args[0].toString()
        ).to.deep.equal(Error("BarfBarf").toString());
      })
    );

    it(
      "reports exception for non-async functions",
      castToFunc<TestClassCtx>(function () {
        this.testClass.doesNothingOrThrows(true);

        assert.calledOnce(this.testClass.vscodeWindow.showErrorMessage);

        assert.calledOnce(this.testClass.loggingStub.error);
        expect(
          this.testClass.loggingStub.error.getCall(0).args[0].toString()
        ).to.deep.equal(Error("Tripple Barf").toString());
      })
    );

    it(
      "correctly returns the return value if the method does not throw",
      castToFunc<TestClassCtx>(async function () {
        await this.testClass
          .doesNothingOrThrows(false)
          .should.be.fulfilled.and.eventually.equal(false);

        assert.notCalled(this.testClass.vscodeWindow.showErrorMessage);
        assert.notCalled(this.testClass.loggingStub.error);
      })
    );

    it(
      "correctly returns the returned Promise value if the method does not throw",
      castToAsyncFunc<TestClassCtx>(async function () {
        await this.testClass
          .doesNothingOrThrowsAsync(false)
          .should.be.fulfilled.and.eventually.equal(42);

        assert.notCalled(this.testClass.vscodeWindow.showErrorMessage);
        assert.notCalled(this.testClass.loggingStub.error);
      })
    );

    it(
      "returns undefined if the method throws",
      castToAsyncFunc<TestClassCtx>(async function () {
        await this.testClass
          .doesNothingOrThrows(true)
          .should.be.fulfilled.and.eventually.equal(undefined);
        await this.testClass
          .doesNothingOrThrowsAsync(true)
          .should.be.fulfilled.and.eventually.equal(undefined);
      })
    );
  });
});
