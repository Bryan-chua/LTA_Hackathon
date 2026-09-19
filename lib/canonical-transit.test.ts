import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalLineId, canonicalStationCodes } from "./canonical-transit";

describe("canonical transit identifiers", () => {
  it("maps common DataMall line aliases to one identifier", () => {
    assert.equal(canonicalLineId("EW"), "EWL");
    assert.equal(canonicalLineId("CGL"), "EWL");
    assert.equal(canonicalLineId("East-West Line"), "EWL");
    assert.equal(canonicalLineId("downtown line"), "DTL");
    assert.equal(canonicalLineId("STL"), "SKLRT");
    assert.equal(canonicalLineId("PLRT"), "PGLRT");
  });

  it("normalises station codes and expands interchange values", () => {
    assert.deepEqual(canonicalStationCodes([" EW 8 / CC9 ", "ew-13", "EW8"]), [
      "EW8",
      "CC9",
      "EW13",
    ]);
  });
});
