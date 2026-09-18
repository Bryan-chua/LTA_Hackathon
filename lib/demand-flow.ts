import type { CrowdingLevel, Journey, Scenario } from "./domain";

export type DemandProfile = "typical" | "surge" | "unavailable";
export const isDemandProfile = (value: unknown): value is DemandProfile =>
  value === "typical" || value === "surge" || value === "unavailable";

export interface DemandForecast {
  source: "synthetic-demand-replay";
  bucketStart: string;
  bucketEnd: string;
  corridor: string;
  baseline: number;
  externalSpillover: number;
  netAppShift: number;
  projectedPassengers: number;
  assumedCapacity: number;
  crowding: CrowdingLevel;
  addedDelayMinutes: number;
}

export interface DemandView {
  profile: DemandProfile;
  status: "replay" | "unavailable";
  asOf: string;
  assumptions: string;
}

// Demonstration assumptions, not fitted parameters or measured train capacity.
export const FOLLOW_THROUGH = 0.8;
export const REPLAY_TIME = "2026-09-18T07:30:00+08:00";

export function reliefTelJourney(journey: Journey): Journey {
  const tampinesInterchange = {
    name: "Tampines Bus Interchange", shortName: "Tampines Interchange",
    coordinate: { lng: 103.9434, lat: 1.3541 },
  };
  const marineParade = {
    name: "Marine Parade MRT", shortName: "Marine Parade",
    coordinate: { lng: 103.9046, lat: 1.3029 },
  };
  const shentonWay = {
    name: "Shenton Way MRT", shortName: "Shenton Way",
    coordinate: { lng: 103.8503, lat: 1.2777 },
  };
  return {
    ...journey,
    id: "relief-tel-route",
    name: "Bus 31 + Thomson-East Coast Line",
    departureAt: "2026-09-18T07:32:00+08:00",
    arrival: { p50: "08:40", earliest: "08:36", latest: "08:44" },
    legs: [
      {
        id: "relief-walk-start", sequence: 0, mode: "walk",
        from: journey.origin, to: tampinesInterchange,
        instruction: "Walk to Tampines Bus Interchange.",
        durationMinutes: 6, uncertaintyMinutes: 2,
        geometry: [journey.origin.coordinate, tampinesInterchange.coordinate],
      },
      {
        id: "relief-bus-31", sequence: 1, mode: "bus",
        from: tampinesInterchange, to: marineParade,
        lineId: "31", lineName: "Bus 31",
        instruction: "Take Bus 31 to Marine Parade MRT.",
        durationMinutes: 22, uncertaintyMinutes: 5, crowding: "moderate",
        geometry: [
          tampinesInterchange.coordinate,
          { lng: 103.9302, lat: 1.3354 },
          { lng: 103.9167, lat: 1.3185 },
          marineParade.coordinate,
        ],
      },
      {
        id: "relief-tel", sequence: 2, mode: "rail",
        from: marineParade, to: shentonWay,
        lineId: "TEL", lineName: "Thomson-East Coast Line",
        stationCodes: ["TE26", "TE19"],
        instruction: "Take the Thomson-East Coast Line towards Woodlands North and alight at Shenton Way.",
        durationMinutes: 18, uncertaintyMinutes: 4, crowding: "low",
        geometry: [
          marineParade.coordinate,
          { lng: 103.8862, lat: 1.2991 },
          { lng: 103.8634, lat: 1.2824 },
          shentonWay.coordinate,
        ],
      },
      {
        id: "relief-walk-end", sequence: 3, mode: "walk",
        from: shentonWay, to: journey.destination,
        instruction: "Walk from Shenton Way MRT to the office.",
        durationMinutes: 8, uncertaintyMinutes: 2,
        geometry: [shentonWay.coordinate, journey.destination.coordinate],
      },
    ],
  };
}

