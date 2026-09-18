import { runMorningChecks } from "@/lib/server/morning-scheduler";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized." } }, { status: 401 });
  }
  if (process.env.PUSH_ENABLED !== "true") return Response.json({ data: { skipped: true, reason: "Push disabled." } });
  return Response.json({ data: await runMorningChecks() });
}
