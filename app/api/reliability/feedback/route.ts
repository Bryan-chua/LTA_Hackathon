import { apiError, invalidRequest } from "@/lib/application/http";
import { noStore } from "@/lib/application/demand-http";
import { assertSameOrigin } from "@/lib/server/push-store";
import { feedbackSchema, forecastCookie, saveForecastFeedback } from "@/lib/server/reliability-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const publicId = forecastCookie(request);
    if (!publicId) return invalidRequest("Reliability improvement consent is required.");
    const parsed = feedbackSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalidRequest(parsed.error.issues[0]?.message ?? "Invalid feedback.");
    await saveForecastFeedback(publicId, parsed.data);
    return Response.json({ data: { saved: true } }, { headers: noStore });
  } catch (error) {
    return apiError(error);
  }
}
