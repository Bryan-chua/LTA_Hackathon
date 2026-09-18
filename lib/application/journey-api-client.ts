import type { Scenario } from "../domain";
import type { ApiFailure, ApiSuccess, JourneyPlanView } from "./journey-view-model";

export async function requestJourneyPlan(scenarioId: Scenario["id"]): Promise<JourneyPlanView> {
  const response = await fetch("/api/journeys/plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenarioId }),
  });
  const payload = (await response.json()) as ApiSuccess<JourneyPlanView> | ApiFailure;

  if (!response.ok || !("data" in payload)) {
    throw new Error("error" in payload ? payload.error.message : "Unable to plan the journey.");
  }

  return payload.data;
}
