import { apiError, invalidRequest, isScenarioId } from "@/lib/application/http";
import { journeyOrchestrator } from "@/lib/application/journey-orchestrator";
import type { ApiSuccess, JourneyComparisonView } from "@/lib/application/journey-view-model";
import { isDemandProfile } from "@/lib/demand-flow";
import { demandDemoEnabled, demandStore } from "@/lib/application/demand-store";
import { noStore } from "@/lib/application/demand-http";

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

    const profile = new URL(request.url).searchParams.get("demandProfile");
    if (profile !== null && (!isDemandProfile(profile) || !demandDemoEnabled())) return invalidRequest("Invalid or disabled demand profile.");
    const data = await journeyOrchestrator.compare(id, scenarioId,
      profile ? { profile, selections: demandStore.selections(scenarioId, profile) } : undefined);
    const response: ApiSuccess<JourneyComparisonView> = { data };
    return Response.json(response, { headers: noStore });
  } catch (error) {
    return apiError(error);
  }
}
