import { DEMAND_COOKIE, DEMAND_TTL_MS, demandCookie, demandDemoEnabled, demandStore } from "./demand-store";
import { isDemandProfile } from "../demand-flow";
import { isScenarioId } from "./http";
import { scenarios } from "../fixtures";
import { reliefTelJourney } from "../demand-flow";

export const noStore = { "Cache-Control": "no-store, private" };
const fail = (message: string, status: number) => Response.json({ error: { code: "DEMAND_ERROR", message } }, { status, headers: noStore });

export async function handleDemandRequest(request: Request): Promise<Response> {
  if (!demandDemoEnabled()) return fail("Demand demo is disabled on this deployment.", 404);
  const id = demandCookie(request);
  if (request.method === "GET") {
    return Response.json({ data: { participating: demandStore.has(id) } }, { headers: noStore });
  }
  // Browser writes require a same-origin request, in addition to SameSite cookies.
  const origin = request.headers.get("origin");
  let browserOrigin: URL;
  try {
    browserOrigin = new URL(origin ?? "");
  } catch { return fail("Same-origin request required.", 403); }
  // Next may normalise request.url to localhost behind its server. The browser Host
  // remains the destination authority; do not trust arbitrary forwarded-host headers.
  const host = request.headers.get("host") ?? new URL(request.url).host;
  if (browserOrigin.origin !== origin || browserOrigin.host !== host ||
      !["http:", "https:"].includes(browserOrigin.protocol)) return fail("Same-origin request required.", 403);
  const secure = browserOrigin.protocol === "https:" ? "; Secure" : "";
  const cookie = (value: string, age: number) => `${DEMAND_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure}`;
  if (request.method === "DELETE") {
    demandStore.withdraw(id);
    return Response.json({ data: { participating: false } }, {
      headers: { ...noStore, "Set-Cookie": cookie("", 0) },
    });
  }
  if (request.method !== "POST") return fail("Method not allowed.", 405);
  const text = await request.text();
  if (text.length > 1024) return fail("Request too large.", 413);
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail("Expected an object.", 400);
    body = parsed as Record<string, unknown>;
  } catch { return fail("Invalid JSON.", 400); }

  if (body.action === "consent" && body.consent === true && Object.keys(body).length === 2) {
    try {
      const token = demandStore.consent(id);
      return Response.json({ data: { participating: true } }, {
        headers: { ...noStore, "Set-Cookie": cookie(token, DEMAND_TTL_MS / 1000) },
      });
    } catch { return fail("Demand demo is full. Try again later.", 503); }
  }
  if (body.action !== "accept" || !isScenarioId(body.scenarioId) ||
      !isDemandProfile(body.profile) || body.profile === "unavailable" ||
      typeof body.journeyId !== "string" || Object.keys(body).length !== 4) {
    return fail("Expected a valid demo route acceptance.", 400);
  }
  if (!id || !demandStore.has(id)) return fail("Consent expired or missing. Please opt in again.", 403);
  const scenario = scenarios[body.scenarioId];
  const catalog = [scenario.usualJourney, scenario.recommendedJourney,
    ...(scenario.recommendedJourney ? [reliefTelJourney(scenario.recommendedJourney)] : [])];
  if (!catalog.some((journey) => journey?.id === body.journeyId)) return fail("Unknown demo journey.", 400);
  demandStore.accept(id, { scenarioId: body.scenarioId, profile: body.profile, journeyId: body.journeyId });
  return Response.json({ data: { participating: true } }, { headers: noStore });
}
