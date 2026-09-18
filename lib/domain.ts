export type Mode = "walk" | "rail" | "bus" | "cycle";
export type CrowdingLevel = "low" | "moderate" | "high" | "unknown";

export interface Coordinate {
  lng: number;
  lat: number;
}

export interface Place {
  name: string;
  shortName: string;
  coordinate: Coordinate;
}

export interface ArrivalRange {
  p50: string;
  earliest: string;
  latest: string;
}

export interface JourneyLegGeometrySection {
  id: string;
  fromStationCode?: string;
  toStationCode?: string;
  geometry: Coordinate[];
}

export interface JourneyLeg {
  id: string;
  sequence: number;
  mode: Mode;
  from: Place;
  to: Place;
  instruction: string;
  lineId?: string;
  lineName?: string;
  stationCodes?: string[];
  durationMinutes: number;
  uncertaintyMinutes: number;
  crowding?: CrowdingLevel;
  geometry: Coordinate[];
  geometrySections?: JourneyLegGeometrySection[];
}

export interface Journey {
  id: string;
  name: string;
  origin: Place;
  destination: Place;
  departureAt: string;
  arrival: ArrivalRange;
  legs: JourneyLeg[];
  source: "onemap" | "graphhopper" | "valhalla" | "fixture";
  generatedAt: string;
}

export interface TravelCondition {
  id: string;
  kind: "train_disruption" | "crowding" | "weather" | "road_incident" | "planned_work";
  severity: "info" | "minor" | "major";
  title: string;
  lineIds?: string[];
  stationCodes?: string[];
  validFrom: string;
  validTo?: string;
  source: string;
  observedAt: string;
  isReplay: boolean;
}

export interface Routine {
  id: string;
  travellerName: string;
  origin: Place;
  destination: Place;
  departureTime: string;
  arrivalDeadline: string;
  weekdays: number[];
  enabled: boolean;
}

export type ScoreComponentKey =
  | "deadlineRisk"
  | "expectedArrivalPenalty"
  | "uncertaintyPenalty"
  | "transferPenalty"
  | "walkingAndRainPenalty"
  | "crowdingPenalty"
  | "routeChangePenalty";

export interface ScoreComponentDetail {
  key: ScoreComponentKey;
  label: string;
  valueLabel: string;
  normalized: number;
  weight: number;
  weightedPoints: number;
}

export interface ScoreBreakdown {
  total: number;
  lowerIsBetter: true;
  components: ScoreComponentDetail[];
}

export interface Alternative {
  id: string;
  journey: Journey;
  recommended: boolean;
  score: number;
  explanation: string;
  extraWalkingMinutes: number;
  transfers: number;
  crowding: CrowdingLevel;
  scoreBreakdown: ScoreBreakdown;
}

export interface AffectedSegment {
  firstLegIndex: number;
  lastLegIndex: number;
  conditionIds: string[];
  geometryMatches: Array<{
    legIndex: number;
    sectionIndexes: number[];
  }>;
}

export interface Scenario {
  id: "normal" | "ewl-disruption";
  label: string;
  isReplay: boolean;
  routine: Routine;
  usualJourney: Journey;
  recommendedJourney?: Journey;
  conditions: TravelCondition[];
  updatedAt: string;
}
