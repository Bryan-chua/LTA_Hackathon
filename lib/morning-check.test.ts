import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { journeyOrchestrator } from "./application/journey-orchestrator";
import { decideMorningCheck, nextCheckAt } from "./morning-check";
import { scenarios } from "./fixtures";

describe("morning-check policy", () => {
  it("stays quiet for a normal commute", async () => {
    const plan = await journeyOrchestrator.plan({ scenarioId: "normal" });
    const decision = decideMorningCheck("device", "v1", scenarios.normal.routine, plan);
    assert.equal(decision.result, "no_action");
    assert.deepEqual(decision.reasonCodes, []);
  });

  it("alerts for the replay disruption and produces a stable fingerprint", async () => {
    const plan = await journeyOrchestrator.plan({ scenarioId: "ewl-disruption" });
    const first = decideMorningCheck("device", "v1", scenarios["ewl-disruption"].routine, plan);
    const retry = decideMorningCheck("device", "v1", scenarios["ewl-disruption"].routine, plan);
    assert.equal(first.result, "action_required");
    assert.ok(first.reasonCodes.includes("major_event"));
    assert.equal(first.fingerprint, retry.fingerprint);
  });

  it("emits one recovery result after an earlier action", async () => {
    const plan = await journeyOrchestrator.plan({ scenarioId: "normal" });
    const decision = decideMorningCheck("device", "v1", scenarios.normal.routine, plan, true);
    assert.equal(decision.result, "recovery");
  });

  it("schedules the next weekday lead-time check in Singapore time", () => {
    const next = nextCheckAt(new Date("2026-09-21T22:00:00.000Z"), [1, 2, 3, 4, 5], "07:40");
    assert.equal(next.toISOString(), "2026-09-21T23:10:00.000Z");
  });
});

  it("schedules one final pre-departure verification after the 15-minute check", () => {
    const next = nextCheckAt(new Date("2026-09-21T23:26:00.000Z"), [1, 2, 3, 4, 5], "07:40");
    assert.equal(next.toISOString(), "2026-09-21T23:35:00.000Z");
  });
