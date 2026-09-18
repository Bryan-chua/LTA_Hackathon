import type { Alternative, Journey, Scenario } from "../domain";
import { scenarios } from "../fixtures";
import { buildAlternatives, findAffectedSegments } from "../journey-engine";
import { FixtureRoutingProvider, type RoutingProvider } from "../providers";
import type {
  JourneyComparisonView,
  JourneyEvaluationView,
  JourneyPlanView,
  PlanJourneyCommand,
  RecommendationView,
} from "./journey-view-model";
import { journeysIn } from "./journey-view-model";

export class JourneyNotFoundError extends Error {
  constructor(journeyId: string) {
    super(`Journey '${journeyId}' was not found in the selected scenario.`);
    this.name = "JourneyNotFoundError";
  }
}

export class ScenarioNotFoundError extends Error {
  constructor(scenarioId: string) {
    super(`Scenario '${scenarioId}' is not available.`);
    this.name = "ScenarioNotFoundError";
  }
}

type RoutingProviderFactory = (scenario: Scenario) => RoutingProvider;

const displayTime = (time: string) => {
  const clockTime = time.includes("T") ? time.slice(11, 16) : time;
  return clockTime.replace(/^0/, "");
};

const walkingMinutes = (journey: Journey) =>
  journey.legs
    .filter((leg) => leg.mode === "walk")
    .reduce((total, leg) => total + leg.durationMinutes, 0);

function buildRecommendation(
  scenario: Scenario,
  alternatives: Alternative[],
): RecommendationView {
  const selected = alternatives.find((alternative) => alternative.recommended) ?? alternatives[0];
  const journey = selected.journey;
  const primaryRailLeg = journey.legs.find((leg) => leg.mode === "rail");
  const changed = journey.id !== scenario.usualJourney.id;

  return {
    kind: changed ? "change" : "on_track",
    label: changed ? "Recommended change" : "Usual route on track",
    action: changed
      ? `Leave by ${displayTime(journey.departureAt)} and take the ${primaryRailLeg?.lineName ?? "recommended route"}`
      : `Leave around ${displayTime(journey.departureAt)} as usual`,
    reason: changed
      ? `This avoids the affected EWL section and gives you a safer arrival before your ${displayTime(scenario.routine.arrivalDeadline)} deadline.`
      : "No material disruptions are affecting your commute to Raffles Place.",
    journeyId: journey.id,
    lineId: primaryRailLeg?.lineId ?? "Route",
    lineDetail: changed ? "Avoids EWL delay" : "Direct rail journey",
    walkingMinutes: walkingMinutes(journey),
    crowding: selected.crowding,
    changeExplanation: changed
      ? "Your usual EWL route may arrive 6–20 minutes after your deadline. The DTL option adds 4 minutes of walking but avoids the disruption."
      : undefined,
  };
}

export class JourneyOrchestrator {
  constructor(
    private readonly routingProviderFactory: RoutingProviderFactory = (scenario) =>
      new FixtureRoutingProvider(scenario),
  ) {}

  async plan(command: PlanJourneyCommand = {}): Promise<JourneyPlanView> {
    const fixtureScenario = this.getScenario(command.scenarioId ?? "ewl-disruption");
    const provider = this.routingProviderFactory(fixtureScenario);
    const journeys = await provider.plan(command.routine ?? fixtureScenario.routine);
    const usualJourney = journeys[0];

    if (!usualJourney) {
      throw new JourneyNotFoundError("planned-journey");
    }

    const scenario: Scenario = {
      ...fixtureScenario,
      routine: command.routine ?? fixtureScenario.routine,
      usualJourney,
      recommendedJourney: journeys[1],
    };
    const evaluation = this.evaluateScenario(scenario, usualJourney.id);

    return { scenario, ...evaluation };
  }

  async evaluate(journeyId: string, scenarioId: Scenario["id"]): Promise<JourneyEvaluationView> {
    const plan = await this.plan({ scenarioId });
    const journey = this.findJourney(plan.scenario, journeyId);
    return {
      journeyId,
      scenarioId,
      affectedSegments: findAffectedSegments(journey, plan.scenario.conditions),
      alternatives: plan.alternatives,
      recommendation: plan.recommendation,
    };
  }

  async compare(journeyId: string, scenarioId: Scenario["id"]): Promise<JourneyComparisonView> {
    const plan = await this.plan({ scenarioId });
    this.assertJourneyExists(plan.scenario, journeyId);
    return { journeyId, scenarioId, alternatives: plan.alternatives };
  }

  private evaluateScenario(scenario: Scenario, journeyId: string): JourneyEvaluationView {
    const alternatives = buildAlternatives(
      scenario.usualJourney,
      scenario.recommendedJourney,
      scenario.routine.arrivalDeadline,
      scenario.conditions,
    );
    return {
      journeyId,
      scenarioId: scenario.id,
      affectedSegments: findAffectedSegments(scenario.usualJourney, scenario.conditions),
      alternatives,
      recommendation: buildRecommendation(scenario, alternatives),
    };
  }

  private getScenario(scenarioId: string): Scenario {
    if (scenarioId === "normal" || scenarioId === "ewl-disruption") {
      return scenarios[scenarioId];
    }
    throw new ScenarioNotFoundError(scenarioId);
  }

  private assertJourneyExists(scenario: Scenario, journeyId: string) {
    this.findJourney(scenario, journeyId);
  }

  private findJourney(scenario: Scenario, journeyId: string): Journey {
    const journey = journeysIn(scenario).find((candidate) => candidate.id === journeyId);
    if (!journey) {
      throw new JourneyNotFoundError(journeyId);
    }
    return journey;
  }
}

export const journeyOrchestrator = new JourneyOrchestrator();
