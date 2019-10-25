import { describe, it } from "mocha";
import { expect } from "chai";

import { setDifference } from "../../util";

describe("utilities", () => {
  describe("setDifference", () => {
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
});
