import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Journey } from "../domain";
import { weatherConditions } from "./weather";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const journey: Journey = {
  id: "weather-test",
  name: "Weather test",
  origin: { name: "Tampines", shortName: "Tampines", coordinate: { lat: 1.3443, lng: 103.9441 } },
  destination: { name: "Nearby", shortName: "Nearby", coordinate: { lat: 1.3450, lng: 103.9450 } },
  departureAt: "2026-09-19T08:00:00+08:00",
  arrival: { p50: "08:10", earliest: "08:08", latest: "08:12" },
  source: "onemap",
  generatedAt: "2026-09-19T00:00:00Z",
  legs: [{
    id: "walk", sequence: 0, mode: "walk",
    from: { name: "Tampines", shortName: "Tampines", coordinate: { lat: 1.3443, lng: 103.9441 } },
    to: { name: "Nearby", shortName: "Nearby", coordinate: { lat: 1.3450, lng: 103.9450 } },
    instruction: "Walk", durationMinutes: 10, uncertaintyMinutes: 2,
    geometry: [{ lat: 1.3443, lng: 103.9441 }, { lat: 1.3450, lng: 103.9450 }],
  }],
};

describe("data.gov.sg weather aggregation", () => {
  it("combines the area forecast with observed rainfall near a walking leg", async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("rainfall")) return Response.json({ data: {
        stations: [{ id: "S84", name: "Tampines Avenue 5", location: { latitude: 1.3443, longitude: 103.9441 } }],
        readings: [{ timestamp: "2026-09-19T08:00:00+08:00", data: [{ stationId: "S84", value: 6 }] }],
        readingUnit: "mm",
      } });
      return Response.json({ data: {
        area_metadata: [{ name: "Tampines", label_location: { latitude: 1.3496, longitude: 103.9568 } }],
        items: [{ updateTimestamp: "2026-09-19T07:55:00+08:00", validPeriod: { start: "2026-09-19T08:00:00+08:00", end: "2026-09-19T10:00:00+08:00" }, forecasts: [{ area: "Tampines", forecast: "Thundery Showers" }] }],
      } });
    };
    const result = await weatherConditions([journey], new Date("2026-09-19T00:00:00Z"));
    assert.equal(result.data.length, 2);
    assert.ok(result.data.some((condition) => condition.source === "data.gov.sg rainfall" && condition.severity === "major"));
    assert.ok(result.data.every((condition) => condition.modes?.includes("walk")));
  });
});
