import type { ApiFailure } from "./journey-view-model";
import { JourneyNotFoundError, ScenarioNotFoundError } from "./journey-orchestrator";
import type { Scenario } from "../domain";

export function isScenarioId(value: unknown): value is Scenario["id"] {
  return value === "normal" || value === "ewl-disruption" || value === "ewl-planned-work" || value === "mdm-lift-maintenance";
}

export function apiError(error: unknown): Response {
  if (error instanceof JourneyNotFoundError || error instanceof ScenarioNotFoundError) {
    const body: ApiFailure = {
      error: { code: error.name, message: error.message },
    };
    return Response.json(body, { status: 404 });
  }

  const body: ApiFailure = {
    error: {
      code: "INTERNAL_ERROR",
      message: "The journey service could not complete the request.",
    },
  };
  return Response.json(body, { status: 500 });
}

export function invalidRequest(message: string): Response {
  const body: ApiFailure = { error: { code: "INVALID_REQUEST", message } };
  return Response.json(body, { status: 400 });
}
