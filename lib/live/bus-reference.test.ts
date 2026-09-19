import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  __resetBusReferenceCacheForTests,
  busRoutes,
  busStops,
  matchBusLegStops,
  resolveBusLegStops,
  type BusRouteStop,
  type BusStopRecord,
} from "./bus-reference";

const originalFetch = globalThis.fetch;
const originalLiveEnabled = process.env.LIVE_PROVIDERS_ENABLED;
const originalDataMallKey = process.env.LTA_DATAMALL_ACCOUNT_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  __resetBusReferenceCacheForTests();
  if (originalLiveEnabled === undefined) delete process.env.LIVE_PROVIDERS_ENABLED;
  else process.env.LIVE_PROVIDERS_ENABLED = originalLiveEnabled;
  if (originalDataMallKey === undefined) delete process.env.LTA_DATAMALL_ACCOUNT_KEY;
  else process.env.LTA_DATAMALL_ACCOUNT_KEY = originalDataMallKey;
});

describe("bus stop matching", () => {
  const stopsByCode = new Map<string, BusStopRecord>([
    ["75009", { code: "75009", roadName: "Tampines Ave 5", description: "Tampines Bus Interchange", coordinate: { lat: 1.3541, lng: 103.9434 } }],
    ["76059", { code: "76059", roadName: "Tampines Ave 4", description: "Mid-route stop", coordinate: { lat: 1.34, lng: 103.92 } }],
    ["84009", { code: "84009", roadName: "Marine Parade Rd", description: "Marine Parade MRT", coordinate: { lat: 1.3029, lng: 103.9046 } }],
    ["84999", { code: "84999", roadName: "Elsewhere Rd", description: "Wrong-direction stop", coordinate: { lat: 1.36, lng: 103.99 } }],
  ]);

  const routeStops: BusRouteStop[] = [
    { serviceNo: "31", direction: 1, sequence: 1, stopCode: "75009" },
    { serviceNo: "31", direction: 1, sequence: 2, stopCode: "76059" },
    { serviceNo: "31", direction: 1, sequence: 3, stopCode: "84009" },
    // Opposite direction: same stops, reversed order, plus one stop only on this side.
    { serviceNo: "31", direction: 2, sequence: 1, stopCode: "84009" },
    { serviceNo: "31", direction: 2, sequence: 2, stopCode: "84999" },
    { serviceNo: "31", direction: 2, sequence: 3, stopCode: "75009" },
  ];

  it("resolves boarding and alighting stops in sequence order along the travel direction", () => {
    const match = matchBusLegStops(routeStops, stopsByCode, { lat: 1.3541, lng: 103.9434 }, { lat: 1.3029, lng: 103.9046 });
    assert.equal(match?.boardingStopCode, "75009");
    assert.equal(match?.alightingStopCode, "84009");
  });

  it("rejects a direction where the alighting stop precedes the boarding stop", () => {
    // Coordinates close to stops 84009 (board) then 75009 (alight) only line up on direction 2's
    // sequence, but direction 2 has 84009 before 75009, so the match must not pick direction 1.
    const match = matchBusLegStops(routeStops, stopsByCode, { lat: 1.3029, lng: 103.9046 }, { lat: 1.3541, lng: 103.9434 });
    assert.equal(match?.boardingStopCode, "84009");
    assert.equal(match?.alightingStopCode, "75009");
  });

  it("returns undefined when the service has no usable route stops", () => {
    const match = matchBusLegStops([], stopsByCode, { lat: 1.3541, lng: 103.9434 }, { lat: 1.3029, lng: 103.9046 });
    assert.equal(match, undefined);
  });

  it("returns undefined when route stops are missing coordinate reference data", () => {
    const match = matchBusLegStops(
      [{ serviceNo: "999", direction: 1, sequence: 1, stopCode: "unknown-a" }, { serviceNo: "999", direction: 1, sequence: 2, stopCode: "unknown-b" }],
      stopsByCode,
      { lat: 1.3541, lng: 103.9434 },
      { lat: 1.3029, lng: 103.9046 },
    );
    assert.equal(match, undefined);
  });
});

