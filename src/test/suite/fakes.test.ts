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

import { afterEach, beforeEach, describe, it } from "mocha";
import { createSandbox } from "sinon";
import { makeFakeEvent } from "./fakes";
import { sleep } from "./test-utils";

interface Foo {
  prop: string;
}

const foo = { prop: "foo" };
const bar = { prop: "bar" };
const baz = { prop: "baz" };

describe("fakes", () => {
  beforeEach(function () {
    this.sandbox = createSandbox();
  });
  afterEach(function () {
    this.sandbox.restore();
  });

  describe("#FakeEvent", () => {
    it("notifies all synchronous listeners", function () {
      const emitter = makeFakeEventEmitter<Foo>();

      const listener1 = this.sandbox.spy();
      const listener2 = this.sandbox.spy();

      emitter.event(listener1);
      emitter.event(listener2);

      emitter.fire(foo);

      listener1.should.have.been.calledOnceWith(foo);
      listener2.should.have.been.calledOnceWith(foo);
    });

    it("notifies asynchronous listeners", async function () {
      const emitter = makeFakeEventEmitter<Foo>();

      const stub1 = this.sandbox.stub();
      const stub2 = this.sandbox.stub();

      const listener1 = async (e: Foo) => {
        await sleep(1000);
        stub1(e);
      };
      const listener2 = async (e: Foo) => {
        await sleep(500);
        stub2(e);
      };

      emitter.event(listener1);
      emitter.event(listener2);

      await emitter.fire(foo);

      stub1.should.have.been.calledOnceWith(foo);
      stub2.should.have.been.calledOnceWith(foo);
    });

    it("correctly calls a callback with a thisArg if supplied", function () {
      const emitter = makeFakeEventEmitter<Foo>();

      class CallBackOwner {
        public foo: Foo;
        constructor() {
          this.foo = { prop: "not foo" };
        }

        public setFoo(foo: Foo) {
          this.foo = foo;
        }
      }

      const cb = new CallBackOwner();
      cb.foo.prop.should.deep.equal("not foo");

      emitter.event(cb.setFoo, cb);
      emitter.fire(foo);

      cb.foo.should.deep.equal(foo);
    });

    describe("#dispose", () => {
      it("unsubscribes the listener", function () {
        const emitter = makeFakeEventEmitter<Foo>();

        const listener1 = this.sandbox.spy();
        const listener2 = this.sandbox.spy();

        const disposable1 = emitter.event(listener1);
        const disposable2 = emitter.event(listener2);

        const foo = { prop: "foo" };
        emitter.fire(foo);

        listener1.should.have.been.calledOnceWith(foo);
        listener2.should.have.been.calledOnceWith(foo);

        disposable2.dispose();

        emitter.fire(bar);
        listener1.should.have.been.calledTwice;
        listener2.should.have.been.calledOnce;
        listener1.should.have.been.calledWithExactly(bar);

        disposable1.dispose();

        emitter.fire(baz);
        listener1.should.have.been.calledTwice;
        listener2.should.have.been.calledOnce;
      });
    });
  });
});
