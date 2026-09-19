import { apiError, invalidRequest, isScenarioId } from "@/lib/application/http";
import { journeyOrchestrator } from "@/lib/application/journey-orchestrator";
import type { ApiSuccess, JourneyPlanView } from "@/lib/application/journey-view-model";
import { demandDemoEnabled, demandStore } from "@/lib/application/demand-store";
import { isDemandProfile } from "@/lib/demand-flow";
import { noStore } from "@/lib/application/demand-http";
import { routineSchema } from "@/lib/routine-schema";
import { planLiveJourney } from "@/lib/live/live-planner";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { scenarioId?: unknown; demandProfile?: unknown } | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) return invalidRequest("Expected a JSON object.");
    const liveBody = body as typeof body & { dataMode?: unknown; routine?: unknown };
    if (liveBody.dataMode === "live") {
      const routine = routineSchema.safeParse(liveBody.routine);
      if (!routine.success) return invalidRequest(routine.error.issues[0]?.message ?? "Invalid routine.");
      const data = await planLiveJourney(routine.data);
      const response: ApiSuccess<JourneyPlanView> = { data };
      return Response.json(response, { headers: noStore });
    }
    if (liveBody.dataMode !== undefined && liveBody.dataMode !== "replay") return invalidRequest("dataMode must be 'live' or 'replay'.");
    if (body.scenarioId !== undefined && !isScenarioId(body.scenarioId)) {
      return invalidRequest("scenarioId must be 'normal', 'ewl-disruption', or 'ewl-planned-work'.");
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
