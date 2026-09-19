import type { Routine, Scenario, TravelMode } from "../domain";
import type { ApiFailure, ApiSuccess, JourneyPlanView } from "./journey-view-model";
import type { DemandProfile } from "../demand-flow";

export async function requestJourneyPlan(scenarioId: Scenario["id"], demandProfile?: DemandProfile, travelMode?: TravelMode): Promise<JourneyPlanView> {
  const response = await fetch("/api/journeys/plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenarioId, demandProfile, travelMode }),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = (await response.json()) as ApiSuccess<JourneyPlanView> | ApiFailure;

  if (!response.ok || !("data" in payload)) {
    throw new Error("error" in payload ? payload.error.message : "Unable to plan the journey.");
  }

  return payload.data;
}

export async function requestMorningCheck(routine: Routine, travelMode?: TravelMode): Promise<JourneyPlanView> {
  const response = await fetch("/api/morning-check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ routine, dataMode: "live", travelMode }),
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

export async function requestReliabilityConsent(method: "GET" | "POST" | "DELETE"): Promise<boolean> {
  const response = await fetch("/api/reliability/consent", {
    method,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? "Could not update reliability consent.");
  return payload.data?.consented === true;
    ...(method === "GET" ? {} : { headers: { "content-type": "application/json" } }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? "Could not update forecast consent.");
  return payload.data.consented === true;
}

export async function submitReliabilityFeedback(input: {
  observationId: string;
  arrivedBeforeDeadline: boolean;
  tookRecommended: boolean;
  actualArrival?: string;
  actualArrival?: string;
  tookRecommended: boolean;
}): Promise<void> {
  const response = await fetch("/api/reliability/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? "Could not save reliability feedback.");
  if (!response.ok) throw new Error(payload.error?.message ?? "Could not save journey feedback.");
}
