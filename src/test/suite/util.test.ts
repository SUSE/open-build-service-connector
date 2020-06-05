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
import { assert, SinonStub, stub } from "sinon";
import {
  deepCopyProperties,
  loadMapFromMemento,
  saveMapToMemento,
  setDifference
} from "../../util";
import { castToAsyncFunc, castToFunc } from "./test-utils";

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

    it("handles undefined objects", () => {
      expect(deepCopyProperties(undefined)).to.equal(undefined);
    });
  });
});