describe("bus reference provider contracts", () => {
  it("paginates BusStops until a short page signals the end", async () => {
    process.env.LIVE_PROVIDERS_ENABLED = "true";
    process.env.LTA_DATAMALL_ACCOUNT_KEY = "test-key";
    const requested: string[] = [];
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      requested.push(url.searchParams.get("$skip") ?? "0");
      if (url.searchParams.get("$skip") === "0") {
        return Response.json({ value: Array.from({ length: 500 }, (_, index) => ({
          BusStopCode: String(10_000 + index), RoadName: "Road", Description: "Stop", Latitude: 1.3, Longitude: 103.8,
        })) });
      }
      return Response.json({ value: [{ BusStopCode: "99999", RoadName: "Road", Description: "Last stop", Latitude: 1.31, Longitude: 103.81 }] });
    };
    const result = await busStops(new Date("2026-09-19T00:00:00.000Z"));
    assert.equal(requested.length, 2);
    assert.equal(result.data.size, 501);
    assert.equal(result.data.get("99999")?.description, "Last stop");
  });

  it("groups BusRoutes rows by service number", async () => {
    process.env.LIVE_PROVIDERS_ENABLED = "true";
    process.env.LTA_DATAMALL_ACCOUNT_KEY = "test-key";
    globalThis.fetch = async () => Response.json({
      value: [
        { ServiceNo: "31", Direction: 1, StopSequence: 1, BusStopCode: "75009" },
        { ServiceNo: "31", Direction: 1, StopSequence: 2, BusStopCode: "84009" },
        { ServiceNo: "15", Direction: 1, StopSequence: 1, BusStopCode: "75009" },
      ],
    });
    const result = await busRoutes(new Date("2026-09-19T00:00:00.000Z"));
    assert.equal(result.data.get("31")?.length, 2);
    assert.equal(result.data.get("15")?.length, 1);
  });

  it("resolves a bus leg end to end from live-shaped reference payloads", async () => {
    process.env.LIVE_PROVIDERS_ENABLED = "true";
    process.env.LTA_DATAMALL_ACCOUNT_KEY = "test-key";
    let call = 0;
    globalThis.fetch = async (input) => {
      call += 1;
      const url = new URL(String(input));
      if (url.pathname.endsWith("BusRoutes")) {
        return Response.json({ value: [
          { ServiceNo: "83", Direction: 1, StopSequence: 1, BusStopCode: "A1" },
          { ServiceNo: "83", Direction: 1, StopSequence: 2, BusStopCode: "A2" },
        ] });
      }
      return Response.json({ value: [
        { BusStopCode: "A1", RoadName: "Road A", Description: "Start", Latitude: 1.35, Longitude: 103.94 },
        { BusStopCode: "A2", RoadName: "Road B", Description: "End", Latitude: 1.30, Longitude: 103.90 },
      ] });
    };
    const match = await resolveBusLegStops("83", { lat: 1.351, lng: 103.941 }, { lat: 1.301, lng: 103.901 }, new Date("2026-09-19T01:00:00.000Z"));
    assert.equal(match?.boardingStopCode, "A1");
    assert.equal(match?.alightingStopCode, "A2");
    assert.ok(call >= 2);
  });

  it("returns undefined rather than throwing when the service has no known route", async () => {
    process.env.LIVE_PROVIDERS_ENABLED = "true";
    process.env.LTA_DATAMALL_ACCOUNT_KEY = "test-key";
    globalThis.fetch = async () => Response.json({ value: [] });
    const match = await resolveBusLegStops("404", { lat: 1.35, lng: 103.94 }, { lat: 1.30, lng: 103.90 }, new Date("2026-09-19T02:00:00.000Z"));
    assert.equal(match, undefined);
  });
});
