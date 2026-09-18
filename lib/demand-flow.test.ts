import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { projectDemand } from "./demand-flow";
import { scenarios } from "./fixtures";
import { JourneyOrchestrator } from "./application/journey-orchestrator";
import { scoreJourneyCandidates } from "./journey-scoring";

const scenario = scenarios["ewl-disruption"];
const routes = [scenario.usualJourney, scenario.recommendedJourney!];

describe("demand projection", () => {
  it("selects one stable winner when scores tie", () => {
    const usual = scenarios.normal.usualJourney;
    const tied = scoreJourneyCandidates(usual, [{ ...usual, id: "same-cost-alternative" }], "08:45", [], {
      deadlineRisk: 1, expectedArrivalPenalty: 0, uncertaintyPenalty: 0, transferPenalty: 0,
      walkingAndRainPenalty: 0, crowdingPenalty: 0, routeChangePenalty: 0,
    });
    assert.equal(tied.filter((option) => option.recommended).length, 1);
    assert.equal(tied.find((option) => option.recommended)!.journey.id, usual.id);
  });

  it("moves accepted users between corridors instead of double-counting the baseline", () => {
    const before = projectDemand(routes, scenario, "typical");
    const after = projectDemand(routes, scenario, "typical", Array(10).fill("recommended-dtl-route"));
    assert.equal(after.journeys[0].demandForecast!.netAppShift, -8);
    assert.equal(after.journeys[1].demandForecast!.netAppShift, 8);
    const total = (value: typeof before) => value.journeys.reduce((sum, item) => sum + item.demandForecast!.projectedPassengers, 0);
    assert.equal(total(before), total(after));
    assert.equal(after.journeys[0].legs[1].crowding, "high", "a disruption warning cannot be erased by demand shifting");
  });

  it("offers a distinct relief corridor when the regular DTL route surges", () => {
    const result = projectDemand(routes, scenario, "surge");
    const regular = result.journeys.find(({ id }) => id === "recommended-dtl-route")!;
    const relief = result.journeys.find(({ id }) => id === "relief-tel-route")!;
    assert.notEqual(regular.demandForecast!.corridor, relief.demandForecast!.corridor);
    assert.equal(regular.demandForecast!.crowding, "high");
    assert.equal(relief.demandForecast!.crowding, "low");
    assert.equal(regular.demandForecast!.projectedPassengers, 520);
    assert.equal(regular.arrival.p50, "08:48");
  });

  it("falls back without changing source journeys when forecasts are unavailable", () => {
    const original = JSON.stringify(routes);
    const result = projectDemand(routes, scenario, "unavailable");
    assert.equal(result.demand.status, "unavailable");
    assert.deepEqual(result.journeys, routes);
    projectDemand(routes, scenario, "surge");
    assert.equal(JSON.stringify(routes), original);
  });

  it("ignores unknown routes and caps the demo cohort without negative demand", () => {
    const result = projectDemand(routes, scenario, "surge", [...Array(1000).fill("recommended-dtl-route"), "bogus"]);
    assert.equal(result.journeys[0].demandForecast!.projectedPassengers, 80);
    assert.equal(result.journeys[1].demandForecast!.netAppShift, 520);
  });

  it("makes the recommendation respond to demand and exposes the explanation", async () => {
    const orchestrator = new JourneyOrchestrator();
    const typical = await orchestrator.plan({ demand: { profile: "typical", selections: [] } });
    const surge = await orchestrator.plan({ demand: { profile: "surge", selections: [] } });
    assert.equal(typical.recommendation.journeyId, "recommended-dtl-route");
    assert.equal(surge.recommendation.journeyId, "relief-tel-route");
    assert.equal(surge.scenario.recommendedJourney!.id, surge.recommendation.journeyId);
    assert.equal(surge.alternatives.filter(({ recommended }) => recommended).length, 1);
    assert.match(surge.recommendation.reason, /crowded/);
    assert.equal(surge.scenario.recommendedJourney!.arrival.latest, "08:44");
    const compare = await orchestrator.compare("relief-tel-route", "ewl-disruption", { profile: "surge", selections: [] });
    assert.equal(compare.alternatives.length, 3);
  });

  it("does not invent a disruption or an alternative for a normal morning", async () => {
    const plan = await new JourneyOrchestrator().plan({ scenarioId: "normal", demand: { profile: "surge", selections: [] } });
    assert.equal(plan.recommendation.kind, "on_track");
    assert.equal(plan.alternatives.length, 1);
  });
});
