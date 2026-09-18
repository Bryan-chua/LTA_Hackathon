import { z } from "zod";
import { geocodeOneMap } from "@/lib/live/onemap";
import { apiError, invalidRequest } from "@/lib/application/http";
import { noStore } from "@/lib/application/demand-http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const parsed = z.object({ query: z.string().trim().min(3).max(120) }).safeParse(body);
    if (!parsed.success) return invalidRequest("Enter at least three characters to search for a Singapore address.");
    const result = await geocodeOneMap(parsed.data.query);
    return Response.json({ data: result.data, provider: result.metadata }, { headers: noStore });
  } catch (error) {
    return apiError(error);
  }
}
