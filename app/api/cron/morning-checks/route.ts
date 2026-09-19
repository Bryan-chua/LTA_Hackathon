import { runMorningChecks } from "@/lib/server/morning-scheduler";
import { isCronRequestAuthorized } from "@/lib/server/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!await isCronRequestAuthorized(request)) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized." } }, { status: 401 });
  }
  if (process.env.PUSH_ENABLED !== "true") return Response.json({ data: { skipped: true, reason: "Push disabled." } });
  return Response.json({ data: await runMorningChecks() });
}

export const GET = POST;
