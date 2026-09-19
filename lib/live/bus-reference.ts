import { z } from "zod";
import type { Coordinate } from "../domain";
import { ProviderError, providerFetch, providerMetadata, type ProviderResult } from "../provider-contracts";
import { assertLiveProvidersEnabled } from "./config";

const BASE_URL = "https://datamall2.mytransport.sg/ltaodataservice";
const PAGE_SIZE = 500;
const REFERENCE_TTL_MS = 24 * 60 * 60_000;

const accountKey = () => {
  assertLiveProvidersEnabled();
  const key = process.env.LTA_DATAMALL_ACCOUNT_KEY;
  if (!key) throw new ProviderError("LTA DataMall", "configuration", "LTA DataMall credentials are not configured.");
  return key;
};

async function dataMallPage(path: string, skip: number): Promise<unknown> {
  const url = new URL(`${BASE_URL}/${path}`);
  url.searchParams.set("$skip", String(skip));
  const response = await providerFetch("LTA DataMall", url, { headers: { AccountKey: accountKey(), accept: "application/json" } });
  return response.json();
}

async function fetchAllPages<T>(path: string, rowSchema: z.ZodType<T>): Promise<T[]> {
  const envelope = z.object({ value: z.array(rowSchema) }).passthrough();
  const rows: T[] = [];
  for (let skip = 0; ; skip += PAGE_SIZE) {
    const parsed = envelope.safeParse(await dataMallPage(path, skip));
    if (!parsed.success) throw new ProviderError("LTA DataMall", "invalid_response", `${path} returned an invalid response.`);
    rows.push(...parsed.data.value);
    if (parsed.data.value.length < PAGE_SIZE) break;
  }
  return rows;
}

export interface BusStopRecord {
  code: string;
  roadName: string;
  description: string;
  coordinate: Coordinate;
}

export interface BusRouteStop {
  serviceNo: string;
  direction: number;
  sequence: number;
  stopCode: string;
}

const busStopRowSchema = z.object({
  BusStopCode: z.string(),
  RoadName: z.string().optional().default(""),
  Description: z.string().optional().default(""),
  Latitude: z.coerce.number(),
  Longitude: z.coerce.number(),
}).passthrough();

const busRouteRowSchema = z.object({
  ServiceNo: z.string(),
  Direction: z.coerce.number(),
  StopSequence: z.coerce.number(),
  BusStopCode: z.string(),
}).passthrough();

interface ReferenceCacheEntry<T> {
  expiresAt: number;
  pending?: Promise<ProviderResult<T>>;
  value?: ProviderResult<T>;
}

const globalReference = globalThis as typeof globalThis & {
  smartCommuteBusStopsCache?: ReferenceCacheEntry<Map<string, BusStopRecord>>;
  smartCommuteBusRoutesCache?: ReferenceCacheEntry<Map<string, BusRouteStop[]>>;
};

/** Test-only: clears the in-memory reference cache so mocked fetches take effect. */
export function __resetBusReferenceCacheForTests() {
  globalReference.smartCommuteBusStopsCache = undefined;
  globalReference.smartCommuteBusRoutesCache = undefined;
}

function cached<T>(
  read: () => ReferenceCacheEntry<T> | undefined,
  write: (entry: ReferenceCacheEntry<T>) => void,
  loader: () => Promise<ProviderResult<T>>,
  now: Date,
): Promise<ProviderResult<T>> {
  const entry = read();
  if (entry?.value && entry.expiresAt > now.getTime()) {
    return Promise.resolve({
      ...entry.value,
      metadata: { ...entry.value.metadata, mode: "cached", warnings: [...entry.value.metadata.warnings, "Reused within reference-data refresh window."] },
    });
  }
  if (entry?.pending) return entry.pending;
  const pending = loader().then((result) => {
    write({ expiresAt: now.getTime() + REFERENCE_TTL_MS, value: result });
    return result;
  }).catch((error) => {
    write({ expiresAt: entry?.expiresAt ?? 0, value: entry?.value });
    throw error;
  });
  write({ expiresAt: entry?.expiresAt ?? 0, value: entry?.value, pending });
  return pending;
}

export async function busStops(now = new Date()): Promise<ProviderResult<Map<string, BusStopRecord>>> {
  return cached(
    () => globalReference.smartCommuteBusStopsCache,
    (entry) => { globalReference.smartCommuteBusStopsCache = entry; },
    async () => {
      const rows = await fetchAllPages("BusStops", busStopRowSchema);
      const map = new Map(rows.map((row): [string, BusStopRecord] => [row.BusStopCode, {
        code: row.BusStopCode,
        roadName: row.RoadName,
        description: row.Description,
        coordinate: { lat: row.Latitude, lng: row.Longitude },
      }]));
      return {
        data: map,
        metadata: providerMetadata("LTA DataMall BusStops", "live", {
          fetchedAt: now.toISOString(),
          staleAt: new Date(now.getTime() + REFERENCE_TTL_MS).toISOString(),
        }),
      };
    },
    now,
  );
}

