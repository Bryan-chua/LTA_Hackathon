import type { Coordinate, Journey, ProviderMetadata, ShelterCoverageEvidence } from "../domain";
import { ProviderError, providerFetch, providerMetadata, type ProviderResult } from "../provider-contracts";
import { assertLiveProvidersEnabled } from "./config";
import shp from "shpjs";

const BASE_URL = "https://datamall2.mytransport.sg/ltaodataservice";
const CACHE_TTL_MS = 15 * 60_000;
type LayerId = "CoveredLinkWay" | "Footpath" | "TrainStationExit";
type GeoFeature = { geometry?: { coordinates?: unknown }; properties?: Record<string, unknown> };
type GeoJson = { type?: string; features?: GeoFeature[] };
type CacheEntry = { value: GeoJson; metadata: ProviderMetadata; expiresAt: number };
const cache = new Map<LayerId, CacheEntry>();

const accountKey = () => {
  assertLiveProvidersEnabled();
  const value = process.env.LTA_DATAMALL_ACCOUNT_KEY?.trim();
  if (!value) throw new ProviderError("LTA DataMall geospatial", "configuration", "LTA DataMall credentials are not configured.");
  return value;
};
const asGeoJson = (value: unknown): GeoJson | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as GeoJson;
  return candidate.type === "FeatureCollection" && Array.isArray(candidate.features) ? candidate : undefined;
};
const linkFrom = (value: unknown): string | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const field of ["url", "URL", "downloadUrl", "DownloadURL", "link", "Link"]) {
    if (typeof record[field] === "string" && /^https?:\/\//i.test(record[field] as string)) return record[field] as string;
  }
  return Array.isArray(record.value) ? linkFrom(record.value[0]) : undefined;
};

async function loadLayer(layer: LayerId, now = new Date()): Promise<ProviderResult<GeoJson>> {
  const cached = cache.get(layer);
  if (cached && cached.expiresAt > now.getTime()) return { data: cached.value, metadata: cached.metadata };
  const response = await providerFetch("LTA DataMall geospatial", `${BASE_URL}/GeospatialWholeIsland?ID=${layer}`, {
    headers: { AccountKey: accountKey(), accept: "application/json, application/geo+json, application/octet-stream" },
  }, 15_000);
  const bytes = await response.arrayBuffer();
  let parsed: GeoJson | undefined;
  const text = new TextDecoder().decode(bytes);
  try { parsed = asGeoJson(JSON.parse(text)); } catch { parsed = undefined; }
  if (!parsed) {
    let signedUrl: string | undefined;
    try { signedUrl = linkFrom(JSON.parse(text)); } catch { signedUrl = undefined; }
    if (signedUrl) {
      const linked = await providerFetch("LTA DataMall geospatial", signedUrl, {}, 15_000);
      if ((linked.headers.get("content-type") ?? "").includes("json")) {
        try { parsed = asGeoJson(await linked.json()); } catch { parsed = undefined; }
      } else {
        try {
          const converted = await shp(await linked.arrayBuffer());
          parsed = asGeoJson(Array.isArray(converted) ? converted[0] : converted);
        } catch { parsed = undefined; }
      }
    }
  }
  if (!parsed) {
    try {
      const converted = await shp(bytes);
      parsed = asGeoJson(Array.isArray(converted) ? converted[0] : converted);
    } catch { parsed = undefined; }
  }
  if (!parsed) throw new ProviderError("LTA DataMall geospatial", "invalid_response", `${layer} was not returned as usable GeoJSON.`);
  const metadata = providerMetadata(`LTA DataMall ${layer}`, "live", {
    fetchedAt: now.toISOString(),
    staleAt: new Date(now.getTime() + CACHE_TTL_MS).toISOString(),
    warnings: ["Only reliably matched GeoJSON/Shapefile features are used; malformed or unmatched data remains unverified."],
  });
  cache.set(layer, { value: parsed, metadata, expiresAt: now.getTime() + CACHE_TTL_MS });
  return { data: parsed, metadata };
}

const distance = (a: Coordinate, b: Coordinate) => {
  const lat = ((a.lat + b.lat) / 2) * Math.PI / 180;
  const dx = (a.lng - b.lng) * 111_320 * Math.cos(lat);
  const dy = (a.lat - b.lat) * 110_540;
  return Math.sqrt(dx * dx + dy * dy);
};
const points = (value: unknown): Coordinate[] => {
  if (!Array.isArray(value)) return [];
  if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") return [{ lng: value[0], lat: value[1] }];
  return value.flatMap(points);
};
const coverageFor = (route: Coordinate[], features: GeoFeature[]): ShelterCoverageEvidence => {
  if (route.length < 2 || features.length === 0) return { status: "unverified", warning: "Sheltered walking coverage could not be matched reliably." };
  let total = 0;
  let covered = 0;
  for (let index = 1; index < route.length; index += 1) {
    const from = route[index - 1]!;
    const to = route[index]!;
    const length = distance(from, to);
    total += length;
    const midpoint = { lng: (from.lng + to.lng) / 2, lat: (from.lat + to.lat) / 2 };
    if (features.some((feature) => points(feature.geometry?.coordinates).some((point) => distance(point, midpoint) <= 25))) covered += length;
  }
  if (total <= 0 || covered <= 0) return { status: "unverified", warning: "Outdoor exposure is unverified for this walking leg." };
  return { status: "verified", coveredDistanceMeters: Math.round(covered), exposedDistanceMeters: Math.round(Math.max(0, total - covered)) };
};

export async function shelterCoverageForJourneys(journeys: Journey[], now = new Date()): Promise<ProviderResult<Journey[]>> {
  const covered = await loadLayer("CoveredLinkWay", now);
  await Promise.all([loadLayer("Footpath", now), loadLayer("TrainStationExit", now)]);
  return {
    data: journeys.map((journey) => ({ ...journey, legs: journey.legs.map((leg) => leg.mode === "walk"
      ? { ...leg, shelterCoverage: { ...coverageFor(leg.geometry, covered.data.features ?? []), source: covered.metadata } }
      : leg) })),
    metadata: covered.metadata,
  };
}

export function clearGeospatialCache() { cache.clear(); }
