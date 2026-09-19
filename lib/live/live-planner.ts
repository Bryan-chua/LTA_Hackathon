import type { CrowdingLevel, Journey, ProviderMetadata, Routine, Scenario, TravelCondition, TravelMode } from "../domain";
import { buildAlternatives } from "../journey-engine";
import { buildRecommendation, scoreWeightsFor } from "../application/journey-orchestrator";
import type { JourneyPlanView, ProviderStateView } from "../application/journey-view-model";
import { conditionsAffectingJourney, findAffectedSegments } from "../condition-matching";
import { OneMapRoutingProvider } from "./onemap";
import { GoogleRoutesRoutingProvider } from "./google-routes";
import { ProviderError } from "../provider-contracts";
import { crowdingForLine, trainServiceConditions } from "./datamall";
import { enrichBusLegs } from "./bus-enrichment";
import { weatherConditions } from "./weather";
import { facilityMaintenanceConditions, floodAlertConditions, trafficIncidentConditions } from "./lta-conditions";
import { trainTripUpdateConditions } from "./gtfs-train";

const crowdRank: Record<CrowdingLevel, number> = { unknown: 0, low: 1, moderate: 2, high: 3 };
const worst = (levels: CrowdingLevel[]) => levels.sort((a, b) => crowdRank[b] - crowdRank[a])[0] ?? "unknown";

const providerView = (metadata: ProviderMetadata, status: ProviderStateView["status"] = "available"): ProviderStateView => ({
  name: metadata.source,
  status,
  mode: metadata.mode,
  fetchedAt: metadata.fetchedAt,
  staleAt: metadata.staleAt,
  warnings: metadata.warnings,
});

const failedProvider = (name: string, error: unknown, critical = false): ProviderStateView => ({
  name,
  status: critical ? "unavailable" : "degraded",
  mode: "live",
  fetchedAt: new Date().toISOString(),
  warnings: [error instanceof Error ? error.message : `${name} unavailable.`],
});

const clockWithMinutes = (value: string, addedMinutes: number) => {
  const [hours, minutes] = value.split(":").map(Number);
  const total = ((hours * 60 + minutes + addedMinutes) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

const uncertaintyFor = (condition: TravelCondition, travelMode: TravelMode | undefined) => {
  if (condition.kind === "weather") return 0;
  if (condition.kind === "facility_maintenance" && travelMode !== "accessible") return 0;
  if (condition.expectedDelayMinutes !== undefined) return condition.expectedDelayMinutes;
  if (condition.kind === "flood") return condition.severity === "major" ? 10 : condition.severity === "minor" ? 4 : 2;
  if (condition.kind === "road_incident") return condition.severity === "major" ? 8 : condition.severity === "minor" ? 3 : 1;
  if (condition.kind === "facility_maintenance") return 12;
  return condition.severity === "major" ? 10 : condition.severity === "minor" ? 4 : 1;
};

function applyLiveConditionImpacts(
  journeys: Journey[],
  conditions: TravelCondition[],
  travelMode: TravelMode | undefined,
): Journey[] {
  return journeys.map((journey) => {
    const relevant = conditionsAffectingJourney(journey, conditions)
      .filter((condition) => uncertaintyFor(condition, travelMode) > 0);
    if (relevant.length === 0) return journey;
    const uncertaintyAdded = Math.min(20, relevant.reduce((total, condition) => total + uncertaintyFor(condition, travelMode), 0));
    const expectedDelay = Math.min(20, Math.max(0, ...relevant.map((condition) => condition.expectedDelayMinutes ?? 0)));
    const affected = findAffectedSegments(journey, relevant);
    const impactedLegs = new Set(affected.flatMap(({ firstLegIndex, lastLegIndex }) =>
      Array.from({ length: lastLegIndex - firstLegIndex + 1 }, (_, index) => firstLegIndex + index)));
    return {
      ...journey,
      arrival: {
        p50: clockWithMinutes(journey.arrival.p50, expectedDelay),
        earliest: journey.arrival.earliest,
        latest: clockWithMinutes(journey.arrival.latest, uncertaintyAdded),
      },
      legs: journey.legs.map((leg, index) => impactedLegs.has(index)
        ? { ...leg, uncertaintyMinutes: leg.uncertaintyMinutes + uncertaintyAdded }
        : leg),
    };
  });
}

async function enrichCrowding(journeys: Journey[], now: Date): Promise<{ journeys: Journey[]; providers: ProviderStateView[] }> {
  const lines = [...new Set(journeys.flatMap((journey) => journey.legs.flatMap((leg) => leg.mode === "rail" && leg.lineId ? [leg.lineId] : [])))];
  const mode = journeys.some((journey) => Date.parse(journey.departureAt) - now.getTime() <= 15 * 60_000) ? "realtime" : "forecast";
  const results = await Promise.allSettled(lines.map((line) => crowdingForLine(line, mode, now)));
  const byLine = new Map<string, Map<string, CrowdingLevel>>();
  const providers: ProviderStateView[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      byLine.set(lines[index], result.value.data);
      providers.push(providerView(result.value.metadata));
    } else providers.push(failedProvider(`LTA crowding ${lines[index]}`, result.reason));
  });
  return {
    providers,
    journeys: journeys.map((journey) => ({
      ...journey,
      legs: journey.legs.map((leg) => {
        if (leg.mode !== "rail" || !leg.lineId) return leg;
        const values = leg.stationCodes?.map((station) => byLine.get(leg.lineId!)?.get(station.toUpperCase()) ?? "unknown") ?? ["unknown"];
        return { ...leg, crowding: worst(values) };
      }),
    })),
  };
}

