import type { Journey, Routine } from "../lib/domain";
import { crowdingForLine, trainServiceConditions } from "../lib/live/datamall";
import { OneMapRoutingProvider } from "../lib/live/onemap";
import { weatherConditions } from "../lib/live/weather";

const checkRoutine: Routine = {
  id: "provider-check",
  travellerName: "Provider check",
  origin: {
    name: "Tampines MRT",
    shortName: "Tampines",
    coordinate: { lat: 1.353, lng: 103.9451 },
  },
  destination: {
    name: "Raffles Place MRT",
    shortName: "Raffles Place",
    coordinate: { lat: 1.284, lng: 103.8519 },
  },
  departureTime: "08:00",
  arrivalDeadline: "09:30",
  weekdays: [1, 2, 3, 4, 5],
  enabled: true,
  timezone: "Asia/Singapore",
  materialDelayMinutes: 10,
};

const weatherJourney: Journey = {
  id: "provider-check-weather",
  name: "Weather provider check",
  origin: checkRoutine.origin,
  destination: checkRoutine.destination,
  departureAt: new Date().toISOString(),
  arrival: { p50: "08:30", earliest: "08:25", latest: "08:35" },
  source: "onemap",
  generatedAt: new Date().toISOString(),
  legs: [{
    id: "provider-check-walk",
    sequence: 0,
    mode: "walk",
    from: checkRoutine.origin,
    to: checkRoutine.destination,
    instruction: "Provider connectivity check.",
    durationMinutes: 5,
    uncertaintyMinutes: 1,
    geometry: [checkRoutine.origin.coordinate, checkRoutine.destination.coordinate],
  }],
};

async function main() {
  const checks = await Promise.allSettled([
    new OneMapRoutingProvider().plan(checkRoutine),
    trainServiceConditions(),
    crowdingForLine("EWL", "realtime"),
    weatherConditions([weatherJourney]),
  ]);
  const names = ["OneMap routing", "LTA train alerts", "LTA EWL crowding", "data.gov.sg weather"];
  let failed = false;

  checks.forEach((result, index) => {
    if (result.status === "fulfilled") {
      const value = result.value;
      const count = Array.isArray(value) ? value.length : value.data instanceof Map ? value.data.size : value.data.length;
      console.log(`OK ${names[index]} (${count} record${count === 1 ? "" : "s"})`);
      return;
    }
    failed = true;
    const message = result.reason instanceof Error ? result.reason.message : "Unknown provider error.";
    console.error(`FAILED ${names[index]}: ${message}`);
  });

  if (failed) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
