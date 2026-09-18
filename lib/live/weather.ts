import { z } from "zod";
import type { Journey, TravelCondition } from "../domain";
import { ProviderError, providerFetch, providerMetadata, type ProviderResult } from "../provider-contracts";

const URL = "https://api-open.data.gov.sg/v2/real-time/api/two-hr-forecast";
const forecastSchema = z.object({
  area: z.string(),
  forecast: z.string(),
}).passthrough();
const areaSchema = z.object({
  name: z.string(),
  label_location: z.object({ latitude: z.number(), longitude: z.number() }),
}).passthrough();

const itemSchema = z.object({
  updateTimestamp: z.string().optional(),
  update_timestamp: z.string().optional(),
  validPeriod: z.object({ start: z.string(), end: z.string() }).optional(),
  valid_period: z.object({ start: z.string(), end: z.string() }).optional(),
  forecasts: z.array(forecastSchema),
}).passthrough();
const responseSchema = z.object({
  data: z.object({ items: z.array(itemSchema), area_metadata: z.array(areaSchema).optional().default([]) }).passthrough().optional(),
  items: z.array(itemSchema).optional(),
}).passthrough();

const rainy = (value: string) => /rain|shower|thunder/i.test(value);
const severe = (value: string) => /heavy|thunder/i.test(value);

const distance = (left: { lat: number; lng: number }, right: { latitude: number; longitude: number }) =>
  (left.lat - right.latitude) ** 2 + (left.lng - right.longitude) ** 2;

export async function weatherConditions(journeys: Journey[], now = new Date()): Promise<ProviderResult<TravelCondition[]>> {
  const response = await providerFetch("data.gov.sg weather", URL);
  const parsed = responseSchema.safeParse(await response.json());
  if (!parsed.success) throw new ProviderError("data.gov.sg weather", "invalid_response", "The two-hour forecast returned an invalid response.");
  const item = parsed.data.data?.items[0] ?? parsed.data.items?.[0];
  if (!item) throw new ProviderError("data.gov.sg weather", "invalid_response", "The two-hour forecast contained no forecast item.");
  const walkingPoints = journeys.flatMap((journey) => journey.legs.flatMap((leg) => leg.mode === "walk" && leg.durationMinutes > 0
    ? [{ lat: (leg.from.coordinate.lat + leg.to.coordinate.lat) / 2, lng: (leg.from.coordinate.lng + leg.to.coordinate.lng) / 2 }]
    : []));
  const areas = parsed.data.data?.area_metadata ?? [];
  const relevantAreas = new Set(walkingPoints.flatMap((point) => {
    const closest = [...areas].sort((left, right) => distance(point, left.label_location) - distance(point, right.label_location))[0];
    return closest ? [closest.name] : [];
  }));
  const wet = item.forecasts.filter((entry) => relevantAreas.has(entry.area) && rainy(entry.forecast));
  const metadata = providerMetadata("data.gov.sg 2-hour forecast", "forecast", {
    fetchedAt: item.updateTimestamp ?? item.update_timestamp ?? now.toISOString(),
    validFrom: item.validPeriod?.start ?? item.valid_period?.start,
    validTo: item.validPeriod?.end ?? item.valid_period?.end,
    staleAt: item.validPeriod?.end ?? item.valid_period?.end,
    warnings: ["Area-level forecast; not street-level rainfall."],
  });
  const conditions = walkingPoints.length > 0 && wet.length > 0 ? [{
    id: `weather-${Date.parse(metadata.fetchedAt) || now.getTime()}`,
    kind: "weather" as const,
    severity: wet.some((entry) => severe(entry.forecast)) ? "major" as const : "minor" as const,
    title: `Rain forecast in ${wet.slice(0, 3).map((entry) => entry.area).join(", ")}${wet.length > 3 ? " and other areas" : ""}`,
    validFrom: item.validPeriod?.start ?? item.valid_period?.start ?? now.toISOString(),
    validTo: item.validPeriod?.end ?? item.valid_period?.end,
    source: metadata.source,
    observedAt: metadata.fetchedAt,
    isReplay: false,
    provider: metadata,
  }] : [];
  return { data: conditions, metadata };
}
