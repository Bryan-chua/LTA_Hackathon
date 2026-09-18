import { apiError } from "@/lib/application/http";
import { noStore } from "@/lib/application/demand-http";
import { database } from "@/lib/server/database";
import { installationCookie } from "@/lib/server/push-store";

export const runtime = "nodejs";

export async function GET(request: Request, context: RouteContext<"/api/notifications/[id]">) {
  try {
    const installation = installationCookie(request);
    if (!installation) return Response.json({ error: { code: "NOT_FOUND", message: "Notification not found." } }, { status: 404, headers: noStore });
    const { id } = await context.params;
    const rows = await database()`
      select d.result, d.reason_codes, d.title, d.body, d.target_url, d.evaluated_at, d.sent_at
      from notification_decisions d
      join notification_installations i on i.id = d.installation_id
      where d.public_id = ${id} and i.public_id = ${installation}
      limit 1
    `;
    if (rows.length === 0) return Response.json({ error: { code: "NOT_FOUND", message: "Notification not found." } }, { status: 404, headers: noStore });
    return Response.json({ data: rows[0] }, { headers: noStore });
  } catch (error) {
    return apiError(error);
  }
}
