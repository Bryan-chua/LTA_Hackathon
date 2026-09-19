import type {
  Alternative,
  BusLoadCode,
  CrowdingLevel,
  Journey,
  JourneyReliabilityForecast,
  ScoreBreakdown,
  ScoreComponentDetail,
  ScoreComponentKey,
  TravelCondition,
} from "./domain";
import { forecastJourneyReliability } from "./reliability-forecast";

export type JourneyScoreWeights = Record<ScoreComponentKey, number>;

export const RACHEL_SCORE_WEIGHTS: Readonly<JourneyScoreWeights> = {
  deadlineRisk: 0.40,
  expectedArrivalPenalty: 0.20,
  uncertaintyPenalty: 0.12,
  transferPenalty: 0.08,
  walkingAndRainPenalty: 0.05,
  crowdingPenalty: 0.04,
  routeChangePenalty: 0.03,
  busWaitPenalty: 0.05,
  busLoadPenalty: 0.03,
};

// Accessible travel mode has no verified step-free, lift, or wheelchair-accessible-bus
// data source (see lib/domain.ts BusArrivalInfo and WRITEUP.md). Rather than invent an
// accessibility score from data we don't have, this weighting leans harder on the two
// already-measured signals that matter most when a route isn't known to be step-free:
// transfers and walking distance. It does not filter or rank by accessibility itself.
export const ACCESSIBLE_SCORE_WEIGHTS: Readonly<JourneyScoreWeights> = {
  deadlineRisk: 0.28,
  expectedArrivalPenalty: 0.14,
  uncertaintyPenalty: 0.08,
  transferPenalty: 0.20,
  walkingAndRainPenalty: 0.15,
  crowdingPenalty: 0.05,
  routeChangePenalty: 0.03,
  busWaitPenalty: 0.04,
  busLoadPenalty: 0.03,
};

interface ScoreContext {
  deadline: string;
  baselineJourney: Journey;
  bestArrivalMinutes: number;
  conditions: TravelCondition[];
}

interface CandidateMetrics {
  walkingMinutes: number;
  effectiveWalkingMinutes: number;
  transfers: number;
  crowding: CrowdingLevel;
  arrivalDelayMinutes: number;
  uncertaintyMinutes: number;
  deadlineRiskMinutes: number;
  routeChangeLabel: string;
}

interface PenaltyPoint {
  normalized: number;
  label: string;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number, precision = 1) => {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
};

export function minutesSinceMidnight(value: string): number {
  const time = value.includes("T") ? value.slice(11, 16) : value;
  const [hours, minutes] = time.split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    throw new Error(`Expected a clock time or ISO date-time, received '${value}'.`);
  }
  return hours * 60 + minutes;
}

const intervalWidth = (earliest: string, latest: string) => {
  const start = minutesSinceMidnight(earliest);
  const end = minutesSinceMidnight(latest);
  return end >= start ? end - start : end + 24 * 60 - start;
};

const countTransfers = (journey: Journey) => {
  const transitLegs = journey.legs.filter((leg) => leg.mode === "rail" || leg.mode === "bus");
  return Math.max(0, transitLegs.length - 1);
};

const countWalkingMinutes = (journey: Journey) =>
  journey.legs
    .filter((leg) => leg.mode === "walk")
    .reduce((total, leg) => total + leg.durationMinutes, 0);

const crowdingValues: Record<CrowdingLevel, number> = {
  low: 0.1,
  moderate: 0.5,
  high: 1,
  unknown: 0.6,
};

// Rail-only: bus vehicle load is a distinct signal (see busLoadValues) and must never
// be reported as MRT station crowding.
const worstCrowding = (journey: Journey): CrowdingLevel => {
  const levels = journey.legs
    .filter((leg) => leg.mode === "rail")
    .map((leg) => leg.crowding)
    .filter((level): level is CrowdingLevel => Boolean(level));
  return levels.sort((left, right) => crowdingValues[right] - crowdingValues[left])[0] ?? "unknown";
};

const busLoadValues: Record<BusLoadCode | "unavailable", number> = {
  SEA: 0.1,
  SDA: 0.5,
  LSD: 1,
  unavailable: 0.6,
};

const busLoadLabel: Record<BusLoadCode, string> = {
  SEA: "Seats available",
  SDA: "Standing available",
  LSD: "Limited standing",
};

const busLegsOf = (journey: Journey) => journey.legs.filter((leg) => leg.mode === "bus");

// Longer than a 15-minute wait is treated as the worst case rather than scaling forever.
const BUS_WAIT_CEILING_MINUTES = 15;

