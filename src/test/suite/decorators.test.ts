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
import { expect } from "chai";
import { afterEach, beforeEach, Context, describe, it } from "mocha";
import { sleep } from "open-build-service-api/lib/util";
import {
  assert,
  createSandbox,
  SinonSandbox,
  SinonSpy,
  SinonStub,
  spy
} from "sinon";
import { LoggingBase } from "../../base-components";
import { debounce, logAndReportExceptions } from "../../decorators";
import {
  castToAsyncFunc,
  castToFunc,
  createStubbedVscodeWindow
} from "./test-utils";

describe("decorators", () => {
  describe("#logAndReportExceptions", () => {
    class ClassMakingApiCalls extends LoggingBase {
      public readonly sandbox: SinonSandbox;
      public loggingStub: { error: SinonStub };
      public readonly vscodeWindow: ReturnType<
        typeof createStubbedVscodeWindow
      >;

      constructor() {
        const sandbox = createSandbox();
        const childLoggerStub = { error: sandbox.stub() };
        const extLoggerStub = { getChildLogger: () => childLoggerStub };
        super((extLoggerStub as any) as IVSCodeExtLogger);
        this.loggingStub = childLoggerStub;
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
        await this.testClass.doesNothingOrThrowsAsync(true);

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
        await this.testClass.doesNothingOrThrowsAsync(true, err);

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
        await this.testClass.doesNothingOrThrowsAsync(false);

        assert.notCalled(this.testClass.loggingStub.error);
        assert.notCalled(this.testClass.vscodeWindow.showErrorMessage);
      })
    );

    it(
      "does not report the exception to the user but logs it",
      castToAsyncFunc<TestClassCtx>(async function () {
        await this.testClass.decoratedButNoUserReport(true);

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
          .should.eventually.equal(false);

        assert.notCalled(this.testClass.vscodeWindow.showErrorMessage);
        assert.notCalled(this.testClass.loggingStub.error);
      })
    );

    it(
      "correctly returns the returned Promise value if the method does not throw",
      castToAsyncFunc<TestClassCtx>(async function () {
        await this.testClass
          .doesNothingOrThrowsAsync(false)
          .should.eventually.equal(42);

        assert.notCalled(this.testClass.vscodeWindow.showErrorMessage);
        assert.notCalled(this.testClass.loggingStub.error);
      })
    );

    it(
      "returns undefined if the method throws",
      castToAsyncFunc<TestClassCtx>(async function () {
        await this.testClass
          .doesNothingOrThrows(true)
          .should.eventually.equal(undefined);
        await this.testClass
          .doesNothingOrThrowsAsync(true)
          .should.eventually.equal(undefined);
      })
    );
  });

  describe("#debounce", () => {
    class TestClass {
      constructor(public readonly spy: SinonSpy) {}

      @debounce(200)
      public debounced(): void {
        this.spy();
      }
    }

    it("prevents member functions from being called as frequently as possible", async () => {
      const before = new Date();
      let after = new Date();

      const test = new TestClass(spy());
      let actualCallCount = 0;
      do {
        await sleep(50);

        test.debounced();
        actualCallCount++;
        after = new Date();
      } while (after.getTime() - before.getTime() < 200);

      // give the spy the chance to actually get called
      await sleep(300);

      test.spy.should.have.been.calledOnce;
      expect(actualCallCount > 1);
    });
  });
});
