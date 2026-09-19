import type { DemandForecast } from "./demand-flow";

export type Mode = "walk" | "rail" | "bus" | "cycle";
// "accessible" reweights scoring toward transfers/walking; it is not step-free routing
// and never claims verified accessibility (see BusArrivalInfo and WRITEUP.md).
export type TravelMode = "standard" | "accessible";
export type CrowdingLevel = "low" | "moderate" | "high" | "unknown";
export type DataMode = "live" | "replay";
export type ProviderMode = "live" | "forecast" | "replay" | "cached";

export interface ProviderMetadata {
  source: string;
  mode: ProviderMode;
  fetchedAt: string;
  validFrom?: string;
  validTo?: string;
  staleAt?: string;
  warnings: string[];
}

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

// LTA v3/BusArrival vehicle-load codes: Seats Available, Standing Available, Limited Standing.
// These describe the physical bus only, never MRT station crowding.
export type BusLoadCode = "SEA" | "SDA" | "LSD";

export interface BusArrivalInfo {
  status: "available" | "unavailable";
  serviceNo?: string;
  boardingStopCode?: string;
  alightingStopCode?: string;
  etaMinutes?: number;
  load?: BusLoadCode;
  wheelchairAccessible?: boolean;
  observedAt?: string;
  staleAt?: string;
  reason?: string;
  provider?: ProviderMetadata;
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
  busArrival?: BusArrivalInfo;
}

export interface Journey {
  demandForecast?: DemandForecast;
  id: string;
  name: string;
  origin: Place;
  destination: Place;
  departureAt: string;
  arrival: ArrivalRange;
  legs: JourneyLeg[];
  source: "onemap" | "google" | "graphhopper" | "valhalla" | "fixture";
  generatedAt: string;
  provider?: ProviderMetadata;
}

export interface TravelCondition {
  id: string;
  kind: "train_disruption" | "crowding" | "weather" | "road_incident" | "planned_work" | "flood" | "facility_maintenance";
  severity: "info" | "minor" | "major";
  title: string;
  lineIds?: string[];
  stationCodes?: string[];
  modes?: Mode[];
  coordinate?: Coordinate;
  radiusMeters?: number;
  expectedDelayMinutes?: number;
  validFrom: string;
  validTo?: string;
  source: string;
  observedAt: string;
  isReplay: boolean;
  provider?: ProviderMetadata;
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
  timezone?: "Asia/Singapore";
  materialDelayMinutes?: number;
}

export type ScoreComponentKey =
  | "deadlineRisk"
  | "expectedArrivalPenalty"
  | "uncertaintyPenalty"
  | "transferPenalty"
  | "walkingAndRainPenalty"
  | "crowdingPenalty"
  | "routeChangePenalty"
  | "busWaitPenalty"
  | "busLoadPenalty";

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

export interface ReliabilityReason {
  code: string;
  label: string;
  direction: "helps" | "hurts";
  contribution?: number;
  source: string;
}

export interface JourneyReliabilityForecast {
  method: "model" | "synthetic_model" | "deterministic_fallback";
  modelVersion?: string;
  synthetic: boolean;
  probabilityBeforeDeadline?: number;
  p50Arrival: string;
  p90Arrival?: string;
  likelyArrival: { from: string; to: string };
  reasons: ReliabilityReason[];
  confidence: "high" | "medium" | "low";
  freshness: ProviderMode | "stale";
  dataCompleteness: number;
  fallbackReason?: "model_unavailable" | "stale_critical_data" | "insufficient_similar_journeys"
    | "unsupported_route" | "schema_mismatch";
  observationId?: string;
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
  reliability: JourneyReliabilityForecast;
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
  id: "normal" | "ewl-disruption" | "ewl-planned-work";
  label: string;
  isReplay: boolean;
  routine: Routine;
  usualJourney: Journey;
  recommendedJourney?: Journey;
  conditions: TravelCondition[];
  updatedAt: string;
}