function worstBusWait(journey: Journey): PenaltyPoint {
  const legs = busLegsOf(journey);
  if (legs.length === 0) return { normalized: 0, label: "No bus leg" };
  const points = legs.map((leg): PenaltyPoint => {
    const arrival = leg.busArrival;
    if (!arrival || arrival.status !== "available" || arrival.etaMinutes === undefined) {
      return { normalized: 0.6, label: "Bus ETA unavailable" };
    }
    return { normalized: clamp(arrival.etaMinutes / BUS_WAIT_CEILING_MINUTES), label: `${arrival.etaMinutes} min bus wait` };
  });
  return points.sort((left, right) => right.normalized - left.normalized)[0];
}

function worstBusLoad(journey: Journey): PenaltyPoint {
  const legs = busLegsOf(journey);
  if (legs.length === 0) return { normalized: 0, label: "No bus leg" };
  const points = legs.map((leg): PenaltyPoint => {
    const arrival = leg.busArrival;
    if (!arrival || arrival.status !== "available" || !arrival.load) {
      return { normalized: busLoadValues.unavailable, label: "Bus load unavailable" };
    }
    return { normalized: busLoadValues[arrival.load], label: busLoadLabel[arrival.load] };
  });
  return points.sort((left, right) => right.normalized - left.normalized)[0];
}

const weatherMultiplier = (conditions: TravelCondition[]) => {
  const severities = conditions
    .filter(({ kind }) => kind === "weather")
    .map(({ severity }) => ({ info: 1.1, minor: 1.25, major: 1.5 })[severity]);
  return severities.length > 0 ? Math.max(...severities) : 1;
};

const routeChange = (journey: Journey, baseline: Journey) => {
  if (journey.id === baseline.id) return { normalized: 0, label: "Usual route" };
  const baselineLines = new Set(baseline.legs.flatMap((leg) => leg.lineId ? [leg.lineId] : []));
  const candidateLines = new Set(journey.legs.flatMap((leg) => leg.lineId ? [leg.lineId] : []));
  const sharedLines = [...candidateLines].filter((line) => baselineLines.has(line));
  if (sharedLines.length === candidateLines.size && candidateLines.size === baselineLines.size) {
    return { normalized: 0.25, label: "Familiar lines" };
  }
  if (sharedLines.length > 0) return { normalized: 0.5, label: "Partly familiar" };
  return { normalized: 1, label: "Different line" };
};

function deadlineRisk(journey: Journey, deadline: string) {
  const earliest = minutesSinceMidnight(journey.arrival.earliest);
  const latest = minutesSinceMidnight(journey.arrival.latest);
  const deadlineMinutes = minutesSinceMidnight(deadline);
  if (latest <= deadlineMinutes) return { normalized: 0, minutesAtRisk: 0 };
  if (earliest > deadlineMinutes) {
    return { normalized: 1, minutesAtRisk: earliest - deadlineMinutes };
  }
  const width = Math.max(1, latest - earliest);
  return {
    normalized: clamp((latest - deadlineMinutes) / width),
    minutesAtRisk: latest - deadlineMinutes,
  };
}

function forecastDeadlineRisk(
  journey: Journey,
  deadline: string,
  forecast: JourneyReliabilityForecast,
) {
  const deterministic = deadlineRisk(journey, deadline);
  if (forecast.probabilityBeforeDeadline === undefined || forecast.method === "deterministic_fallback") {
    return { ...deterministic, valueLabel: deterministic.normalized === 0
      ? "Safely before deadline"
      : deterministic.normalized === 1
        ? `${deterministic.minutesAtRisk} min past deadline`
        : `${deterministic.minutesAtRisk} min at risk` };
  }
  return {
    normalized: 1 - forecast.probabilityBeforeDeadline,
    minutesAtRisk: deterministic.minutesAtRisk,
    valueLabel: `${Math.round(forecast.probabilityBeforeDeadline * 100)}% on-time estimate${forecast.synthetic ? " · synthetic" : ""}`,
  };
}

function component(
  key: ScoreComponentKey,
  label: string,
  valueLabel: string,
  normalized: number,
  weights: JourneyScoreWeights,
): ScoreComponentDetail {
  const bounded = clamp(normalized);
  return {
    key,
    label,
    valueLabel,
    normalized: round(bounded, 3),
    weight: weights[key],
    weightedPoints: round(bounded * weights[key] * 100),
  };
}

