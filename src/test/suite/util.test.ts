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

const mockFs = require("mock-fs");

import { expect, should } from "chai";
import { promises as fsPromises } from "fs";
import { afterEach, beforeEach, Context, describe, it } from "mocha";
import { pathExists } from "open-build-service-api";
import { tmpdir } from "os";
import { join } from "path";
import { assert, SinonStub, stub } from "sinon";
import { createTestTempDir } from "../../ui-tests/util";
import {
  createItemInserter,
  deepCopyProperties,
  deepEqual,
  findRegexPositionInString,
  loadMapFromMemento,
  safeUnlink,
  saveMapToMemento,
  setDifference,
  setUnion
} from "../../util";
import { castToAsyncFunc, castToFunc, testLogger } from "./test-utils";
import { getTmpPrefix, safeRmRf } from "./utilities";

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

  describe("#setUnion", () => {
    it("works for empty sets", () => {
      expect(setUnion(new Set(), new Set())).to.be.a("set").and.have.length(0);
    });

    it("returns the union", () => {
      expect(setUnion(new Set([1, 2, 3]), new Set([4, 5])))
        .to.be.a("set")
        .and.to.deep.equal(new Set([1, 2, 3, 5, 4]));
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

        await saveMapToMemento(this.mockMemento, "bar", testMap);

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

  describe("#createItemInserter", () => {
    it("appends the new entries if insertBeforeIndex is not provided", () => {
      const arr = [1, 3, 18];
      const inserter = createItemInserter(arr);

      expect(inserter([5])).to.deep.equal([1, 3, 18, 5]);
      expect(inserter([18, 4])).to.deep.equal([1, 3, 18, 18, 4]);
    });

    it("prepends the new entries if insertBeforeIndex is zero", () => {
      const arr = [1, 3, 16];
      const inserter = createItemInserter(arr, 0);

      expect(inserter([5])).to.deep.equal([5, 1, 3, 16]);
      expect(inserter([28, 42])).to.deep.equal([28, 42, 1, 3, 16]);
    });

    it("inserts the new entries if insertBeforeIndex is non-zero", () => {
      const arr = [1, 3, 16];
      const inserter = createItemInserter(arr, 1);

      expect(inserter([5])).to.deep.equal([1, 5, 3, 16]);
      expect(inserter([28, 42])).to.deep.equal([1, 28, 42, 3, 16]);
    });
  });

  describe("#deepEqual", () => {
    it("reports different types as unequal", () => {
      deepEqual("a", true).should.equal(false);
      deepEqual("a", [1, 2]).should.equal(false);
      deepEqual({ a: 1 }, [1, 2]).should.equal(false);
    });

    it("correctly checks arrays", () => {
      deepEqual(["a"], ["a"]).should.equal(true);
      deepEqual(["a"], ["aasd"]).should.equal(false);

      deepEqual([1, 2], [3, 4]).should.equal(false);
    });

    it("correctly checks arrays of objects", () => {
      deepEqual(
        [{ a: 1, b: 3 }, { c: ["sixteen"] }],
        [{ a: 1, b: 3 }, { c: ["sixteen"] }]
      ).should.equal(true);

      deepEqual(
        [{ a: 1, b: 3 }, { c: ["sixteen"] }],
        [{ c: ["sixteen"] }, { a: 1, b: 3 }]
      ).should.equal(false);

      deepEqual(
        [{ a: 1, b: 3 }, { c: ["sixteen"] }],
        [{ a: 1, b: 3 }, { c: ["sixteen", "seventeen"] }]
      ).should.equal(false);
      deepEqual(
        [{ a: 1, b: 3 }, { c: ["sixteen"] }],
        [{ a: 1, b: 3 }, { c: ["Sixteen"] }]
      ).should.equal(false);
    });

    it("correctly checks nested objects", () => {
      deepEqual(
        { a: [1, 2, 3], b: { c: 1, d: "foo", e: { baz: "bar" } } },
        { a: [1, 2, 3], b: { c: 1, d: "foo", e: { baz: "bar" } } }
      ).should.equal(true);

      deepEqual(
        { a: [1, 2, 3], b: { c: 1, d: "foo", e: { baz: "bar" } } },
        { a: [1, 2, 3], b: { c: 2, d: "foo", e: { baz: "bar" } } }
      ).should.equal(false);
      deepEqual(
        { a: [1, 2, 3], b: { c: 1, d: "foo", e: { baz: "bar" } } },
        { a: [1, 2, 3], b: { c: 1, d: "foo", e: { baz: "Bar" } } }
      ).should.equal(false);
    });

    it("correctly checks Buffers", () => {
      deepEqual(Buffer.from("foo"), Buffer.from("foo")).should.equal(true);
      deepEqual(
        { a: Buffer.from("foo") },
        { a: Buffer.from("foo") }
      ).should.equal(true);

      const strings = ["bar", "foo", "something"];
      deepEqual(
        strings.map((s) => Buffer.from(s)),
        strings.map((s) => Buffer.from(s))
      ).should.equal(true);
    });
  });

  describe("safeRmRf", () => {
    beforeEach(async function () {
      this.tmpdir = await createTestTempDir();
    });

    afterEach(async function () {
      try {
        await safeRmRf(this.tmpdir);
      } catch (err) {
        testLogger.error(
          "Cleanup of %s failed with %s",
          this.tmpdir,
          err.toString()
        );
      }
    });

    it("removes a directory inside the temporary directory", async function () {
      const dir = join(this.tmpdir, "foo");
      await fsPromises.mkdir(dir);
      await safeRmRf(dir).should.be.fulfilled;

      await pathExists(dir).should.eventually.equal(undefined);
    });

    it("should reject removing a directory outside of the temporary prefix", async () => {
      await safeRmRf(
        "/foo/bar/baz/this/should/not/exist/at/all/"
      ).should.be.rejectedWith(Error); //.should.be.rejectedWith(Error, /will not remove anything outside of/i);
    });
  });

  describe("#getTmpPrefix", () => {
    beforeEach(function () {
      this.TMPDIR = process.env.TMPDIR;
    });
    afterEach(function () {
      process.env.TMPDIR = this.TMPDIR;
    });

    it("honors TMPDIR", () => {
      const tmpdir = "/opt/foo";
      process.env.TMPDIR = tmpdir;
      getTmpPrefix().should.include(tmpdir);
    });

    it("does uses the os' temporary directory if TMPDIR is unset", () => {
      process.env.TMPDIR = undefined;
      getTmpPrefix().should.include(tmpdir());
    });
  });

  describe("#safeUnlink", () => {
    beforeEach(() => mockFs({ dir: { file: "foo" } }));
    afterEach(mockFs.restore);

    it("does not fail if path is undefined", async () => {
      await safeUnlink(undefined).should.be.fulfilled;
    });

    it("does not fail if path does not exist", async () => {
      await safeUnlink("dir/not_existent").should.be.fulfilled;
    });

    it("unlinks a file", async () => {
      const path = "dir/file";
      await safeUnlink(path);
      expect(await pathExists(path)).to.equal(undefined);
    });

    it("does not unlink a directory", async () => {
      const path = "dir";
      await safeUnlink(path);
      await pathExists(path).should.eventually.not.equal(undefined);
    });
  });

  describe("#findRegexPositionInString", () => {
    it("returns undefined if the substring is not found", () => {
      expect(findRegexPositionInString("fooo", "bar")).to.equal(undefined);
    });

    it("finds the position if the substring is found", () => {
      const objs = [
        { foo: "bar", baz: [{ arr: 1 }] },
        { baz: [{ arr: 1 }], foo: "bar" }
      ].map((obj) => JSON.stringify(obj, undefined, 4));

      const positions = objs.map((obj) =>
        findRegexPositionInString(obj, /\"foo\":\s*\"bar\"/)
      );

      expect(positions[0]).to.not.equal(undefined);
      positions[0]?.line.should.equal(1);
      positions[0]?.character.should.equal(4);

      expect(positions[1]).to.not.equal(undefined);
      positions[1]?.line.should.equal(6);
      positions[1]?.character.should.equal(4);
    });
  });
});
