import { apiError, invalidRequest } from "@/lib/application/http";
import { noStore } from "@/lib/application/demand-http";
import { database } from "@/lib/server/database";
import { assertSameOrigin, installationCookie } from "@/lib/server/push-store";
import { sendWebPush } from "@/lib/server/web-push";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (process.env.PUSH_ENABLED !== "true" || process.env.PUSH_TEST_ENABLED !== "true") {
      return invalidRequest("Test notifications are disabled.");
    }
    assertSameOrigin(request);
    const publicId = installationCookie(request);
    if (!publicId) return invalidRequest("Enable commute alerts before sending a test.");

    const rows = await database()<Array<{ id: number; push_endpoint: string; push_p256dh: string; push_auth: string }>>`
      update notification_installations
      set last_test_push_at = now(), last_seen_at = now()
      where public_id = ${publicId}
        and disabled_at is null
        and (last_test_push_at is null or last_test_push_at < now() - interval '5 minutes')
      returning id, push_endpoint, push_p256dh, push_auth
    `;
    const target = rows[0];
    if (!target) return Response.json({ error: { code: "RATE_LIMITED", message: "Wait five minutes before another test." } }, { status: 429, headers: noStore });

    try {
      await sendWebPush({ endpoint: target.push_endpoint, p256dh: target.push_p256dh, auth: target.push_auth }, {
        title: "Smart Commute test",
        body: "Notifications are ready for Rachel's morning commute.",
        url: "/",
      }, 300);
    } catch (error) {
      const statusCode = typeof error === "object" && error && "statusCode" in error ? Number(error.statusCode) : 0;
      if (statusCode === 404 || statusCode === 410) {
        await database()`delete from notification_installations where id = ${target.id}`;
      }
      throw error;
    }
    return Response.json({ data: { sent: true } }, { headers: noStore });
  } catch (error) {
    return apiError(error);
  }
}