function scoreJourney(
  journey: Journey,
  context: ScoreContext,
  weights: JourneyScoreWeights,
  reliability: JourneyReliabilityForecast,
): { breakdown: ScoreBreakdown; metrics: CandidateMetrics } {
  const p50 = minutesSinceMidnight(journey.arrival.p50);
  const arrivalDelayMinutes = Math.max(0, p50 - context.bestArrivalMinutes);
  const uncertaintyMinutes = intervalWidth(journey.arrival.earliest, journey.arrival.latest);
  const transfers = countTransfers(journey);
  const walkingMinutes = countWalkingMinutes(journey);
  const rainMultiplier = weatherMultiplier(context.conditions);
  const effectiveWalkingMinutes = Math.round(walkingMinutes * rainMultiplier);
  const crowding = worstCrowding(journey);
  const risk = forecastDeadlineRisk(journey, context.deadline, reliability);
  const churn = routeChange(journey, context.baselineJourney);
  const busWait = worstBusWait(journey);
  const busLoad = worstBusLoad(journey);

  const components = [
    component(
      "deadlineRisk",
      "Deadline risk",
      risk.valueLabel,
      risk.normalized,
      weights,
    ),
    component(
      "expectedArrivalPenalty",
      "Arrival delay",
      arrivalDelayMinutes === 0 ? "Best expected arrival" : `${arrivalDelayMinutes} min later`,
      arrivalDelayMinutes / 20,
      weights,
    ),
    component(
      "uncertaintyPenalty",
      "Arrival uncertainty",
      `${uncertaintyMinutes} min range`,
      uncertaintyMinutes / 20,
      weights,
    ),
    component(
      "transferPenalty",
      "Transfers",
      transfers === 0 ? "No transfers" : `${transfers} transfer${transfers === 1 ? "" : "s"}`,
      transfers / 3,
      weights,
    ),
    component(
      "walkingAndRainPenalty",
      "Walking exposure",
      rainMultiplier > 1 ? `${effectiveWalkingMinutes} min rain-adjusted` : `${walkingMinutes} min walking`,
      effectiveWalkingMinutes / 30,
      weights,
    ),
    component(
      "crowdingPenalty",
      "Crowding",
      crowding === "unknown" ? "Data unavailable" : `${crowding[0].toUpperCase()}${crowding.slice(1)}`,
      crowdingValues[crowding],
      weights,
    ),
    component(
      "routeChangePenalty",
      "Route change",
      churn.label,
      churn.normalized,
      weights,
    ),
    component(
      "busWaitPenalty",
      "Bus wait",
      busWait.label,
      busWait.normalized,
      weights,
    ),
    component(
      "busLoadPenalty",
      "Bus load",
      busLoad.label,
      busLoad.normalized,
      weights,
    ),
  ];
  const total = Math.round(components.reduce((sum, item) => sum + item.weightedPoints, 0));

  return {
    breakdown: { total, lowerIsBetter: true, components },
    metrics: {
      walkingMinutes,
      effectiveWalkingMinutes,
      transfers,
      crowding,
      arrivalDelayMinutes,
      uncertaintyMinutes,
      deadlineRiskMinutes: risk.minutesAtRisk,
      routeChangeLabel: churn.label,
    },
  };
}

function validateWeights(weights: JourneyScoreWeights) {
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) > 0.0001) {
    throw new Error(`Journey score weights must total 1; received ${total}.`);
  }
}

export function scoreJourneyCandidates(
  usual: Journey,
  candidate: Journey | Journey[] | undefined,
  deadline: string,
  conditions: TravelCondition[],
  weights: JourneyScoreWeights = RACHEL_SCORE_WEIGHTS,
): Alternative[] {
  validateWeights(weights);
  const journeys = [usual, ...(Array.isArray(candidate) ? candidate : candidate ? [candidate] : [])];
  const bestArrivalMinutes = Math.min(...journeys.map((journey) => minutesSinceMidnight(journey.arrival.p50)));
  const context: ScoreContext = {
    deadline,
    baselineJourney: usual,
    bestArrivalMinutes,
    conditions,
  };

  const scored = journeys.map((journey) => {
    const reliability = forecastJourneyReliability(journey, deadline, conditions);
    const { breakdown, metrics } = scoreJourney(journey, context, weights, reliability);
    return { journey, breakdown, metrics, reliability };
  });
  // Exactly one recommendation, even after rounded-score ties.
  const best = [...scored].sort((left, right) => left.breakdown.total - right.breakdown.total)[0];

  return scored
    .map(({ journey, breakdown, metrics, reliability }): Alternative => {
      const recommended = journey.id === best.journey.id;
      const changed = journey.id !== usual.id;
      return {
        id: `${journey.id}-option`,
        journey,
        recommended,
        score: breakdown.total,
        scoreBreakdown: breakdown,
        reliability,
        explanation: journey.demandForecast && journey.demandForecast.addedDelayMinutes > 0
          ? "Projected boarding demand adds waiting time. The arrival range includes this synthetic delay estimate."
          : recommended
          ? changed
            ? "Avoids the affected EWL section and protects your 8:45 deadline."
            : "Your usual route remains the simplest reliable option."
          : metrics.deadlineRiskMinutes > 0
            ? "The disruption makes this route unlikely to meet your deadline."
            : "This option has a higher overall journey cost.",
        extraWalkingMinutes: Math.max(0, metrics.walkingMinutes - countWalkingMinutes(usual)),
        transfers: metrics.transfers,
        crowding: metrics.crowding,
      };
    })
    .sort((left, right) => left.score - right.score);
}
