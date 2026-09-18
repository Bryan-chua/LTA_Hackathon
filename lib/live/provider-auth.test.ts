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
  process.env.LIVE_PROVIDERS_ENABLED = originalLiveEnabled;
  process.env.ONEMAP_ACCESS_TOKEN = originalOneMapToken;
  process.env.LTA_DATAMALL_ACCOUNT_KEY = originalDataMallKey;
});

describe("live provider contracts", () => {
  it("reads the configured OneMap access token without password authentication", () => {
    process.env.LIVE_PROVIDERS_ENABLED = "true";
    process.env.ONEMAP_ACCESS_TOKEN = "current-token";
    assert.equal(oneMapToken(), "current-token");
  });

  it("accepts the current TrainServiceAlerts object envelope", async () => {
    process.env.LTA_DATAMALL_ACCOUNT_KEY = "test-key";
    globalThis.fetch = async () => Response.json({
      value: { Status: 1, AffectedSegments: [], Message: [{ Content: "Normal service" }] },
    });
    const result = await trainServiceConditions(new Date("2026-09-19T00:00:00.000Z"));
    assert.deepEqual(result.data, []);
  });

  it("normalizes nested PCDForecast station intervals", async () => {
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
});
