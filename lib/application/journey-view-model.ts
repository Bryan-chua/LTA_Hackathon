import type { AffectedSegment, Alternative, CrowdingLevel, DataMode, Journey, ProviderMode, Scenario, TravelMode } from "../domain";
import type { DemandProfile, DemandView } from "../demand-flow";

export interface RecommendationView {
  kind: "on_track" | "change";
  label: string;
  action: string;
  reason: string;
  journeyId: string;
  lineId: string;
  lineDetail: string;
  walkingMinutes: number;
  crowding: CrowdingLevel;
  changeExplanation?: string;
}

export interface JourneyEvaluationView {
  journeyId: string;
  scenarioId: Scenario["id"];
  affectedSegments: AffectedSegment[];
  alternatives: Alternative[];
  recommendation: RecommendationView;
}

export interface ProviderStateView {
  name: string;
  status: "available" | "degraded" | "unavailable";
  mode: ProviderMode;
  fetchedAt: string;
  staleAt?: string;
  warnings: string[];
}

export interface JourneyPlanView extends JourneyEvaluationView {
  scenario: Scenario;
  demand?: DemandView;
  dataMode?: DataMode;
  providers?: ProviderStateView[];
  accessibilityNotice?: string;
}

export interface JourneyComparisonView {
  journeyId: string;
  scenarioId: Scenario["id"];
  alternatives: Alternative[];
}

export interface PlanJourneyCommand {
  scenarioId?: Scenario["id"];
  routine?: Scenario["routine"];
  demand?: { profile: DemandProfile; selections: readonly string[] };
  travelMode?: TravelMode;
}

export interface ApiSuccess<T> {
  data: T;
}

export interface ApiFailure {
  error: {
    code: string;
    message: string;
  };
}

export const journeysIn = (scenario: Scenario): Journey[] =>
  [scenario.usualJourney, scenario.recommendedJourney].filter(
    (journey): journey is Journey => Boolean(journey),
  );
