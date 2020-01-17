import mockFs = require("mock-fs");

import { expect, should } from "chai";
import { existsSync } from "fs";
import { afterEach, beforeEach, describe, it, xit } from "mocha";
import { assert, stub } from "sinon";
import {
  deepCopyProperties,
  loadMapFromMemento,
  rmRf,
  saveMapToMemento,
  setDifference
} from "../../util";

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
        "fooDir/testFile": "It's something",
        "fooDir/foo/bar/baz": "nested",
        "fooDir/dturinae/asdf": "something",
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
        someValues: [1, 2, 890, 3, "baz"],
        someObj: {
          hello: "world",
          aArray: [16, 28]
        }
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
});
