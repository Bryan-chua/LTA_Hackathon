import { apiError, invalidRequest, isScenarioId } from "@/lib/application/http";
import { journeyOrchestrator } from "@/lib/application/journey-orchestrator";
import type { ApiSuccess, JourneyPlanView } from "@/lib/application/journey-view-model";
import { demandDemoEnabled, demandStore } from "@/lib/application/demand-store";
import { isDemandProfile } from "@/lib/demand-flow";
import { noStore } from "@/lib/application/demand-http";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { scenarioId?: unknown; demandProfile?: unknown } | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) return invalidRequest("Expected a JSON object.");
    if (body.scenarioId !== undefined && !isScenarioId(body.scenarioId)) {
      return invalidRequest("scenarioId must be 'normal' or 'ewl-disruption'.");
    }

    if (body.demandProfile !== undefined && !isDemandProfile(body.demandProfile)) return invalidRequest("Invalid demand profile.");
    if (body.demandProfile !== undefined && !demandDemoEnabled()) return invalidRequest("Demand demo is disabled.");
    const scenarioId = body.scenarioId ?? "ewl-disruption";
    const profile = body.demandProfile;
    const data = await journeyOrchestrator.plan({ scenarioId,
      demand: profile ? { profile, selections: demandStore.selections(scenarioId, profile) } : undefined });
    const response: ApiSuccess<JourneyPlanView> = { data };
    return Response.json(response, { headers: noStore });
  } catch (error) {
    return apiError(error);
  }
}
