import type { CrowdingLevel, Journey, Routine, Scenario, TravelCondition } from "./domain";

export interface RoutingProvider {
  readonly source: Journey["source"];
  plan(routine: Routine): Promise<Journey[]>;
}

export interface TrainAlertProvider {
  getConditions(at: Date): Promise<TravelCondition[]>;
}

export interface CrowdingProvider {
  getLevel(stationCode: string, at: Date): Promise<CrowdingLevel>;
}

export interface WeatherProvider {
  getConditions(at: Date): Promise<TravelCondition[]>;
}

export class FixtureRoutingProvider implements RoutingProvider {
  readonly source = "fixture" as const;

  constructor(private readonly scenario: Scenario) {}

  async plan(): Promise<Journey[]> {
    return [this.scenario.usualJourney, this.scenario.recommendedJourney].filter(
      (journey): journey is Journey => Boolean(journey),
    );
  }
}
