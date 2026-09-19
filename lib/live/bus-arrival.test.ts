import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { __resetBusArrivalCacheForTests, busArrivalsForStops, etaMinutesFromNow } from "./bus-arrival";

const originalFetch = globalThis.fetch;
const originalLiveEnabled = process.env.LIVE_PROVIDERS_ENABLED;
const originalDataMallKey = process.env.LTA_DATAMALL_ACCOUNT_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  __resetBusArrivalCacheForTests();
  if (originalLiveEnabled === undefined) delete process.env.LIVE_PROVIDERS_ENABLED;
  else process.env.LIVE_PROVIDERS_ENABLED = originalLiveEnabled;
  if (originalDataMallKey === undefined) delete process.env.LTA_DATAMALL_ACCOUNT_KEY;
  else process.env.LTA_DATAMALL_ACCOUNT_KEY = originalDataMallKey;
});

describe("etaMinutesFromNow", () => {
  const now = new Date("2026-09-19T00:00:00.000Z");

  it("converts a future EstimatedArrival into whole minutes", () => {
    assert.equal(etaMinutesFromNow("2026-09-19T00:05:00.000Z", now), 5);
  });

  it("treats a missing EstimatedArrival as undefined rather than zero", () => {
    assert.equal(etaMinutesFromNow(undefined, now), undefined);
    assert.equal(etaMinutesFromNow("", now), undefined);
  });

  it("treats an unparseable value as undefined", () => {
    assert.equal(etaMinutesFromNow("not-a-date", now), undefined);
  });

  it("clamps a slightly-past estimate to zero minutes instead of negative", () => {
    assert.equal(etaMinutesFromNow("2026-09-18T23:59:30.000Z", now), 0);
  });

  it("treats an estimate more than two minutes stale as unavailable", () => {
    assert.equal(etaMinutesFromNow("2026-09-18T23:57:00.000Z", now), undefined);
  });
});

describe("v3/BusArrival provider contract", () => {
  it("parses ServiceNo, NextBus.EstimatedArrival, and NextBus.Load", async () => {
    process.env.LIVE_PROVIDERS_ENABLED = "true";
    process.env.LTA_DATAMALL_ACCOUNT_KEY = "test-key";
    globalThis.fetch = async () => Response.json({
      BusStopCode: "75009",
      Services: [
        { ServiceNo: "31", NextBus: { EstimatedArrival: "2026-09-19T00:03:00.000Z", Load: "SEA", Feature: "WAB" } },
        { ServiceNo: "15", NextBus: { EstimatedArrival: "2026-09-19T00:10:00.000Z", Load: "LSD" } },
      ],
    });
    const result = await busArrivalsForStops(["75009"], new Date("2026-09-19T00:00:00.000Z"));
    const stop = result.get("75009");
    assert.equal(stop?.status, "fulfilled");
    if (stop?.status !== "fulfilled") throw new Error("expected fulfilled result");
    assert.equal(stop.value.data.get("31")?.estimatedArrival, "2026-09-19T00:03:00.000Z");
    assert.equal(stop.value.data.get("31")?.load, "SEA");
    assert.equal(stop.value.data.get("31")?.wheelchairAccessible, true);
    assert.equal(stop.value.data.get("15")?.load, "LSD");
  });

  it("only requests the distinct stop codes it was given, not every stop", async () => {
    process.env.LIVE_PROVIDERS_ENABLED = "true";
    process.env.LTA_DATAMALL_ACCOUNT_KEY = "test-key";
    const requested: string[] = [];
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      requested.push(url.searchParams.get("BusStopCode")!);
      return Response.json({ BusStopCode: url.searchParams.get("BusStopCode"), Services: [] });
    };
    await busArrivalsForStops(["75009", "84009", "75009"], new Date("2026-09-19T00:00:00.000Z"));
    assert.deepEqual([...new Set(requested)].sort(), ["75009", "84009"]);
    assert.equal(requested.length, 2);
  });

  it("drops a Load value outside the documented SEA/SDA/LSD codes", async () => {
    process.env.LIVE_PROVIDERS_ENABLED = "true";
    process.env.LTA_DATAMALL_ACCOUNT_KEY = "test-key";
    globalThis.fetch = async () => Response.json({
      BusStopCode: "75009",
      Services: [{ ServiceNo: "31", NextBus: { EstimatedArrival: "2026-09-19T00:03:00.000Z", Load: "" } }],
    });
    const result = await busArrivalsForStops(["75009"], new Date("2026-09-19T00:00:00.000Z"));
    const stop = result.get("75009");
    if (stop?.status !== "fulfilled") throw new Error("expected fulfilled result");
    assert.equal(stop.value.data.get("31")?.load, undefined);
  });

  it("reports a stop as rejected, not silently empty, when the provider call fails", async () => {
    process.env.LIVE_PROVIDERS_ENABLED = "true";
    process.env.LTA_DATAMALL_ACCOUNT_KEY = "test-key";
    globalThis.fetch = async () => new Response("Internal error", { status: 500 });
    const result = await busArrivalsForStops(["75009"], new Date("2026-09-19T00:00:00.000Z"));
    const stop = result.get("75009");
    assert.equal(stop?.status, "rejected");
  });

  it("resolves an unaffected stop even when a sibling stop's request fails", async () => {
    process.env.LIVE_PROVIDERS_ENABLED = "true";
    process.env.LTA_DATAMALL_ACCOUNT_KEY = "test-key";
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get("BusStopCode") === "bad-stop") return new Response("nope", { status: 500 });
      return Response.json({ BusStopCode: "good-stop", Services: [{ ServiceNo: "31", NextBus: { EstimatedArrival: "2026-09-19T00:02:00.000Z", Load: "SDA" } }] });
    };
    const result = await busArrivalsForStops(["good-stop", "bad-stop"], new Date("2026-09-19T00:00:00.000Z"));
    assert.equal(result.get("bad-stop")?.status, "rejected");
    const good = result.get("good-stop");
    if (good?.status !== "fulfilled") throw new Error("expected fulfilled result");
    assert.equal(good.value.data.get("31")?.load, "SDA");
  });

  it("rejects an invalid response shape rather than returning empty data", async () => {
    process.env.LIVE_PROVIDERS_ENABLED = "true";
    process.env.LTA_DATAMALL_ACCOUNT_KEY = "test-key";
    globalThis.fetch = async () => Response.json({ unexpected: true });
    const result = await busArrivalsForStops(["75009"], new Date("2026-09-19T00:00:00.000Z"));
    assert.equal(result.get("75009")?.status, "rejected");
  });
});
