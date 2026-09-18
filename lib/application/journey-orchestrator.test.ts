import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JourneyNotFoundError, JourneyOrchestrator } from "./journey-orchestrator";

describe("journey orchestrator", () => {
  const orchestrator = new JourneyOrchestrator();

  it("plans the complete disruption view through the fixture provider", async () => {
    const plan = await orchestrator.plan({ scenarioId: "ewl-disruption" });

    assert.equal(plan.scenario.id, "ewl-disruption");
    assert.equal(plan.recommendation.kind, "change");
    assert.equal(plan.recommendation.journeyId, "recommended-dtl-route");
    assert.equal(plan.affectedSegments[0]?.firstLegIndex, 1);
    assert.equal(plan.alternatives[0]?.recommended, true);
  });

  it("keeps a normal morning quiet", async () => {
    const plan = await orchestrator.plan({ scenarioId: "normal" });

    assert.equal(plan.recommendation.kind, "on_track");
    assert.equal(plan.recommendation.journeyId, "usual-ewl-route");
    assert.deepEqual(plan.affectedSegments, []);
    assert.equal(plan.alternatives.length, 1);
  });

  it("rejects a journey that is not part of the scenario", async () => {
    await assert.rejects(
      orchestrator.evaluate("missing-journey", "normal"),
      JourneyNotFoundError,
    );
  });

  it("evaluates the selected journey rather than always using the usual route", async () => {
    const evaluation = await orchestrator.evaluate("recommended-dtl-route", "ewl-disruption");
    assert.deepEqual(evaluation.affectedSegments, []);
  });
});
