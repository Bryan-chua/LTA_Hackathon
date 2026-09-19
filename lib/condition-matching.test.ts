import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { conditionsAffectingJourney, findAffectedSegments } from "./condition-matching";
import type { Journey, TravelCondition } from "./domain";

const journey: Journey = {
  id: "spatial-test",
  name: "Spatial test",
  origin: { name: "Start", shortName: "Start", coordinate: { lat: 1.3000, lng: 103.8000 } },
  destination: { name: "End", shortName: "End", coordinate: { lat: 1.3100, lng: 103.8100 } },
  departureAt: "2026-09-19T08:00:00+08:00",
  arrival: { p50: "08:10", earliest: "08:08", latest: "08:12" },
  source: "onemap",
  generatedAt: "2026-09-19T00:00:00Z",
  legs: [{
    id: "bus-leg",
    sequence: 0,
    mode: "bus",
    from: { name: "Start", shortName: "Start", coordinate: { lat: 1.3000, lng: 103.8000 } },
    to: { name: "End", shortName: "End", coordinate: { lat: 1.3100, lng: 103.8100 } },
    instruction: "Take bus 10",
    lineId: "10",
    durationMinutes: 10,
    uncertaintyMinutes: 2,
    geometry: [{ lat: 1.3000, lng: 103.8000 }, { lat: 1.3100, lng: 103.8100 }],
  }],
};

const condition = (overrides: Partial<TravelCondition> = {}): TravelCondition => ({
  id: "incident",
  kind: "road_incident",
  severity: "minor",
  title: "Road incident",
  modes: ["bus"],
  coordinate: { lat: 1.3050, lng: 103.8050 },
  radiusMeters: 100,
  validFrom: "2026-09-19T07:55:00+08:00",
  validTo: "2026-09-19T08:20:00+08:00",
  source: "test",
  observedAt: "2026-09-19T07:55:00+08:00",
  isReplay: false,
  ...overrides,
});

describe("spatial condition matching", () => {
  it("matches a nearby road incident to the bus leg", () => {
    assert.equal(conditionsAffectingJourney(journey, [condition()]).length, 1);
    assert.deepEqual(findAffectedSegments(journey, [condition()]).map(({ firstLegIndex, lastLegIndex }) => ({ firstLegIndex, lastLegIndex })), [
      { firstLegIndex: 0, lastLegIndex: 0 },
    ]);
  });

  it("rejects a distant, wrong-mode, or expired condition", () => {
    assert.equal(conditionsAffectingJourney(journey, [condition({ coordinate: { lat: 1.35, lng: 103.85 } })]).length, 0);
    assert.equal(conditionsAffectingJourney(journey, [condition({ modes: ["walk"] })]).length, 0);
    assert.equal(conditionsAffectingJourney(journey, [condition({ validTo: "2026-09-19T07:00:00+08:00" })]).length, 0);
  });
});
