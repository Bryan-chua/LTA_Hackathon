import { apiError, invalidRequest, isScenarioId } from "@/lib/application/http";
import { journeyOrchestrator } from "@/lib/application/journey-orchestrator";
import type { ApiSuccess, JourneyEvaluationView } from "@/lib/application/journey-view-model";

export async function POST(
  request: Request,
  context: RouteContext<"/api/journeys/[id]/evaluate">,
) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { scenarioId?: unknown };
    if (!isScenarioId(body.scenarioId)) {
      return invalidRequest("scenarioId must be 'normal' or 'ewl-disruption'.");
    }

    const data = await journeyOrchestrator.evaluate(id, body.scenarioId);
    const response: ApiSuccess<JourneyEvaluationView> = { data };
    return Response.json(response);
  } catch (error) {
    return apiError(error);
  }
}
