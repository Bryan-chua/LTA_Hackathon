import { apiError } from "@/lib/application/http";
import { noStore } from "@/lib/application/demand-http";
import { assertSameOrigin } from "@/lib/server/push-store";
import {
  FORECAST_COOKIE,
  createForecastInstallation,
  deleteForecastInstallation,
  forecastCookie,
} from "@/lib/server/reliability-store";

export const runtime = "nodejs";

const cookieValue = (value: string, request: Request, maxAge: number) => {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${FORECAST_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
};

export async function GET(request: Request) {
  return Response.json({ data: { consented: Boolean(forecastCookie(request)) } }, { headers: noStore });
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const publicId = await createForecastInstallation(forecastCookie(request));
    return Response.json({ data: { consented: true } }, {
      headers: { ...noStore, "Set-Cookie": cookieValue(publicId, request, 90 * 24 * 60 * 60) },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const publicId = forecastCookie(request);
    if (publicId) await deleteForecastInstallation(publicId);
    return Response.json({ data: { consented: false } }, {
      headers: { ...noStore, "Set-Cookie": cookieValue("", request, 0) },
    });
  } catch (error) {
    return apiError(error);
  }
}
