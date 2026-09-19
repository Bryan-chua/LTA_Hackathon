import type { CrowdingLevel, Journey, ProviderMetadata, Routine, Scenario, TravelCondition, TravelMode } from "../domain";
import { buildAlternatives, findAffectedSegments } from "../journey-engine";
import { buildRecommendation, scoreWeightsFor } from "../application/journey-orchestrator";
import type { JourneyPlanView, ProviderStateView } from "../application/journey-view-model";
import { OneMapRoutingProvider } from "./onemap";
import { GoogleRoutesRoutingProvider } from "./google-routes";
import { ProviderError } from "../provider-contracts";
import { crowdingForLine, trainServiceConditions } from "./datamall";
import { enrichBusLegs } from "./bus-enrichment";
import { weatherConditions } from "./weather";

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
  const routingProvider = process.env.ROUTING_PROVIDER?.trim().toLowerCase() ?? "onemap";
  if (routingProvider !== "onemap" && routingProvider !== "google") {
    throw new ProviderError("Routing", "configuration", "ROUTING_PROVIDER must be 'onemap' or 'google'.");
  }
  const routing = routingProvider === "google" ? new GoogleRoutesRoutingProvider() : new OneMapRoutingProvider();
  const journeys = await routing.plan(routine);
  const [alerts, weather] = await Promise.allSettled([trainServiceConditions(now), weatherConditions(journeys, now)]);
  const conditions: TravelCondition[] = [];
  const providers: ProviderStateView[] = [providerView(journeys[0].provider!)];

  if (alerts.status === "fulfilled") {
    conditions.push(...alerts.value.data);
    providers.push(providerView(alerts.value.metadata));
  } else providers.push(failedProvider("LTA TrainServiceAlerts", alerts.reason, true));

  if (weather.status === "fulfilled") {
    conditions.push(...weather.value.data);
    providers.push(providerView(weather.value.metadata));
  } else providers.push(failedProvider("data.gov.sg weather", weather.reason));

  const crowded = await enrichCrowding(journeys, now);
  providers.push(...crowded.providers);
  const bused = await enrichBusLegs(crowded.journeys, now);
  providers.push(...bused.providers);
  const [usual, ...candidates] = bused.journeys;
  const alternatives = buildAlternatives(usual, candidates, routine.arrivalDeadline, conditions, scoreWeightsFor(travelMode));
  const selected = alternatives.find((alternative) => alternative.recommended)?.journey;
  const scenario: Scenario = {
    id: "normal",
    label: "Live commute check",
    isReplay: false,
    routine,
    usualJourney: usual,
    recommendedJourney: selected?.id === usual.id ? undefined : selected,
    conditions,
    updatedAt: new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", hour: "2-digit", minute: "2-digit", hour12: false }).format(now),
  };
  return {
    scenario,
    scenarioId: scenario.id,
    journeyId: usual.id,
    affectedSegments: findAffectedSegments(usual, conditions),
    alternatives,
    recommendation: buildRecommendation(scenario, alternatives),
    dataMode: "live",
    providers,
  };
}
