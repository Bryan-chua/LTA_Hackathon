import type {
  CrowdingLevel,
  Journey,
  JourneyReliabilityForecast,
  ReliabilityReason,
  TravelCondition,
} from "./domain";
import { conditionsAffectingJourney } from "./condition-matching";

export const SYNTHETIC_RELIABILITY_MODEL_VERSION = "synthetic-gbt-v1";
export const RELIABILITY_FEATURE_SCHEMA_VERSION = "reliability-features-v1";

const crowdRank: Record<CrowdingLevel, number> = { unknown: 1, low: 0, moderate: 1, high: 2 };
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
const sigmoid = (value: number) => 1 / (1 + Math.exp(-value));

type SyntheticFeature = "deadlineMargin" | "intervalWidth" | "disruptionPenalty"
  | "crowdingPenalty" | "rainPenalty" | "transfers";
interface SyntheticTree { feature: SyntheticFeature; threshold: number; left: number; right: number }

// A deliberately small decision-stump ensemble for replay demonstrations. Its
// parameters are synthetic and are never presented as learned live performance.
export const SYNTHETIC_GBT_MODEL: Readonly<{ baseScore: number; trees: SyntheticTree[] }> = {
  baseScore: 0.2,
  trees: [
    { feature: "deadlineMargin", threshold: 0, left: -2, right: 0.5 },
    { feature: "deadlineMargin", threshold: 10, left: -0.4, right: 0.7 },
    { feature: "intervalWidth", threshold: 10, left: 0.3, right: -0.3 },
    { feature: "disruptionPenalty", threshold: 0.5, left: 0.4, right: -1.2 },
    { feature: "crowdingPenalty", threshold: 0.5, left: 0.15, right: -0.5 },
    { feature: "rainPenalty", threshold: 0.1, left: 0.1, right: -0.3 },
    { feature: "transfers", threshold: 1.5, left: 0.1, right: -0.2 },
  ],
};

