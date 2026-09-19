import { z } from "zod";
import type { Journey, TravelCondition } from "../domain";
import { ProviderError, providerFetch, providerMetadata, type ProviderResult } from "../provider-contracts";

const FORECAST_URL = "https://api-open.data.gov.sg/v2/real-time/api/two-hr-forecast";
const RAINFALL_URL = "https://api-open.data.gov.sg/v2/real-time/api/rainfall";
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

const rainfallSchema = z.object({
  data: z.object({
    stations: z.array(z.object({
      id: z.string(),
      name: z.string(),
      location: z.object({ latitude: z.number(), longitude: z.number() }),
    }).passthrough()),
    readings: z.array(z.object({
      timestamp: z.string(),
      data: z.array(z.object({ stationId: z.string(), value: z.coerce.number() }).passthrough()),
    }).passthrough()),
    readingUnit: z.string().optional(),
  }).passthrough(),
}).passthrough();

const rainy = (value: string) => /rain|shower|thunder/i.test(value);
const severe = (value: string) => /heavy|thunder/i.test(value);

const distance = (left: { lat: number; lng: number }, right: { latitude: number; longitude: number }) =>
  (left.lat - right.latitude) ** 2 + (left.lng - right.longitude) ** 2;

const distanceMeters = (left: { lat: number; lng: number }, right: { latitude: number; longitude: number }) => {
  const latMeters = (left.lat - right.latitude) * 111_320;
  const lngMeters = (left.lng - right.longitude) * 111_320 * Math.cos(left.lat * Math.PI / 180);
  return Math.hypot(latMeters, lngMeters);
};

export async function weatherConditions(journeys: Journey[], now = new Date()): Promise<ProviderResult<TravelCondition[]>> {
  const walkingPoints = journeys.flatMap((journey) => journey.legs.flatMap((leg) => leg.mode === "walk" && leg.durationMinutes > 0
    ? [{ lat: (leg.from.coordinate.lat + leg.to.coordinate.lat) / 2, lng: (leg.from.coordinate.lng + leg.to.coordinate.lng) / 2 }]
    : []));
  const [forecastResult, rainfallResult] = await Promise.allSettled([
    providerFetch("data.gov.sg two-hour forecast", FORECAST_URL).then((response) => response.json()),
    providerFetch("data.gov.sg rainfall", RAINFALL_URL).then((response) => response.json()),
  ]);
  if (forecastResult.status === "rejected" && rainfallResult.status === "rejected") {
    throw new ProviderError("data.gov.sg weather", "unavailable", "Both forecast and rainfall observations are unavailable.", true);
  }

  const conditions: TravelCondition[] = [];
  const warnings: string[] = [];
  let fetchedAt = now.toISOString();
  let validFrom: string | undefined;
  let validTo: string | undefined;

  if (forecastResult.status === "fulfilled") {
    const parsed = responseSchema.safeParse(forecastResult.value);
    const forecastPayload = parsed.success ? parsed.data : undefined;
    const item = forecastPayload?.data?.items[0] ?? forecastPayload?.items?.[0];
    if (!item) {
      warnings.push("The two-hour forecast returned no usable forecast item.");
    } else {
      const areas = forecastPayload?.data?.area_metadata ?? [];
      const areaByName = new Map(areas.map((area) => [area.name, area]));
      const relevantAreas = new Set(walkingPoints.flatMap((point) => {
        const closest = [...areas].sort((left, right) => distance(point, left.label_location) - distance(point, right.label_location))[0];
        return closest ? [closest.name] : [];
      }));
      fetchedAt = item.updateTimestamp ?? item.update_timestamp ?? fetchedAt;
      validFrom = item.validPeriod?.start ?? item.valid_period?.start;
      validTo = item.validPeriod?.end ?? item.valid_period?.end;
      for (const entry of item.forecasts.filter((forecast) => relevantAreas.has(forecast.area) && rainy(forecast.forecast))) {
        const area = areaByName.get(entry.area);
        conditions.push({
          id: `weather-forecast-${entry.area}-${Date.parse(fetchedAt) || now.getTime()}`,
          kind: "weather",
          severity: severe(entry.forecast) ? "major" : "minor",
          title: `${entry.forecast} forecast in ${entry.area}`,
          modes: ["walk"],
          coordinate: area ? { lat: area.label_location.latitude, lng: area.label_location.longitude } : undefined,
          radiusMeters: area ? 6_000 : undefined,
          validFrom: validFrom ?? now.toISOString(),
          validTo,
          source: "data.gov.sg 2-hour forecast",
          observedAt: fetchedAt,
          isReplay: false,
        });
      }
    }
  } else warnings.push("The two-hour forecast is unavailable.");

  if (rainfallResult.status === "fulfilled") {
    const parsed = rainfallSchema.safeParse(rainfallResult.value);
    const reading = parsed.success ? parsed.data.data.readings.at(-1) : undefined;
    if (!parsed.success || !reading) {
      warnings.push("Rainfall observations returned no usable reading.");
    } else {
      fetchedAt = [fetchedAt, reading.timestamp].sort().at(-1) ?? fetchedAt;
      const stations = new Map(parsed.data.data.stations.map((station) => [station.id, station]));
      const values = new Map(reading.data.map((entry) => [entry.stationId, entry.value]));
      const matched = new Map<string, { point: { lat: number; lng: number }; stationName: string; value: number; distance: number }>();
      for (const point of walkingPoints) {
        const nearest = [...stations.values()].sort((left, right) =>
          distance(point, left.location) - distance(point, right.location))[0];
        if (!nearest) continue;
        const stationDistance = distanceMeters(point, nearest.location);
        const value = values.get(nearest.id) ?? 0;
        if (stationDistance > 5_000 || value <= 0) continue;
        const current = matched.get(nearest.id);
        if (!current || stationDistance < current.distance) {
          matched.set(nearest.id, { point, stationName: nearest.name, value, distance: stationDistance });
        }
      }
      for (const [stationId, match] of matched) {
        conditions.push({
          id: `weather-rainfall-${stationId}-${Date.parse(reading.timestamp) || now.getTime()}`,
          kind: "weather",
          severity: match.value >= 5 ? "major" : "minor",
          title: `${match.value} mm rainfall observed near ${match.stationName}`,
          modes: ["walk"],
          coordinate: match.point,
          radiusMeters: 500,
          validFrom: new Date(Date.parse(reading.timestamp) - 5 * 60_000).toISOString(),
          validTo: new Date(Date.parse(reading.timestamp) + 10 * 60_000).toISOString(),
          source: "data.gov.sg rainfall",
          observedAt: reading.timestamp,
          isReplay: false,
        });
      }
    }
  } else warnings.push("Rainfall observations are unavailable.");

  const metadata = providerMetadata("data.gov.sg forecast + rainfall", "live", {
    fetchedAt,
    validFrom,
    validTo,
    staleAt: validTo ?? new Date(now.getTime() + 10 * 60_000).toISOString(),
    warnings: ["Forecasts are area-level; rainfall readings are station observations.", ...warnings],
  });
  return { data: conditions.map((condition) => ({ ...condition, provider: metadata })), metadata };
}
