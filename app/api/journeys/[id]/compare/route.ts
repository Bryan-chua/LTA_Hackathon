import { apiError, invalidRequest, isScenarioId } from "@/lib/application/http";
import { journeyOrchestrator } from "@/lib/application/journey-orchestrator";
import type { ApiSuccess, JourneyComparisonView } from "@/lib/application/journey-view-model";

export async function GET(
  request: Request,
  context: RouteContext<"/api/journeys/[id]/compare">,
) {
  try {
    const { id } = await context.params;
    const scenarioId = new URL(request.url).searchParams.get("scenario");
    if (!isScenarioId(scenarioId)) {
      return invalidRequest("The scenario query must be 'normal' or 'ewl-disruption'.");
    }

    const data = await journeyOrchestrator.compare(id, scenarioId);
    const response: ApiSuccess<JourneyComparisonView> = { data };
    return Response.json(response);
  } catch (error) {
    return apiError(error);
  }
}
