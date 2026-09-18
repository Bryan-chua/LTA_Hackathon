import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scenarios } from "./fixtures";
import { routineSchema } from "./routine-schema";

describe("routine validation", () => {
  it("accepts Rachel's device-owned routine and supplies defaults", () => {
    const parsed = routineSchema.parse(scenarios.normal.routine);
    assert.equal(parsed.timezone, "Asia/Singapore");
    assert.equal(parsed.materialDelayMinutes, 10);
  });

  it("rejects identical endpoints and deadlines before departure", () => {
    const base = scenarios.normal.routine;
    const parsed = routineSchema.safeParse({
      ...base,
      destination: base.origin,
      arrivalDeadline: "07:30",
    });
    assert.equal(parsed.success, false);
    if (!parsed.success) assert.equal(parsed.error.issues.length, 2);
  });
});
