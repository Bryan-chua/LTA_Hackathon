import { z } from "zod";
import type { BusLoadCode } from "../domain";
import { ProviderError, providerFetch, providerMetadata, type ProviderResult } from "../provider-contracts";
import { assertLiveProvidersEnabled } from "./config";

const BASE_URL = "https://datamall2.mytransport.sg/ltaodataservice";
const CACHE_TTL_MS = 20_000;
const STALE_TOLERANCE_MS = 2 * 60_000;

const accountKey = () => {
  assertLiveProvidersEnabled();
  const key = process.env.LTA_DATAMALL_ACCOUNT_KEY;
  if (!key) throw new ProviderError("LTA DataMall", "configuration", "LTA DataMall credentials are not configured.");
  return key;
};

const nextBusSchema = z.object({
  EstimatedArrival: z.string().optional().default(""),
  Load: z.string().optional().default(""),
  Feature: z.string().optional().default(""),
}).passthrough();

const serviceSchema = z.object({
  ServiceNo: z.string(),
  NextBus: nextBusSchema.optional(),
}).passthrough();

const arrivalEnvelope = z.object({
  BusStopCode: z.string(),
  Services: z.array(serviceSchema).optional().default([]),
}).passthrough();

const VALID_LOADS: ReadonlySet<string> = new Set(["SEA", "SDA", "LSD"]);
const asLoad = (value: string): BusLoadCode | undefined => (VALID_LOADS.has(value) ? (value as BusLoadCode) : undefined);

export interface ServiceNextBus {
  serviceNo: string;
  /** ISO datetime as reported by the provider, or undefined if no bus is currently reported. */
  estimatedArrival?: string;
  load?: BusLoadCode;
  wheelchairAccessible?: boolean;
}

interface StopArrivalCache {
  expiresAt: number;
  value: ProviderResult<Map<string, ServiceNextBus>>;
}

const globalArrival = globalThis as typeof globalThis & {
  smartCommuteBusArrivalCache?: Map<string, StopArrivalCache>;
};
const arrivalCache = globalArrival.smartCommuteBusArrivalCache ??= new Map();

/** Test-only: clears the in-memory per-stop cache so mocked fetches take effect. */
export function __resetBusArrivalCacheForTests() {
  arrivalCache.clear();
}

async function fetchStopArrivals(stopCode: string, now: Date): Promise<ProviderResult<Map<string, ServiceNextBus>>> {
  const cached = arrivalCache.get(stopCode);
  if (cached && cached.expiresAt > now.getTime()) {
    return {
      data: new Map(cached.value.data),
      metadata: { ...cached.value.metadata, mode: "cached", warnings: [...cached.value.metadata.warnings, "Reused within provider refresh window."] },
    };
  }
  const url = new URL(`${BASE_URL}/v3/BusArrival`);
  url.searchParams.set("BusStopCode", stopCode);
  const response = await providerFetch("LTA DataMall", url, { headers: { AccountKey: accountKey(), accept: "application/json" } });
  const parsed = arrivalEnvelope.safeParse(await response.json());
  if (!parsed.success) throw new ProviderError("LTA DataMall", "invalid_response", "v3/BusArrival returned an invalid response.");

  const map = new Map(parsed.data.Services.map((service): [string, ServiceNextBus] => [
    service.ServiceNo,
    {
      serviceNo: service.ServiceNo,
      estimatedArrival: service.NextBus?.EstimatedArrival || undefined,
      load: service.NextBus?.Load ? asLoad(service.NextBus.Load) : undefined,
      wheelchairAccessible: service.NextBus?.Feature === "WAB" ? true : undefined,
    },
  ]));
  const result: ProviderResult<Map<string, ServiceNextBus>> = {
    data: map,
    metadata: providerMetadata("LTA DataMall BusArrival", "live", {
      fetchedAt: now.toISOString(),
      staleAt: new Date(now.getTime() + CACHE_TTL_MS).toISOString(),
    }),
  };
  arrivalCache.set(stopCode, { expiresAt: now.getTime() + CACHE_TTL_MS, value: result });
  return result;
}

/**
 * Fetches v3/BusArrival only for the given stop codes (the stops actually used by
 * current candidate journeys), never bulk-querying every stop. Failures for one stop
 * do not affect the others.
 */
export async function busArrivalsForStops(
  stopCodes: readonly string[],
  now = new Date(),
): Promise<Map<string, PromiseSettledResult<ProviderResult<Map<string, ServiceNextBus>>>>> {
  const unique = [...new Set(stopCodes)];
  const results = await Promise.allSettled(unique.map((code) => fetchStopArrivals(code, now)));
  return new Map(unique.map((code, index) => [code, results[index]]));
}

/**
 * Converts a raw NextBus reading into minutes-from-now, treating a missing or
 * already-elapsed estimate (beyond a small tolerance) as stale rather than inventing
 * a favourable ETA.
 */
export function etaMinutesFromNow(estimatedArrival: string | undefined, now: Date): number | undefined {
  if (!estimatedArrival) return undefined;
  const parsed = Date.parse(estimatedArrival);
  if (Number.isNaN(parsed)) return undefined;
  if (parsed < now.getTime() - STALE_TOLERANCE_MS) return undefined;
  return Math.max(0, Math.round((parsed - now.getTime()) / 60_000));
}
