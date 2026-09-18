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
import { projectDemand } from "../demand-flow";

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

export function buildRecommendation(
  scenario: Scenario,
  alternatives: Alternative[],
): RecommendationView {
  const selected = alternatives.find((alternative) => alternative.recommended) ?? alternatives[0];
  const journey = selected.journey;
  const primaryRailLeg = journey.legs.find((leg) => leg.mode === "rail");
  const changed = journey.id !== scenario.usualJourney.id;
  const affectedLine = scenario.conditions.find((condition) => condition.kind === "train_disruption")?.lineIds?.[0] ?? "affected route";
  const baselineWalking = walkingMinutes(scenario.usualJourney);
  const walkingDelta = Math.max(0, walkingMinutes(journey) - baselineWalking);

  return {
    kind: changed ? "change" : "on_track",
    label: changed ? "Recommended change" : "Usual route on track",
    action: changed
      ? `Leave by ${displayTime(journey.departureAt)} and take the ${primaryRailLeg?.lineName ?? "recommended route"}`
      : `Leave around ${displayTime(journey.departureAt)} as usual`,
    reason: changed
      ? `This avoids the affected ${affectedLine} section and gives you a safer arrival before your ${displayTime(scenario.routine.arrivalDeadline)} deadline.`
      : `No material disruptions are affecting your commute to ${scenario.routine.destination.shortName}.`,
    journeyId: journey.id,
    lineId: primaryRailLeg?.lineId ?? "Route",
    lineDetail: changed ? `Avoids ${affectedLine} delay` : "Direct rail journey",
    walkingMinutes: walkingMinutes(journey),
    crowding: selected.crowding,
    changeExplanation: changed
      ? `Your usual route is exposed to the ${affectedLine} disruption. This option adds ${walkingDelta} minutes of walking and improves deadline reliability.`
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
    const rawJourneys = await provider.plan(command.routine ?? fixtureScenario.routine);
    const projection = command.demand ? projectDemand(rawJourneys, fixtureScenario,
      command.demand.profile, command.demand.selections) : undefined;
    const journeys = projection?.journeys ?? rawJourneys;
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
    const evaluation = this.evaluateScenario(scenario, usualJourney.id, journeys.slice(1));
    const selected = evaluation.alternatives.find((option) => option.recommended)?.journey;
    scenario.recommendedJourney = selected?.id !== usualJourney.id ? selected : undefined;
    if (selected?.id === "relief-tel-route") {
      evaluation.recommendation.reason = "The direct DTL alternative is forecast to be crowded in this demo. Bus 31 and the Thomson-East Coast Line use a less-loaded corridor.";
      evaluation.recommendation.changeExplanation = "Accepted demo reroutes shift demand towards the DTL. This separate bus-and-TEL route avoids both the EWL disruption and the projected DTL peak. Estimates are synthetic.";
    }

    return { scenario, ...evaluation, ...(projection ? { demand: projection.demand } : {}) };
  }

  async evaluate(journeyId: string, scenarioId: Scenario["id"], demand?: PlanJourneyCommand["demand"]): Promise<JourneyEvaluationView> {
    const plan = await this.plan({ scenarioId, demand });
    const journey = plan.alternatives.find((option) => option.journey.id === journeyId)?.journey;
    if (!journey) throw new JourneyNotFoundError(journeyId);
    return {
      journeyId,
      scenarioId,
      affectedSegments: findAffectedSegments(journey, plan.scenario.conditions),
      alternatives: plan.alternatives,
      recommendation: plan.recommendation,
    };
  }

  async compare(journeyId: string, scenarioId: Scenario["id"], demand?: PlanJourneyCommand["demand"]): Promise<JourneyComparisonView> {
    const plan = await this.plan({ scenarioId, demand });
    if (!plan.alternatives.some((option) => option.journey.id === journeyId)) throw new JourneyNotFoundError(journeyId);
    return { journeyId, scenarioId, alternatives: plan.alternatives };
  }

  private evaluateScenario(scenario: Scenario, journeyId: string, candidates?: Journey[]): JourneyEvaluationView {
    const alternatives = buildAlternatives(
      scenario.usualJourney,
      candidates ?? scenario.recommendedJourney,
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

}

export const journeyOrchestrator = new JourneyOrchestrator();
