import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scenarios } from "./fixtures";
import { buildAlternatives, findAffectedSegments } from "./journey-engine";
import type { Journey, TravelCondition } from "./domain";

describe("journey engine", () => {
  it("does not flag a route without relevant conditions", () => {
    const scenario = scenarios.normal;
    assert.deepEqual(findAffectedSegments(scenario.usualJourney, scenario.conditions), []);
  });

  it("matches the replay disruption to the EWL leg", () => {
    const scenario = scenarios["ewl-disruption"];
    assert.deepEqual(findAffectedSegments(scenario.usualJourney, scenario.conditions), [
      {
        firstLegIndex: 1,
        lastLegIndex: 1,
        conditionIds: ["replay-ewl-2026-09-18"],
        geometryMatches: [{ legIndex: 1, sectionIndexes: [1] }],
      },
    ]);
  });

  it("normalises provider line and interchange station aliases", () => {
    const scenario = scenarios["ewl-disruption"];
    const condition: TravelCondition = {
      ...scenario.conditions[0],
      id: "alias-condition",
      lineIds: ["East-West Line"],
      stationCodes: ["EW 8 / CC9", "EW-13 / NS25"],
    };

    const matches = findAffectedSegments(scenario.usualJourney, [condition]);
    assert.deepEqual(matches[0]?.geometryMatches, [{ legIndex: 1, sectionIndexes: [1] }]);
  });

  it("ignores an event on an unrelated line", () => {
    const scenario = scenarios["ewl-disruption"];
    const condition: TravelCondition = {
      ...scenario.conditions[0],
      id: "dtl-only",
      lineIds: ["DTL"],
      stationCodes: ["DT21", "DT17"],
    };
    assert.deepEqual(findAffectedSegments(scenario.usualJourney, [condition]), []);
  });

  it("ignores an event that ends before the journey reaches the leg", () => {
    const scenario = scenarios["ewl-disruption"];
    const condition: TravelCondition = {
      ...scenario.conditions[0],
      id: "expired-event",
      validFrom: "2026-09-18T05:00:00+08:00",
      validTo: "2026-09-18T06:00:00+08:00",
    };
    assert.deepEqual(findAffectedSegments(scenario.usualJourney, [condition]), []);
  });

  it("merges adjacent affected legs while preserving their geometry matches", () => {
    const scenario = scenarios["ewl-disruption"];
    const railLeg = structuredClone(scenario.usualJourney.legs[1]);
    const journey: Journey = {
      ...scenario.usualJourney,
      id: "two-leg-ewl",
      legs: [
        { ...railLeg, id: "ewl-a", sequence: 0, durationMinutes: 10, geometrySections: undefined },
        { ...railLeg, id: "ewl-b", sequence: 1, durationMinutes: 10, geometrySections: undefined },
      ],
    };
    const condition: TravelCondition = {
      ...scenario.conditions[0],
      id: "line-wide-event",
      lineIds: ["EW"],
      stationCodes: undefined,
    };

    assert.deepEqual(findAffectedSegments(journey, [condition]), [
      {
        firstLegIndex: 0,
        lastLegIndex: 1,
        conditionIds: ["line-wide-event"],
        geometryMatches: [
          { legIndex: 0, sectionIndexes: [] },
          { legIndex: 1, sectionIndexes: [] },
        ],
      },
    ]);
  });

  it("ranks the viable alternative first", () => {
    const scenario = scenarios["ewl-disruption"];
    const options = buildAlternatives(
      scenario.usualJourney,
      scenario.recommendedJourney,
      scenario.routine.arrivalDeadline,
      scenario.conditions,
    );
    assert.equal(options[0].recommended, true);
    assert.ok(options[0].score < options[1].score);
  });
});