export async function planLiveJourney(routine: Routine, now = new Date(), travelMode?: TravelMode): Promise<JourneyPlanView> {
  const googleKey = process.env.GOOGLE_MAPS_ROUTES_API_KEY?.trim() || process.env.GOOGLE_MAPS_API_KEY?.trim();
  const routingProvider = process.env.ROUTING_PROVIDER?.trim().toLowerCase()
    || (!process.env.ONEMAP_ACCESS_TOKEN?.trim() && googleKey ? "google" : "onemap");
  if (routingProvider !== "onemap" && routingProvider !== "google") {
    throw new ProviderError("Routing", "configuration", "ROUTING_PROVIDER must be 'onemap' or 'google'.");
  }
  const routing = routingProvider === "google" ? new GoogleRoutesRoutingProvider() : new OneMapRoutingProvider();
  const journeys = await routing.plan(routine);
  const conditionChecks = await Promise.allSettled([
    trainServiceConditions(now),
    trainTripUpdateConditions(now),
    weatherConditions(journeys, now),
    trafficIncidentConditions(now),
    floodAlertConditions(now),
    facilityMaintenanceConditions(now),
  ]);
  const conditions: TravelCondition[] = [];
  const providers: ProviderStateView[] = [providerView(journeys[0].provider!)];
  const conditionNames = [
    "LTA TrainServiceAlerts",
    "LTA GTFS train trip updates",
    "data.gov.sg forecast + rainfall",
    "LTA TrafficIncidents",
    "LTA PubFloodAlerts",
    "LTA FacilitiesMaintenance",
  ];
  conditionChecks.forEach((result, index) => {
    if (result.status === "fulfilled") {
      conditions.push(...result.value.data);
      providers.push(providerView(result.value.metadata));
    } else providers.push(failedProvider(conditionNames[index], result.reason, index === 0));
  });

  const crowded = await enrichCrowding(journeys, now);
  providers.push(...crowded.providers);
  const bused = await enrichBusLegs(crowded.journeys, now);
  providers.push(...bused.providers);
  const relevantConditions = conditions.filter((condition) =>
    bused.journeys.some((journey) => conditionsAffectingJourney(journey, [condition]).length > 0));
  const impacted = applyLiveConditionImpacts(bused.journeys, relevantConditions, travelMode);
  const [usual, ...candidates] = impacted;
  const alternatives = buildAlternatives(usual, candidates, routine.arrivalDeadline, relevantConditions, scoreWeightsFor(travelMode));
  const selected = alternatives.find((alternative) => alternative.recommended)?.journey;
  const scenario: Scenario = {
    id: "normal",
    label: "Live commute check",
    isReplay: false,
    routine,
    usualJourney: usual,
    recommendedJourney: selected?.id === usual.id ? undefined : selected,
    conditions: relevantConditions,
    updatedAt: new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", hour: "2-digit", minute: "2-digit", hour12: false }).format(now),
  };
  return {
    scenario,
    scenarioId: scenario.id,
    journeyId: usual.id,
    affectedSegments: findAffectedSegments(usual, relevantConditions),
    alternatives,
    recommendation: buildRecommendation(scenario, alternatives),
    dataMode: "live",
    providers,
  };
}