const shiftClock = (clock: string, minutes: number) => {
  const [hour, minute] = clock.split(":").map(Number);
  const total = (hour * 60 + minute + minutes) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

// Corridor boardings per five-minute entry window, not train occupancy/platform density.
function bucketFor(journey: Journey) {
  const railIndex = journey.legs.findIndex(({ mode }) => mode === "rail");
  if (railIndex < 0) return undefined;
  const rail = journey.legs[railIndex];
  const minutesBeforeRail = journey.legs.slice(0, railIndex).reduce((sum, leg) => sum + leg.durationMinutes, 0);
  const entry = Date.parse(journey.departureAt) + minutesBeforeRail * 60_000;
  const start = Math.floor(entry / 300_000) * 300_000;
  return {
    bucketStart: new Date(start).toISOString(),
    bucketEnd: new Date(start + 300_000).toISOString(),
    corridor: `${rail.lineId}: ${rail.from.shortName} → ${rail.to.shortName}`,
  };
}

export function projectDemand(
  journeys: Journey[],
  scenario: Scenario,
  profile: DemandProfile,
  // One latest accepted route per consenting browser in this scenario/profile.
  selections: readonly string[] = [],
): { journeys: Journey[]; demand: DemandView } {
  const demand: DemandView = {
    profile,
    status: profile === "unavailable" ? "unavailable" : "replay",
    asOf: REPLAY_TIME,
    assumptions: "Synthetic baseline and capacity; 80% of accepted demo routes assumed to be followed. No population extrapolation or calibrated accuracy claim.",
  };
  if (profile === "unavailable") return { journeys, demand };

  const regular = journeys.find(({ id }) => id === "recommended-dtl-route");
  const relief = regular ? reliefTelJourney(regular) : undefined;
  const catalog = [...journeys, ...(relief ? [relief] : [])];
  const knownIds = new Set(catalog.map(({ id }) => id));
  // Bound the demo cohort so it cannot exceed the synthetic EWL baseline population.
  const accepted = selections.filter((id) => knownIds.has(id)).slice(0, 250);
  const seeded = scenario.id === "ewl-disruption" && profile === "surge" ? 400 : 0;
  const shiftCount = seeded + accepted.filter((id) => id !== scenario.usualJourney.id).length;

  const enriched = catalog.map((journey): Journey => {
    const bucket = bucketFor(journey);
    if (!bucket) return journey;
    const usual = journey.id === scenario.usualJourney.id;
    const reliefRoute = journey.id === relief?.id;
    const baseline = usual ? 600 : reliefRoute ? 110 : 160;
    const externalSpillover = usual || scenario.id === "normal" ? 0 : reliefRoute ? 25 : 40;
    // Baseline already includes the cohort on EWL. Move, don't add, those commuters.
    const netAppShift = FOLLOW_THROUGH * (usual ? -shiftCount :
      accepted.filter((id) => id === journey.id).length + (journey.id === regular?.id ? seeded : 0));
    const assumedCapacity = usual ? (scenario.id === "normal" ? 1000 : 700) : 400;
    const projectedPassengers = Math.max(0, Math.round(baseline + externalSpillover + netAppShift));
    const ratio = projectedPassengers / assumedCapacity;
    const crowding: CrowdingLevel = journey.legs.some((leg) => leg.crowding === "high") || ratio >= 0.85
      ? "high" : ratio >= 0.5 ? "moderate" : "low";
    // Illustrative boarding delay. EWL's existing disruption ETA already includes its delay.
    const addedDelayMinutes = usual ? 0 : Math.min(15, Math.ceil(Math.max(0, ratio - 0.85) * 12));
    const forecast: DemandForecast = {
      source: "synthetic-demand-replay", ...bucket, baseline, externalSpillover,
      netAppShift: Math.round(netAppShift * 10) / 10, projectedPassengers,
      assumedCapacity, crowding, addedDelayMinutes,
    };
    return {
      ...journey,
      demandForecast: forecast,
      arrival: {
        p50: shiftClock(journey.arrival.p50, addedDelayMinutes),
        earliest: journey.arrival.earliest,
        latest: shiftClock(journey.arrival.latest, addedDelayMinutes * 2),
      },
      legs: journey.legs.map((leg) => leg.mode === "rail" ? {
        ...leg,
        crowding: leg.crowding === "high" ? "high" : crowding,
        durationMinutes: leg.durationMinutes + addedDelayMinutes,
      } : leg),
    };
  });
  const regularForecast = enriched.find(({ id }) => id === regular?.id)?.demandForecast;
  // Offer a genuinely different corridor when the usual DTL alternative is busy.
  // Retain it when a consenting browser has already selected it.
  const offerRelief = regularForecast?.crowding === "high" || accepted.includes("relief-tel-route");
  return { journeys: enriched.filter(({ id }) => id !== relief?.id || offerRelief), demand };
}
