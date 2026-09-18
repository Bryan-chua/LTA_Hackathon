import { apiError, invalidRequest, isScenarioId } from "@/lib/application/http";
import { journeyOrchestrator } from "@/lib/application/journey-orchestrator";
import type { ApiSuccess, JourneyPlanView } from "@/lib/application/journey-view-model";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { scenarioId?: unknown };
    if (body.scenarioId !== undefined && !isScenarioId(body.scenarioId)) {
      return invalidRequest("scenarioId must be 'normal' or 'ewl-disruption'.");
    }

    const data = await journeyOrchestrator.plan({ scenarioId: body.scenarioId });
    const response: ApiSuccess<JourneyPlanView> = { data };
    return Response.json(response);
  } catch (error) {
    return apiError(error);
  }
}
