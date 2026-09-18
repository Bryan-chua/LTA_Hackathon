import { apiError, invalidRequest } from "@/lib/application/http";
import { noStore } from "@/lib/application/demand-http";
import { assertSameOrigin, evaluationProfileSchema, installationCookie, updateProfile } from "@/lib/server/push-store";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const id = installationCookie(request);
    if (!id) return Response.json({ error: { code: "NOT_SUBSCRIBED", message: "Enable commute alerts first." } }, { status: 401, headers: noStore });
    const parsed = evaluationProfileSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalidRequest(parsed.error.issues[0]?.message ?? "Invalid evaluation profile.");
    const result = await updateProfile(id, parsed.data);
    return Response.json({ data: result }, { headers: noStore });
  } catch (error) {
    return apiError(error);
  }
}
