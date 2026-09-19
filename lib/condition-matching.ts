import { canonicalLineId, canonicalStationCodes } from "./canonical-transit";
import type { AffectedSegment, Coordinate, Journey, JourneyLeg, TravelCondition } from "./domain";

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

const METERS_PER_DEGREE_LATITUDE = 111_320;

function pointToSegmentMeters(point: Coordinate, start: Coordinate, end: Coordinate): number {
  const latitude = ((point.lat + start.lat + end.lat) / 3) * Math.PI / 180;
  const scaleX = METERS_PER_DEGREE_LATITUDE * Math.cos(latitude);
  const px = point.lng * scaleX;
  const py = point.lat * METERS_PER_DEGREE_LATITUDE;
  const ax = start.lng * scaleX;
  const ay = start.lat * METERS_PER_DEGREE_LATITUDE;
  const bx = end.lng * scaleX;
  const by = end.lat * METERS_PER_DEGREE_LATITUDE;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function isNearLeg(leg: JourneyLeg, condition: TravelCondition): boolean {
  if (!condition.coordinate || !condition.radiusMeters) return true;
  const geometry = leg.geometry.length > 0 ? leg.geometry : [leg.from.coordinate, leg.to.coordinate];
  if (geometry.length === 1) {
    return pointToSegmentMeters(condition.coordinate, geometry[0], geometry[0]) <= condition.radiusMeters;
  }
  return geometry.slice(1).some((point, index) =>
    pointToSegmentMeters(condition.coordinate!, geometry[index], point) <= condition.radiusMeters!,
  );
}

export function matchCondition(
  leg: JourneyLeg,
  window: TraversalWindow,
  condition: TravelCondition,
): LegConditionMatch | undefined {
  if (!overlapsTraversal(window, condition)) return undefined;
  if (condition.modes?.length && !condition.modes.includes(leg.mode)) return undefined;

  const conditionLines = (condition.lineIds ?? []).map(canonicalLineId);
  const legLine = leg.lineId ? canonicalLineId(leg.lineId) : undefined;
  const hasLineCriterion = conditionLines.length > 0;
  const hasStationCriterion = Boolean(condition.stationCodes?.length);
  const hasSpatialCriterion = Boolean(condition.coordinate && condition.radiusMeters);
  const hasModeCriterion = Boolean(condition.modes?.length);
  if (!hasLineCriterion && !hasStationCriterion && !hasSpatialCriterion && !hasModeCriterion) return undefined;
  if (hasLineCriterion && (!legLine || !conditionLines.includes(legLine))) return undefined;

  const range = stationRange(leg, condition);
  if (hasStationCriterion && !range) return undefined;
  if (hasSpatialCriterion && !isNearLeg(leg, condition)) return undefined;

  return {
    conditionId: condition.id,
    sectionIndexes: matchingSectionIndexes(leg, condition, range),
  };
}

export function conditionsAffectingJourney(journey: Journey, conditions: TravelCondition[]): TravelCondition[] {
  const windows = traversalWindows(journey);
  return conditions.filter((condition) => journey.legs.some((leg, index) =>
    Boolean(matchCondition(leg, windows[index], condition)),
  ));
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
