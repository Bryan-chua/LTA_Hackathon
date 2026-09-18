import type { AffectedSegment, Alternative, Journey, JourneyLeg, TravelCondition } from "./domain";
import { canonicalLineId, canonicalStationCodes } from "./canonical-transit";
import { scoreJourneyCandidates } from "./journey-scoring";

interface TraversalWindow {
  startsAt: number;
  endsAt: number;
}

interface LegConditionMatch {
  conditionId: string;
  sectionIndexes: number[];
}

function traversalWindows(journey: Journey): TraversalWindow[] {
  const departure = Date.parse(journey.departureAt);
  if (Number.isNaN(departure)) {
    throw new Error(`Journey '${journey.id}' must have an ISO 8601 departureAt value.`);
  }

  let elapsedMinutes = 0;
  return journey.legs.map((leg) => {
    const startsAt = departure + elapsedMinutes * 60_000;
    const endsAt = startsAt + (leg.durationMinutes + leg.uncertaintyMinutes) * 60_000;
    elapsedMinutes += leg.durationMinutes;
    return { startsAt, endsAt };
  });
}

function overlapsTraversal(window: TraversalWindow, condition: TravelCondition): boolean {
  const validFrom = Date.parse(condition.validFrom);
  const validTo = condition.validTo ? Date.parse(condition.validTo) : Number.POSITIVE_INFINITY;
  if (Number.isNaN(validFrom) || Number.isNaN(validTo)) return false;
  return validFrom <= window.endsAt && validTo >= window.startsAt;
}

function stationRange(leg: JourneyLeg, condition: TravelCondition): [number, number] | undefined {
  const orderedStations = canonicalStationCodes(leg.stationCodes ?? []);
  const affectedStations = canonicalStationCodes(condition.stationCodes ?? []);
  const indexes = affectedStations
    .map((station) => orderedStations.indexOf(station))
    .filter((index) => index >= 0);

  if (indexes.length === 0) return undefined;
  return [Math.min(...indexes), Math.max(...indexes)];
}

function matchingSectionIndexes(
  leg: JourneyLeg,
  condition: TravelCondition,
  range: [number, number] | undefined,
): number[] {
  const sections = leg.geometrySections ?? [];
  if (sections.length === 0) return [];
  if (!condition.stationCodes?.length) return sections.map((_, index) => index);
  if (!range) return [];

  const orderedStations = canonicalStationCodes(leg.stationCodes ?? []);
  const [affectedStart, affectedEnd] = range;

  return sections.flatMap((section, index) => {
    const sectionStart = orderedStations.indexOf(
      canonicalStationCodes([section.fromStationCode ?? ""])[0] ?? "",
    );
    const sectionEnd = orderedStations.indexOf(
      canonicalStationCodes([section.toStationCode ?? ""])[0] ?? "",
    );
    if (sectionStart < 0 || sectionEnd < 0) return [];

    if (affectedStart === affectedEnd) {
      return affectedStart >= sectionStart && affectedStart <= sectionEnd ? [index] : [];
    }
    return sectionStart < affectedEnd && sectionEnd > affectedStart ? [index] : [];
  });
}

function matchCondition(
  leg: JourneyLeg,
  window: TraversalWindow,
  condition: TravelCondition,
): LegConditionMatch | undefined {
  if (!overlapsTraversal(window, condition)) return undefined;

  const conditionLines = (condition.lineIds ?? []).map(canonicalLineId);
  const legLine = leg.lineId ? canonicalLineId(leg.lineId) : undefined;
  const hasLineCriterion = conditionLines.length > 0;
  const hasStationCriterion = Boolean(condition.stationCodes?.length);
  if (!hasLineCriterion && !hasStationCriterion) return undefined;
  if (hasLineCriterion && (!legLine || !conditionLines.includes(legLine))) return undefined;

  const range = stationRange(leg, condition);
  if (hasStationCriterion && !range) return undefined;

  return {
    conditionId: condition.id,
    sectionIndexes: matchingSectionIndexes(leg, condition, range),
  };
}

export function findAffectedSegments(
  journey: Journey,
  conditions: TravelCondition[],
): AffectedSegment[] {
  const windows = traversalWindows(journey);
  const matches = journey.legs
    .map((leg, index) => ({
      index,
      matches: conditions
        .map((condition) => matchCondition(leg, windows[index], condition))
        .filter((match): match is LegConditionMatch => Boolean(match)),
    }))
    .filter(({ matches: legMatches }) => legMatches.length > 0)
    .map(({ index, matches: legMatches }) => ({
      index,
      conditionIds: [...new Set(legMatches.map(({ conditionId }) => conditionId))],
      sectionIndexes: [...new Set(legMatches.flatMap(({ sectionIndexes }) => sectionIndexes))].sort(
        (left, right) => left - right,
      ),
    }));

  return matches.reduce<AffectedSegment[]>((segments, match) => {
    const previous = segments.at(-1);
    if (previous && match.index === previous.lastLegIndex + 1) {
      previous.lastLegIndex = match.index;
      previous.conditionIds = [...new Set([...previous.conditionIds, ...match.conditionIds])];
      previous.geometryMatches.push({
        legIndex: match.index,
        sectionIndexes: match.sectionIndexes,
      });
      return segments;
    }
    segments.push({
      firstLegIndex: match.index,
      lastLegIndex: match.index,
      conditionIds: match.conditionIds,
      geometryMatches: [{ legIndex: match.index, sectionIndexes: match.sectionIndexes }],
    });
    return segments;
  }, []);
}

export function isLegAffected(index: number, segments: AffectedSegment[]) {
  return segments.some(({ firstLegIndex, lastLegIndex }) => index >= firstLegIndex && index <= lastLegIndex);
}

export function buildAlternatives(
  usual: Journey,
  recommended: Journey | Journey[] | undefined,
  deadline: string,
  conditions: TravelCondition[],
): Alternative[] {
  return scoreJourneyCandidates(usual, recommended, deadline, conditions);
}
