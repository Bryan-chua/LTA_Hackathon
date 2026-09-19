import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Routine } from "../domain";
import { GoogleRoutesRoutingProvider, googleRoutesApiKey } from "./google-routes";

const originalFetch = globalThis.fetch;
const originalLiveEnabled = process.env.LIVE_PROVIDERS_ENABLED;
const originalApiKey = process.env.GOOGLE_MAPS_ROUTES_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env.LIVE_PROVIDERS_ENABLED = originalLiveEnabled;
  process.env.GOOGLE_MAPS_ROUTES_API_KEY = originalApiKey;
});
const routine: Routine = {
  id: "google-test",
  travellerName: "Rachel",
  origin: { name: "Home", shortName: "Home", coordinate: { lat: 1.3583, lng: 103.9466 } },
  destination: { name: "Office", shortName: "Office", coordinate: { lat: 1.2814, lng: 103.8507 } },
  departureTime: "07:40",
  arrivalDeadline: "08:45",
  weekdays: [1, 2, 3, 4, 5],
  enabled: true,
};

describe("Google Routes provider", () => {
  it("reads a server-side key when live providers are enabled", () => {
    process.env.LIVE_PROVIDERS_ENABLED = "true";
    process.env.GOOGLE_MAPS_ROUTES_API_KEY = "test-google-key";
    assert.equal(googleRoutesApiKey(), "test-google-key");
  });

  it("normalizes Google transit steps into journey legs", async () => {
    process.env.LIVE_PROVIDERS_ENABLED = "true";
    process.env.GOOGLE_MAPS_ROUTES_API_KEY = "test-google-key";
    globalThis.fetch = async (input, init) => {
      assert.equal(input, "https://routes.googleapis.com/directions/v2:computeRoutes");
      assert.equal(new Headers(init?.headers).get("X-Goog-Api-Key"), "test-google-key");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.travelMode, "TRANSIT");
      assert.equal(body.computeAlternativeRoutes, true);
      return Response.json({
        routes: [{
          duration: "1800s",
          legs: [{
            steps: [{
              staticDuration: "1200s",
              travelMode: "TRANSIT",
              startLocation: { latLng: { latitude: 1.353, longitude: 103.9451 } },
              endLocation: { latLng: { latitude: 1.284, longitude: 103.8519 } },
              polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq" + String.fromCharCode(96) + "@" },
              transitDetails: {
                stopDetails: {
                  departureStop: {
                    name: "Tampines MRT EW2",
                    location: { latLng: { latitude: 1.353, longitude: 103.9451 } },
                  },
                  arrivalStop: {
                    name: "Raffles Place MRT EW14",
                    location: { latLng: { latitude: 1.284, longitude: 103.8519 } },
                  },
                },
                transitLine: {
                  name: "East West Line",
                  nameShort: "EWL",
                  vehicle: { type: "SUBWAY" },
                },
              },
            }],
          }],
        }],
      });
    };

    const journeys = await new GoogleRoutesRoutingProvider().plan(
      routine,
      new Date("2026-09-21T22:00:00.000Z"),
    );

    assert.equal(journeys[0]?.source, "google");
    assert.equal(journeys[0]?.departureAt, "2026-09-21T23:40:00.000Z");
    assert.equal(journeys[0]?.legs[0]?.mode, "rail");
    assert.equal(journeys[0]?.legs[0]?.lineId, "EWL");
    assert.deepEqual(journeys[0]?.legs[0]?.stationCodes, ["EW2", "EW14"]);
    assert.equal(journeys[0]?.legs[0]?.durationMinutes, 20);
    assert.equal(journeys[0]?.legs[0]?.geometry.length, 3);
  });
});