export async function busRoutes(now = new Date()): Promise<ProviderResult<Map<string, BusRouteStop[]>>> {
  return cached(
    () => globalReference.smartCommuteBusRoutesCache,
    (entry) => { globalReference.smartCommuteBusRoutesCache = entry; },
    async () => {
      const rows = await fetchAllPages("BusRoutes", busRouteRowSchema);
      const byService = new Map<string, BusRouteStop[]>();
      for (const row of rows) {
        const list = byService.get(row.ServiceNo) ?? [];
        list.push({ serviceNo: row.ServiceNo, direction: row.Direction, sequence: row.StopSequence, stopCode: row.BusStopCode });
        byService.set(row.ServiceNo, list);
      }
      return {
        data: byService,
        metadata: providerMetadata("LTA DataMall BusRoutes", "live", {
          fetchedAt: now.toISOString(),
          staleAt: new Date(now.getTime() + REFERENCE_TTL_MS).toISOString(),
        }),
      };
    },
    now,
  );
}

const EARTH_RADIUS_M = 6_371_000;
function haversineMeters(a: Coordinate, b: Coordinate): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface BusLegStopMatch {
  boardingStopCode: string;
  alightingStopCode: string;
  boardingDistanceMeters: number;
  alightingDistanceMeters: number;
}

/**
 * Matches a bus leg's boarding/alighting coordinates to official stop codes along a
 * service's route, using cached BusStops + BusRoutes reference data. Pure function so
 * matching logic can be unit tested without network access.
 */
export function matchBusLegStops(
  routeStops: BusRouteStop[],
  stopsByCode: Map<string, BusStopRecord>,
  from: Coordinate,
  to: Coordinate,
): BusLegStopMatch | undefined {
  const byDirection = new Map<number, BusRouteStop[]>();
  for (const stop of routeStops) {
    const list = byDirection.get(stop.direction) ?? [];
    list.push(stop);
    byDirection.set(stop.direction, list);
  }

  let best: BusLegStopMatch | undefined;
  let bestTotal = Number.POSITIVE_INFINITY;

  for (const stops of byDirection.values()) {
    const ordered = [...stops].sort((a, b) => a.sequence - b.sequence);
    const withCoordinate = ordered
      .map((stop) => ({ stop, record: stopsByCode.get(stop.stopCode) }))
      .filter((entry): entry is { stop: BusRouteStop; record: BusStopRecord } => Boolean(entry.record));
    if (withCoordinate.length < 2) continue;

    let boardingIndex = -1;
    let boardingDistance = Number.POSITIVE_INFINITY;
    let alightingIndex = -1;
    let alightingDistance = Number.POSITIVE_INFINITY;
    withCoordinate.forEach(({ record }, index) => {
      const fromDistance = haversineMeters(from, record.coordinate);
      if (fromDistance < boardingDistance) { boardingDistance = fromDistance; boardingIndex = index; }
      const toDistance = haversineMeters(to, record.coordinate);
      if (toDistance < alightingDistance) { alightingDistance = toDistance; alightingIndex = index; }
    });

    if (boardingIndex < 0 || alightingIndex < 0 || boardingIndex >= alightingIndex) continue;
    const total = boardingDistance + alightingDistance;
    if (total < bestTotal) {
      bestTotal = total;
      best = {
        boardingStopCode: withCoordinate[boardingIndex].stop.stopCode,
        alightingStopCode: withCoordinate[alightingIndex].stop.stopCode,
        boardingDistanceMeters: Math.round(boardingDistance),
        alightingDistanceMeters: Math.round(alightingDistance),
      };
    }
  }

  return best;
}

/** Resolves a bus leg's boarding/alighting stops using live cached reference data. */
export async function resolveBusLegStops(
  serviceNo: string,
  from: Coordinate,
  to: Coordinate,
  now = new Date(),
): Promise<BusLegStopMatch | undefined> {
  const [routes, stops] = await Promise.all([busRoutes(now), busStops(now)]);
  const routeStops = routes.data.get(serviceNo);
  if (!routeStops || routeStops.length === 0) return undefined;
  return matchBusLegStops(routeStops, stops.data, from, to);
}
