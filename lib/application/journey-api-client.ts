import type { Routine, Scenario } from "../domain";
import type { ApiFailure, ApiSuccess, JourneyPlanView } from "./journey-view-model";
import type { DemandProfile } from "../demand-flow";

export async function requestJourneyPlan(scenarioId: Scenario["id"], demandProfile?: DemandProfile): Promise<JourneyPlanView> {
  const response = await fetch("/api/journeys/plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenarioId, demandProfile }),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = (await response.json()) as ApiSuccess<JourneyPlanView> | ApiFailure;

  if (!response.ok || !("data" in payload)) {
    throw new Error("error" in payload ? payload.error.message : "Unable to plan the journey.");
  }

  return payload.data;
}

export async function requestMorningCheck(routine: Routine): Promise<JourneyPlanView> {
  const response = await fetch("/api/morning-check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ routine, dataMode: "live" }),
    signal: AbortSignal.timeout(25_000),
  });
  const payload = await response.json();
  if (!response.ok || !payload.data?.plan) {
    throw new Error(payload.error?.message ?? "Live morning check failed.");
  }
  return payload.data.plan as JourneyPlanView;
}

export async function requestParticipation(method: "GET" | "POST" | "DELETE", body?: object): Promise<boolean> {
  const response = await fetch("/api/demand/participation", {
    method, cache: "no-store", signal: AbortSignal.timeout(10_000),
    ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? "Could not update demand participation.");
  return payload.data.participating === true;
}
