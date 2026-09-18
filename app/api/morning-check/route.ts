import { z } from "zod";
import { apiError, invalidRequest } from "@/lib/application/http";
import { noStore } from "@/lib/application/demand-http";
import { journeyOrchestrator } from "@/lib/application/journey-orchestrator";
import { planLiveJourney } from "@/lib/live/live-planner";
import { decideMorningCheck } from "@/lib/morning-check";
import { routineSchema } from "@/lib/routine-schema";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const parsed = z.object({
      routine: routineSchema,
      dataMode: z.enum(["live", "replay"]).default("live"),
      scenarioId: z.enum(["normal", "ewl-disruption"]).default("ewl-disruption"),
    }).safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalidRequest(parsed.error.issues[0]?.message ?? "Invalid morning-check request.");
    const plan = parsed.data.dataMode === "live"
      ? await planLiveJourney(parsed.data.routine)
      : await journeyOrchestrator.plan({ scenarioId: parsed.data.scenarioId, routine: parsed.data.routine });
    const decision = decideMorningCheck("manual", "manual", parsed.data.routine, plan);
    return Response.json({ data: { decision, plan } }, { headers: noStore });
  } catch (error) {
    return apiError(error);
  }
}
