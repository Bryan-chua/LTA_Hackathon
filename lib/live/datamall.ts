import { z } from "zod";
import type { CrowdingLevel, ProviderMode, TravelCondition } from "../domain";
import { canonicalLineId } from "../canonical-transit";
import { ProviderError, providerFetch, providerMetadata, type ProviderResult } from "../provider-contracts";
import { assertLiveProvidersEnabled } from "./config";

const BASE_URL = "https://datamall2.mytransport.sg/ltaodataservice";
const segmentSchema = z.object({
  Line: z.string(),
  Direction: z.string().optional(),
  Stations: z.string().optional().default(""),
  FreePublicBus: z.string().optional(),
  FreeMRTShuttle: z.string().optional(),
  MRTShuttleDirection: z.string().optional(),
}).passthrough();
const alertSchema = z.object({
  Status: z.coerce.number(),
  AffectedSegments: z.array(segmentSchema).optional().default([]),
  Message: z.array(z.object({ Content: z.string(), CreatedDate: z.string().optional() }).passthrough()).optional().default([]),
}).passthrough();
const alertsEnvelope = z.object({ value: z.union([alertSchema, z.array(alertSchema)]) }).passthrough();

const crowdSchema = z.object({
  Station: z.string(),
  StartTime: z.string(),
  EndTime: z.string(),
  CrowdLevel: z.string(),
}).passthrough();
const crowdEnvelope = z.object({ value: z.array(crowdSchema) }).passthrough();
const forecastIntervalSchema = z.object({
  Start: z.string(),
  CrowdLevel: z.string(),
}).passthrough();
const forecastEnvelope = z.object({
  value: z.array(z.object({
    Date: z.string(),
    Stations: z.array(z.object({
      Station: z.string(),
      Interval: z.array(forecastIntervalSchema),
    }).passthrough()),
  }).passthrough()),
}).passthrough();

const accountKey = () => {
  assertLiveProvidersEnabled();
  const key = process.env.LTA_DATAMALL_ACCOUNT_KEY;
  if (!key) throw new ProviderError("LTA DataMall", "configuration", "LTA DataMall credentials are not configured.");
  return key;
};

async function dataMall(path: string, query?: Record<string, string>): Promise<unknown> {
  const url = new URL(`${BASE_URL}/${path}`);
  Object.entries(query ?? {}).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await providerFetch("LTA DataMall", url, { headers: { AccountKey: accountKey(), accept: "application/json" } });
  return response.json();
}

const splitCodes = (value: string) => value.split(/[,\s]+/).map((item) => item.trim().toUpperCase()).filter(Boolean);
const crowdLineCode = (value: string) => {
  const supplied = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const providerAliases: Record<string, string> = {
    CG: "CGL", CGL: "CGL", CE: "CEL", CEL: "CEL",
    BP: "BPL", BPL: "BPL", BPLRT: "BPL",
    SK: "SLRT", STL: "SLRT", SLRT: "SLRT", SKLRT: "SLRT",
    PG: "PLRT", PTL: "PLRT", PLRT: "PLRT", PGLRT: "PLRT",
  };
  return providerAliases[supplied] ?? canonicalLineId(value);
};
const createdDate = (value: string | undefined, fallback: string) => {
  if (!value) return fallback;
  const dotNet = /\/Date\((\d+)/.exec(value);
  if (dotNet) return new Date(Number(dotNet[1])).toISOString();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? fallback : new Date(parsed).toISOString();
};

export async function trainServiceConditions(now = new Date()): Promise<ProviderResult<TravelCondition[]>> {
  const parsed = alertsEnvelope.safeParse(await dataMall("TrainServiceAlerts"));
  if (!parsed.success) throw new ProviderError("LTA DataMall", "invalid_response", "TrainServiceAlerts returned an invalid response.");
  const observedAt = now.toISOString();
  const records = Array.isArray(parsed.data.value) ? parsed.data.value : [parsed.data.value];
  const record = records[0];
  const conditions = (record?.AffectedSegments ?? []).map((segment, index): TravelCondition => {
    const message = record.Message[index]?.Content ?? record.Message[0]?.Content;
    const metadata = providerMetadata("LTA DataMall TrainServiceAlerts", "live", {
      fetchedAt: observedAt,
      validFrom: observedAt,
      staleAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
      warnings: [
        segment.FreePublicBus ? `Free public bus: ${segment.FreePublicBus}` : "",
        segment.FreeMRTShuttle ? `Free MRT shuttle: ${segment.FreeMRTShuttle}` : "",
      ].filter(Boolean),
    });
    return {
      id: `lta-train-${canonicalLineId(segment.Line)}-${index}-${now.getTime()}`,
      kind: "train_disruption",
      severity: record.Status === 2 ? "major" : "minor",
      title: message ?? `${segment.Line} service disruption`,
      lineIds: [canonicalLineId(segment.Line)],
      stationCodes: splitCodes(segment.Stations),
      validFrom: observedAt,
      source: metadata.source,
      observedAt: createdDate(record.Message[0]?.CreatedDate, observedAt),
      isReplay: false,
      provider: metadata,
    };
  });
  const metadata = providerMetadata("LTA DataMall TrainServiceAlerts", "live", {
    fetchedAt: observedAt,
    staleAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
  });
  return { data: conditions, metadata };
}

interface CacheEntry { expiresAt: number; value: ProviderResult<Map<string, CrowdingLevel>> }
const crowdCache = new Map<string, CacheEntry>();
const crowdLevel = (value: string): CrowdingLevel => ({ l: "low", m: "moderate", h: "high" })[value.toLowerCase()] as CrowdingLevel | undefined ?? "unknown";
const singaporeMinutes = (value: Date | string) => {
  const parts = new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(typeof value === "string" ? new Date(value) : value);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value ?? 0);
  return part("hour") * 60 + part("minute");
};

