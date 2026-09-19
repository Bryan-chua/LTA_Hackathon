import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { crowdingForLine, trainServiceConditions } from "./datamall";
import { oneMapToken } from "./onemap";

const originalFetch = globalThis.fetch;
const originalLiveEnabled = process.env.LIVE_PROVIDERS_ENABLED;
const originalOneMapToken = process.env.ONEMAP_ACCESS_TOKEN;
const originalDataMallKey = process.env.LTA_DATAMALL_ACCOUNT_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalLiveEnabled === undefined) delete process.env.LIVE_PROVIDERS_ENABLED;
  else process.env.LIVE_PROVIDERS_ENABLED = originalLiveEnabled;
  if (originalOneMapToken === undefined) delete process.env.ONEMAP_ACCESS_TOKEN;
  else process.env.ONEMAP_ACCESS_TOKEN = originalOneMapToken;
  if (originalDataMallKey === undefined) delete process.env.LTA_DATAMALL_ACCOUNT_KEY;
  else process.env.LTA_DATAMALL_ACCOUNT_KEY = originalDataMallKey;
});

describe("live provider contracts", () => {
  it("reads the configured OneMap access token without password authentication", async () => {
    process.env.LIVE_PROVIDERS_ENABLED = "true";
    process.env.ONEMAP_ACCESS_TOKEN = "current-token";
    assert.equal(await oneMapToken(), "current-token");
  });

  it("accepts the current TrainServiceAlerts object envelope", async () => {
    process.env.LIVE_PROVIDERS_ENABLED = "true";
    process.env.LTA_DATAMALL_ACCOUNT_KEY = "test-key";
    globalThis.fetch = async () => Response.json({
      value: { Status: 1, AffectedSegments: [], Message: [{ Content: "Normal service" }] },
    });
    const result = await trainServiceConditions(new Date("2026-09-19T00:00:00.000Z"));
    assert.deepEqual(result.data, []);
  });

  it("normalizes nested PCDForecast station intervals", async () => {
    process.env.LIVE_PROVIDERS_ENABLED = "true";
    process.env.LTA_DATAMALL_ACCOUNT_KEY = "test-key";
    globalThis.fetch = async () => Response.json({
      value: [{
        Date: "2026-09-19T00:00:00+08:00",
        Stations: [{
          Station: "EW1",
          Interval: [{ Start: "2026-09-19T08:00:00+08:00", CrowdLevel: "h" }],
        }],
      }],
    });
    const result = await crowdingForLine("EWL", "forecast", new Date("2026-09-19T00:05:00.000Z"));
    assert.equal(result.data.get("EW1"), "high");
  });

  it("uses the crowd-density line code for Sengkang LRT", async () => {
    process.env.LIVE_PROVIDERS_ENABLED = "true";
    process.env.LTA_DATAMALL_ACCOUNT_KEY = "test-key";
    let requested = "";
    globalThis.fetch = async (input) => {
      requested = String(input);
      return Response.json({ value: [] });
    };
    await crowdingForLine("STL", "realtime", new Date("2026-09-19T00:05:00.000Z"));
    assert.equal(new URL(requested).searchParams.get("TrainLine"), "SLRT");
  });
});
