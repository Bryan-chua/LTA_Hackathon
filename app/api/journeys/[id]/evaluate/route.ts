import { apiError, invalidRequest, isScenarioId } from "@/lib/application/http";
import { journeyOrchestrator } from "@/lib/application/journey-orchestrator";
import type { ApiSuccess, JourneyEvaluationView } from "@/lib/application/journey-view-model";
import { isDemandProfile } from "@/lib/demand-flow";
import { demandDemoEnabled, demandStore } from "@/lib/application/demand-store";
import { noStore } from "@/lib/application/demand-http";

export async function POST(
  request: Request,
  context: RouteContext<"/api/journeys/[id]/evaluate">,
) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as { scenarioId?: unknown; demandProfile?: unknown } | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) return invalidRequest("Expected a JSON object.");
    if (!isScenarioId(body.scenarioId)) {
      return invalidRequest("scenarioId must be 'normal' or 'ewl-disruption'.");
    }

    if (body.demandProfile !== undefined && (!isDemandProfile(body.demandProfile) || !demandDemoEnabled())) return invalidRequest("Invalid or disabled demand profile.");
    const profile = body.demandProfile;
    const data = await journeyOrchestrator.evaluate(id, body.scenarioId,
      profile ? { profile, selections: demandStore.selections(body.scenarioId, profile) } : undefined);
    const response: ApiSuccess<JourneyEvaluationView> = { data };
    return Response.json(response, { headers: noStore });
  } catch (error) {
    return apiError(error);
  }
}
