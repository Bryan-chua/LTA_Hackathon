import { apiError, invalidRequest } from "@/lib/application/http";
import { noStore } from "@/lib/application/demand-http";
import {
  INSTALLATION_COOKIE, assertSameOrigin, deleteInstallation, installationCookie,
  subscriptionSchema, upsertSubscription,
} from "@/lib/server/push-store";

export const runtime = "nodejs";

const cookieValue = (value: string, request: Request, maxAge: number) => {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${INSTALLATION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
};

export async function POST(request: Request) {
  try {
    if (process.env.PUSH_ENABLED !== "true") return invalidRequest("Commute alerts are disabled.");
    assertSameOrigin(request);
    const parsed = subscriptionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalidRequest(parsed.error.issues[0]?.message ?? "Invalid push subscription.");
    const result = await upsertSubscription(parsed.data);
    return Response.json({ data: { subscribed: true, nextCheckAt: result.nextCheckAt } }, {
      headers: { ...noStore, "Set-Cookie": cookieValue(result.publicId, request, 30 * 24 * 60 * 60) },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const id = installationCookie(request);
    if (id) await deleteInstallation(id);
    return Response.json({ data: { subscribed: false } }, {
      headers: { ...noStore, "Set-Cookie": cookieValue("", request, 0) },
    });
  } catch (error) {
    return apiError(error);
  }
}