const clockMinutes = (value: string) => {
  const time = value.includes("T") ? value.slice(11, 16) : value;
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

const clock = (minutes: number) => {
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
};

const transitLines = (journey: Journey) => new Set(
  journey.legs.flatMap((leg) => leg.lineId ? [leg.lineId.toUpperCase()] : []),
);

const relevantConditions = (journey: Journey, conditions: TravelCondition[]) => {
  const lines = transitLines(journey);
  const matched = new Set(conditionsAffectingJourney(journey, conditions).map((condition) => condition.id));
  return conditions.filter((condition) => {
    if (condition.coordinate || condition.modes?.length || condition.stationCodes?.length) return matched.has(condition.id);
    if (condition.kind === "weather") return journey.legs.some((leg) => leg.mode === "walk");
    if (!condition.lineIds?.length) return true;
    return condition.lineIds.some((line) => lines.has(line.toUpperCase()));
  });
};

const worstCrowding = (journey: Journey): CrowdingLevel => journey.legs
  .map((leg) => leg.crowding)
  .filter((value): value is CrowdingLevel => Boolean(value))
  .sort((left, right) => crowdRank[right] - crowdRank[left])[0] ?? "unknown";

function rankedReasons(journey: Journey, deadline: string, conditions: TravelCondition[]): ReliabilityReason[] {
  const relevant = relevantConditions(journey, conditions);
  const reasons: Array<ReliabilityReason & { magnitude: number }> = [];
  const disruption = relevant.find((condition) => condition.kind === "train_disruption" || condition.kind === "planned_work");
  if (disruption) reasons.push({
    code: disruption.kind === "planned_work" ? "planned_work" : "train_disruption",
    label: disruption.title,
    direction: "hurts",
    contribution: disruption.severity === "major" ? -1.35 : -0.75,
    magnitude: disruption.severity === "major" ? 1.35 : 0.75,
    source: disruption.source,
  });
  const crowding = worstCrowding(journey);
  if (crowding === "high" || crowding === "moderate") reasons.push({
    code: "station_crowding",
    label: `${crowding === "high" ? "High" : "Moderate"} station crowd forecast`,
    direction: "hurts",
    contribution: crowding === "high" ? -0.6 : -0.25,
    magnitude: crowding === "high" ? 0.6 : 0.25,
    source: "LTA station crowd density",
  });
  const rain = relevant.find((condition) => condition.kind === "weather");
  if (rain) reasons.push({
    code: "rain_walking_uncertainty",
    label: `${rain.title} adds walking uncertainty`,
    direction: "hurts",
    contribution: rain.severity === "major" ? -0.5 : -0.2,
    magnitude: rain.severity === "major" ? 0.5 : 0.2,
    source: rain.source,
  });
  const margin = clockMinutes(deadline) - clockMinutes(journey.arrival.p50);
  reasons.push({
    code: margin >= 0 ? "deadline_buffer" : "deadline_overrun",
    label: margin >= 0 ? `${margin} min expected deadline buffer` : `${Math.abs(margin)} min beyond the deadline`,
    direction: margin >= 0 ? "helps" : "hurts",
    contribution: clamp(margin / 15, -1.2, 1.2),
    magnitude: clamp(Math.abs(margin) / 15, 0.2, 1.2),
    source: "Journey timing",
  });
  return reasons.sort((left, right) => right.magnitude - left.magnitude)
    .slice(0, 3)
    .map(({ code, label, direction, contribution, source }) => ({ code, label, direction, contribution, source }));
}

function deterministicForecast(
  journey: Journey,
  deadline: string,
  conditions: TravelCondition[],
): JourneyReliabilityForecast {
  const crowdingKnown = journey.legs.filter((leg) => leg.mode === "rail").every((leg) => leg.crowding && leg.crowding !== "unknown");
  const providerStale = journey.provider?.staleAt ? Date.parse(journey.provider.staleAt) < Date.now() : false;
  return {
    method: "deterministic_fallback",
    synthetic: false,
    p50Arrival: journey.arrival.p50,
    likelyArrival: { from: journey.arrival.earliest, to: journey.arrival.latest },
    reasons: rankedReasons(journey, deadline, conditions),
    confidence: providerStale ? "low" : "medium",
    freshness: providerStale ? "stale" : journey.provider?.mode ?? "cached",
    dataCompleteness: crowdingKnown ? 1 : 0.8,
    fallbackReason: providerStale ? "stale_critical_data" : "model_unavailable",
  };
}

function syntheticForecast(
  journey: Journey,
  deadline: string,
  conditions: TravelCondition[],
): JourneyReliabilityForecast {
  const relevant = relevantConditions(journey, conditions);
  const p50 = clockMinutes(journey.arrival.p50);
  const earliest = clockMinutes(journey.arrival.earliest);
  const latest = clockMinutes(journey.arrival.latest);
  const margin = clockMinutes(deadline) - p50;
  const width = Math.max(1, latest - earliest);
  const disruptionPenalty = relevant.reduce((total, condition) => total + (
    condition.kind === "train_disruption" || condition.kind === "planned_work"
      ? condition.severity === "major" ? 1.35 : condition.severity === "minor" ? 0.75 : 0.3
      : 0
  ), 0);
  const crowd = worstCrowding(journey);
  const crowdPenalty = crowd === "high" ? 0.6 : crowd === "moderate" ? 0.25 : crowd === "unknown" ? 0.15 : 0;
  const walking = journey.legs.filter((leg) => leg.mode === "walk").reduce((sum, leg) => sum + leg.durationMinutes, 0);
  const rain = relevant.find((condition) => condition.kind === "weather");
  const rainPenalty = rain ? (rain.severity === "major" ? 0.5 : 0.2) * clamp(walking / 15, 0.3, 1.5) : 0;
  const transitLegs = journey.legs.filter((leg) => leg.mode === "rail" || leg.mode === "bus").length;
  const transferPenalty = Math.max(0, transitLegs - 1) * 0.2;
  const features: Record<SyntheticFeature, number> = {
    deadlineMargin: margin,
    intervalWidth: width,
    disruptionPenalty,
    crowdingPenalty: crowdPenalty,
    rainPenalty,
    transfers: Math.max(0, transitLegs - 1),
  };
  const logit = SYNTHETIC_GBT_MODEL.trees.reduce(
    (score, tree) => score + (features[tree.feature] < tree.threshold ? tree.left : tree.right),
    SYNTHETIC_GBT_MODEL.baseScore,
  ) - transferPenalty;
  const probability = Math.round(clamp(sigmoid(logit), 0.03, 0.98) * 100) / 100;
  const p90Minutes = Math.max(latest, p50 + Math.ceil(width * 0.65 + disruptionPenalty * 2 + rainPenalty * 2));
  return {
    method: "synthetic_model",
    modelVersion: SYNTHETIC_RELIABILITY_MODEL_VERSION,
    synthetic: true,
    probabilityBeforeDeadline: probability,
    p50Arrival: journey.arrival.p50,
    p90Arrival: clock(p90Minutes),
    likelyArrival: { from: journey.arrival.earliest, to: clock(p90Minutes) },
    reasons: rankedReasons(journey, deadline, conditions),
    confidence: "low",
    freshness: "replay",
    dataCompleteness: 1,
  };
}

export function forecastJourneyReliability(
  journey: Journey,
  deadline: string,
  conditions: TravelCondition[],
): JourneyReliabilityForecast {
  const replay = journey.source === "fixture" || (conditions.length > 0 && conditions.every((condition) => condition.isReplay));
  return replay ? syntheticForecast(journey, deadline, conditions) : deterministicForecast(journey, deadline, conditions);
}
