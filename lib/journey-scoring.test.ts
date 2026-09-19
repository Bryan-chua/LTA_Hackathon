import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { JourneyScoreWeights } from "./journey-scoring";
import { ACCESSIBLE_SCORE_WEIGHTS, RACHEL_SCORE_WEIGHTS, scoreJourneyCandidates } from "./journey-scoring";
import { bus31TelDelayedJourney, bus31TelJourney, bus31TelUnavailableJourney, scenarios } from "./fixtures";
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

    assert.ok(Math.abs(Object.values(RACHEL_SCORE_WEIGHTS).reduce((sum, value) => sum + value, 0) - 1) < 1e-9);
    assert.equal(options[0].journey.id, "recommended-dtl-route");
    assert.equal(options[0].score, 21);
    assert.equal(options[1].journey.id, "usual-ewl-route-affected");
    assert.equal(options[1].score, 68);
    assert.equal(options[0].reliability.method, "synthetic_model");
    assert.ok(options[0].reliability.probabilityBeforeDeadline);
  });

  it("returns an inspectable nine-component breakdown", () => {
    const scenario = scenarios["ewl-disruption"];
    const [recommended] = scoreJourneyCandidates(
      scenario.usualJourney,
      scenario.recommendedJourney,
      scenario.routine.arrivalDeadline,
      scenario.conditions,
    );

    assert.equal(recommended.scoreBreakdown.components.length, 9);
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
      busWaitPenalty: 0,
      busLoadPenalty: 0,
    };
    const options = scoreJourneyCandidates(
      scenario.usualJourney,
      scenario.recommendedJourney,
      scenario.routine.arrivalDeadline,
      scenario.conditions,
      deadlineOnly,
    );

    assert.ok(options[0].score < options[1].score);
    assert.equal(options[0].scoreBreakdown.components.filter(({ weight }) => weight > 0).length, 1);
  });
});

describe("bus wait and load scoring", () => {
  const dtl = scenarios["ewl-disruption"].recommendedJourney!;

  it("scores a fast, low-load next bus with favourable bus-specific components", () => {
    const [best, other] = scoreJourneyCandidates(dtl, bus31TelJourney, "08:45", []);
    const bus = [best, other].find((option) => option.journey.id === bus31TelJourney.id)!;
    const busWait = bus.scoreBreakdown.components.find(({ key }) => key === "busWaitPenalty");
    const busLoad = bus.scoreBreakdown.components.find(({ key }) => key === "busLoadPenalty");

    assert.equal(busWait?.valueLabel, "3 min bus wait");
    assert.equal(busWait?.normalized, 0.2);
    assert.equal(busLoad?.valueLabel, "Seats available");
    assert.equal(busLoad?.normalized, 0.1);
    assert.ok(bus.reliability.probabilityBeforeDeadline !== undefined);
  });

  it("penalizes a delayed, high-load bus enough that it loses to another option", () => {
    const options = scoreJourneyCandidates(dtl, bus31TelDelayedJourney, "08:45", []);
    const bus = options.find((option) => option.journey.id === bus31TelDelayedJourney.id)!;
    const rail = options.find((option) => option.journey.id === dtl.id)!;
    const busWait = bus.scoreBreakdown.components.find(({ key }) => key === "busWaitPenalty");
    const busLoad = bus.scoreBreakdown.components.find(({ key }) => key === "busLoadPenalty");

    assert.equal(busWait?.valueLabel, "19 min bus wait");
    assert.equal(busWait?.normalized, 1);
    assert.equal(busLoad?.valueLabel, "Limited standing");
    assert.equal(busLoad?.normalized, 1);
    assert.equal(bus.recommended, false);
    assert.equal(rail.recommended, true);
    assert.ok(bus.score > rail.score, "the delayed, crowded bus option must score worse than the rail alternative");
  });

  it("treats missing bus arrival data as unavailable, not a favourable ETA or load", () => {
    const options = scoreJourneyCandidates(dtl, bus31TelUnavailableJourney, "08:45", []);
    const bus = options.find((option) => option.journey.id === bus31TelUnavailableJourney.id)!;
    const busWait = bus.scoreBreakdown.components.find(({ key }) => key === "busWaitPenalty");
    const busLoad = bus.scoreBreakdown.components.find(({ key }) => key === "busLoadPenalty");

    assert.equal(busWait?.valueLabel, "Bus ETA unavailable");
    assert.equal(busLoad?.valueLabel, "Bus load unavailable");
    // Unavailable data must land strictly between a good and a bad reading, never at the good end.
    assert.ok(busWait!.normalized > 0.2 && busWait!.normalized < 1);
    assert.ok(busLoad!.normalized > 0.1 && busLoad!.normalized < 1);
  });

  it("never folds a bus leg's crowding field into the MRT crowding component", () => {
    const busLegWithStationCrowding: typeof bus31TelJourney = {
      ...bus31TelJourney,
      legs: bus31TelJourney.legs.map((leg) => leg.mode === "bus" ? { ...leg, crowding: "high" } : leg),
    };
    const options = scoreJourneyCandidates(dtl, busLegWithStationCrowding, "08:45", []);
    const busOption = options.find((option) => option.journey.id === busLegWithStationCrowding.id)!;
    const crowding = busOption.scoreBreakdown.components.find(({ key }) => key === "crowdingPenalty");
    // The journey's rail leg (TEL) is fixtured as "moderate"; the bus leg's forced "high"
    // crowding value must never leak into this MRT-only component.
    assert.equal(crowding?.valueLabel, "Moderate");
  });

  it("gives a journey without any bus leg a neutral bus score", () => {
    const [recommended] = scoreJourneyCandidates(dtl, undefined, "08:45", []);
    const busWait = recommended.scoreBreakdown.components.find(({ key }) => key === "busWaitPenalty");
    const busLoad = recommended.scoreBreakdown.components.find(({ key }) => key === "busLoadPenalty");
    assert.equal(busWait?.normalized, 0);
    assert.equal(busLoad?.normalized, 0);
  });
});

describe("accessible travel mode weights", () => {
  it("sums to 1, like every other weight configuration", () => {
    const total = Object.values(ACCESSIBLE_SCORE_WEIGHTS).reduce((sum, value) => sum + value, 0);
    assert.ok(Math.abs(total - 1) < 1e-9);
  });

  it("weights transfers and walking more heavily than the standard weights", () => {
    assert.ok(ACCESSIBLE_SCORE_WEIGHTS.transferPenalty > RACHEL_SCORE_WEIGHTS.transferPenalty);
    assert.ok(ACCESSIBLE_SCORE_WEIGHTS.walkingAndRainPenalty > RACHEL_SCORE_WEIGHTS.walkingAndRainPenalty);
  });

  it("never invents an accessibility signal: it only reweights already-measured factors", () => {
    // Same set of factors as standard mode — accessible mode must not add a fabricated
    // "accessibility score" component, since no verified accessibility data exists.
    assert.deepEqual(Object.keys(ACCESSIBLE_SCORE_WEIGHTS).sort(), Object.keys(RACHEL_SCORE_WEIGHTS).sort());
  });
});
