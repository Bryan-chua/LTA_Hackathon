import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scenarios } from "./fixtures";
import { forecastJourneyReliability, SYNTHETIC_RELIABILITY_MODEL_VERSION } from "./reliability-forecast";

describe("Personalised Journey Reliability Forecast", () => {
  it("produces explicitly synthetic probability and quantiles for replay", () => {
    const scenario = scenarios["ewl-disruption"];
    const forecast = forecastJourneyReliability(
      scenario.usualJourney,
      scenario.routine.arrivalDeadline,
      scenario.conditions,
    );

    assert.equal(forecast.method, "synthetic_model");
    assert.equal(forecast.synthetic, true);
    assert.equal(forecast.modelVersion, SYNTHETIC_RELIABILITY_MODEL_VERSION);
    assert.ok((forecast.probabilityBeforeDeadline ?? 0) > 0);
    assert.ok((forecast.probabilityBeforeDeadline ?? 1) < 1);
    assert.ok(forecast.p90Arrival);
    assert.equal(forecast.confidence, "low");
    assert.equal(forecast.freshness, "replay");
  });

  it("penalises the disrupted route relative to the unaffected replay alternative", () => {
    const scenario = scenarios["ewl-disruption"];
    const usual = forecastJourneyReliability(scenario.usualJourney, scenario.routine.arrivalDeadline, scenario.conditions);
    const alternative = forecastJourneyReliability(scenario.recommendedJourney!, scenario.routine.arrivalDeadline, scenario.conditions);
    assert.ok((alternative.probabilityBeforeDeadline ?? 0) > (usual.probabilityBeforeDeadline ?? 1));
    assert.ok(usual.reasons.some((reason) => reason.code === "train_disruption"));
  });

  it("falls back without a numeric probability for non-fixture journeys", () => {
    const scenario = scenarios.normal;
    const liveJourney = { ...scenario.usualJourney, source: "onemap" as const, provider: {
      source: "OneMap",
      mode: "live" as const,
      fetchedAt: new Date().toISOString(),
      staleAt: new Date(Date.now() + 60_000).toISOString(),
      warnings: [],
    } };
    const forecast = forecastJourneyReliability(liveJourney, scenario.routine.arrivalDeadline, []);
    assert.equal(forecast.method, "deterministic_fallback");
    assert.equal(forecast.probabilityBeforeDeadline, undefined);
    assert.equal(forecast.fallbackReason, "model_unavailable");
  });
});
