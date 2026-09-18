import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { JourneyScoreWeights } from "./journey-scoring";
import { RACHEL_SCORE_WEIGHTS, scoreJourneyCandidates } from "./journey-scoring";
import { scenarios } from "./fixtures";
import type { TravelCondition } from "./domain";

describe("journey scoring", () => {
  it("uses Rachel's documented weights and ranks the DTL route first", () => {
    const scenario = scenarios["ewl-disruption"];
    const options = scoreJourneyCandidates(
      scenario.usualJourney,
      scenario.recommendedJourney,
      scenario.routine.arrivalDeadline,
      scenario.conditions,
    );

    assert.equal(Object.values(RACHEL_SCORE_WEIGHTS).reduce((sum, value) => sum + value, 0), 1);
    assert.equal(options[0].journey.id, "recommended-dtl-route");
    assert.equal(options[0].score, 19);
    assert.equal(options[1].journey.id, "usual-ewl-route-affected");
    assert.equal(options[1].score, 75);
  });

  it("returns an inspectable seven-component breakdown", () => {
    const scenario = scenarios["ewl-disruption"];
    const [recommended] = scoreJourneyCandidates(
      scenario.usualJourney,
      scenario.recommendedJourney,
      scenario.routine.arrivalDeadline,
      scenario.conditions,
    );

    assert.equal(recommended.scoreBreakdown.components.length, 7);
    assert.equal(recommended.scoreBreakdown.lowerIsBetter, true);
    for (const item of recommended.scoreBreakdown.components) {
      assert.ok(item.normalized >= 0 && item.normalized <= 1);
      assert.ok(item.weightedPoints >= 0);
      assert.ok(item.valueLabel.length > 0);
    }
  });

  it("increases walking exposure when rain is active", () => {
    const scenario = scenarios["ewl-disruption"];
    const rain: TravelCondition = {
      id: "heavy-rain",
      kind: "weather",
      severity: "major",
      title: "Heavy rain",
      validFrom: "2026-09-18T07:00:00+08:00",
      validTo: "2026-09-18T09:00:00+08:00",
      source: "fixture",
      observedAt: "2026-09-18T07:20:00+08:00",
      isReplay: true,
    };
    const [recommended] = scoreJourneyCandidates(
      scenario.usualJourney,
      scenario.recommendedJourney,
      scenario.routine.arrivalDeadline,
      [...scenario.conditions, rain],
    );
    const walking = recommended.scoreBreakdown.components.find(
      ({ key }) => key === "walkingAndRainPenalty",
    );

    assert.equal(walking?.valueLabel, "24 min rain-adjusted");
    assert.equal(walking?.normalized, 0.8);
  });

  it("accepts an alternative weight configuration", () => {
    const scenario = scenarios["ewl-disruption"];
    const deadlineOnly: JourneyScoreWeights = {
      deadlineRisk: 1,
      expectedArrivalPenalty: 0,
      uncertaintyPenalty: 0,
      transferPenalty: 0,
      walkingAndRainPenalty: 0,
      crowdingPenalty: 0,
      routeChangePenalty: 0,
    };
    const options = scoreJourneyCandidates(
      scenario.usualJourney,
      scenario.recommendedJourney,
      scenario.routine.arrivalDeadline,
      scenario.conditions,
      deadlineOnly,
    );

    assert.equal(options[0].score, 13);
    assert.equal(options[1].score, 100);
  });
});