export async function crowdingForLine(lineId: string, mode: "realtime" | "forecast", now = new Date()): Promise<ProviderResult<Map<string, CrowdingLevel>>> {
  const providerLine = crowdLineCode(lineId);
  const cacheKey = `${mode}:${providerLine}`;
  const cached = crowdCache.get(cacheKey);
  if (cached && cached.expiresAt > now.getTime()) return {
    data: new Map(cached.value.data),
    metadata: { ...cached.value.metadata, mode: "cached", warnings: [...cached.value.metadata.warnings, "Reused within provider refresh window."] },
  };
  const path = mode === "realtime" ? "PCDRealTime" : "PCDForecast";
  const payload = await dataMall(path, { TrainLine: providerLine });
  let map: Map<string, CrowdingLevel>;
  let validFrom: string | undefined;
  let validTo: string | undefined;
  const warnings: string[] = [];
  if (mode === "realtime") {
    const parsed = crowdEnvelope.safeParse(payload);
    if (!parsed.success) throw new ProviderError("LTA DataMall", "invalid_response", `${path} returned an invalid response.`);
    const target = now.getTime();
    const matching = parsed.data.value.filter((row) => {
      const start = Date.parse(row.StartTime), end = Date.parse(row.EndTime);
      return Number.isNaN(start) || Number.isNaN(end) || (start <= target && target <= end);
    });
    const values = matching.length > 0 ? matching : parsed.data.value;
    map = new Map(values.map((row) => [row.Station.toUpperCase(), crowdLevel(row.CrowdLevel)]));
    validFrom = values.map((row) => row.StartTime).sort()[0];
    validTo = values.map((row) => row.EndTime).sort().at(-1);
  } else {
    const parsed = forecastEnvelope.safeParse(payload);
    if (!parsed.success || parsed.data.value.length === 0) {
      throw new ProviderError("LTA DataMall", "invalid_response", `${path} returned an invalid response.`);
    }
    const day = [...parsed.data.value].sort((left, right) =>
      Math.abs(Date.parse(left.Date) - now.getTime()) - Math.abs(Date.parse(right.Date) - now.getTime()))[0];
    const targetMinutes = singaporeMinutes(now);
    map = new Map(day.Stations.map((station) => {
      const intervals = [...station.Interval].sort((left, right) => Date.parse(left.Start) - Date.parse(right.Start));
      const selected = intervals.filter((interval) => singaporeMinutes(interval.Start) <= targetMinutes).at(-1) ?? intervals[0];
      return [station.Station.toUpperCase(), crowdLevel(selected?.CrowdLevel ?? "NA")];
    }));
    const starts = day.Stations.flatMap((station) => station.Interval.map((interval) => interval.Start)).sort();
    validFrom = starts[0];
    const finalStart = starts.at(-1);
    validTo = finalStart ? new Date(Date.parse(finalStart) + 30 * 60_000).toISOString() : undefined;
    if (validTo && Date.parse(validTo) < now.getTime()) warnings.push("Provider forecast window is older than the requested traversal time.");
  }
  const ttl = mode === "realtime" ? 10 * 60_000 : 30 * 60_000;
  const providerMode: ProviderMode = mode === "realtime" ? "live" : "forecast";
  const result = {
    data: map,
    metadata: providerMetadata(`LTA DataMall ${path}`, providerMode, {
      fetchedAt: now.toISOString(),
      validFrom,
      validTo,
      staleAt: mode === "forecast" ? validTo : new Date(now.getTime() + ttl).toISOString(),
      warnings,
    }),
  };
  crowdCache.set(cacheKey, { expiresAt: now.getTime() + ttl, value: result });
  return result;
}
