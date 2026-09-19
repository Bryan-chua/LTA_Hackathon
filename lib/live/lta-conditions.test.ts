import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { facilityMaintenanceConditions, floodAlertConditions, trafficIncidentConditions } from "./lta-conditions";

const originalFetch = globalThis.fetch;
const originalLiveEnabled = process.env.LIVE_PROVIDERS_ENABLED;
const originalDataMallKey = process.env.LTA_DATAMALL_ACCOUNT_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalLiveEnabled === undefined) delete process.env.LIVE_PROVIDERS_ENABLED;
  else process.env.LIVE_PROVIDERS_ENABLED = originalLiveEnabled;
  if (originalDataMallKey === undefined) delete process.env.LTA_DATAMALL_ACCOUNT_KEY;
  else process.env.LTA_DATAMALL_ACCOUNT_KEY = originalDataMallKey;
});

const enable = () => {
  process.env.LIVE_PROVIDERS_ENABLED = "true";
  process.env.LTA_DATAMALL_ACCOUNT_KEY = "test-key";
};

describe("LTA commuter condition providers", () => {
  it("normalizes spatial traffic incidents", async () => {
    enable();
    globalThis.fetch = async () => Response.json({ value: [{
      Type: "Road Block", Latitude: 1.305, Longitude: 103.805, Message: "Road block near test route.",
    }] });
    const result = await trafficIncidentConditions(new Date("2026-09-19T00:00:00Z"));
    assert.equal(result.data[0]?.kind, "road_incident");
    assert.equal(result.data[0]?.severity, "major");
    assert.deepEqual(result.data[0]?.modes, ["bus", "cycle"]);
    assert.deepEqual(result.data[0]?.coordinate, { lat: 1.305, lng: 103.805 });
  });

  it("normalizes station lift maintenance without inventing step-free coverage", async () => {
    enable();
    globalThis.fetch = async () => Response.json({ value: [{
      Line: "DTL", StationCode: "DT10", StationName: "Stevens", LiftID: "B3L02", LiftDesc: "Exit A to platform",
    }] });
    const result = await facilityMaintenanceConditions(new Date("2026-09-19T00:00:00Z"));
    assert.equal(result.data[0]?.kind, "facility_maintenance");
    assert.deepEqual(result.data[0]?.lineIds, ["DTL"]);
    assert.deepEqual(result.data[0]?.stationCodes, ["DT10"]);
  });

  it("parses active flood circles and ignores cancellation records", async () => {
    enable();
    globalThis.fetch = async () => Response.json({ value: [
      { alertId: "active", dateTime: "2026-09-19T08:00:00+08:00", msgType: "Alert", severity: "Severe", expires: "2026-09-19T09:00:00+08:00", headline: "Flash Flood Alert", description: "Avoid the area", circle: "1.35479,103.88611 0.05", status: "Actual" },
      { alertId: "cancelled", dateTime: "2026-09-19T08:00:00+08:00", msgType: "Cancel", severity: "Minor", expires: "2026-09-19T09:00:00+08:00", headline: "Cancelled", circle: "1.3,103.8 0.1", status: "Actual" },
    ] });
    const result = await floodAlertConditions(new Date("2026-09-19T00:00:00Z"));
    assert.equal(result.data.length, 1);
    assert.equal(result.data[0]?.kind, "flood");
    assert.equal(result.data[0]?.radiusMeters, 250);
    assert.equal(result.data[0]?.severity, "major");
  });
});
