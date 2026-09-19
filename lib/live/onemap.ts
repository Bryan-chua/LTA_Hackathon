import { z } from "zod";
import type { Coordinate, Journey, JourneyLeg, Mode, Place, Routine } from "../domain";
import { ProviderError, providerMetadata, type ProviderResult } from "../provider-contracts";
import { assertLiveProvidersEnabled } from "./config";

const BASE_URL = "https://www.onemap.gov.sg";
const searchSchema = z.object({
  results: z.array(z.object({
    ADDRESS: z.string(),
    SEARCHVAL: z.string().optional(),
    LATITUDE: z.coerce.number(),
    LONGITUDE: z.coerce.number(),
  }).passthrough()),
  error: z.string().optional(),
}).passthrough();

const placeSchema = z.object({
  name: z.string().optional(),
  lat: z.coerce.number(),
  lon: z.coerce.number(),
}).passthrough();

const legSchema = z.object({
  mode: z.string(),
  startTime: z.coerce.number().optional(),
  endTime: z.coerce.number().optional(),
  duration: z.coerce.number().optional(),
  from: placeSchema,
  to: placeSchema,
  routeShortName: z.string().optional(),
  routeLongName: z.string().optional(),
  legGeometry: z.object({ points: z.string().optional() }).passthrough().optional(),
  intermediateStops: z.array(placeSchema).optional(),
}).passthrough();

const routeSchema = z.object({
  plan: z.object({
    itineraries: z.array(z.object({
      duration: z.coerce.number(),
      startTime: z.coerce.number(),
      endTime: z.coerce.number(),
      legs: z.array(legSchema),
    }).passthrough()),
  }).passthrough(),
}).passthrough();

export async function oneMapToken(): Promise<string> {
  assertLiveProvidersEnabled();
  const token = process.env.ONEMAP_ACCESS_TOKEN?.trim();
  if (!token) {
    throw new ProviderError(
      "OneMap",
      "configuration",
      "Configure a current ONEMAP_ACCESS_TOKEN.",
    );
  }
  return token;
}

async function authorizedFetch(url: URL): Promise<Response> {
  const token = await oneMapToken();
  const response = await fetch(url, {
    headers: { Authorization: token },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401 || response.status === 403) throw new ProviderError("OneMap", "authentication", "OneMap rejected its credentials.");
  if (response.status === 429) throw new ProviderError("OneMap", "rate_limit", "OneMap rate limit reached.", true);
  if (!response.ok) throw new ProviderError("OneMap", "unavailable", `OneMap returned HTTP ${response.status}.`, response.status >= 500);
  return response;
}

export interface GeocodeResult { name: string; address: string; coordinate: Coordinate }

export async function geocodeOneMap(query: string): Promise<ProviderResult<GeocodeResult[]>> {
  const url = new URL("/api/common/elastic/search", BASE_URL);
  url.searchParams.set("searchVal", query);
  url.searchParams.set("returnGeom", "Y");
  url.searchParams.set("getAddrDetails", "Y");
  url.searchParams.set("pageNum", "1");
  const response = await authorizedFetch(url);
  const parsed = searchSchema.safeParse(await response.json());
  if (!parsed.success || parsed.data.error) throw new ProviderError("OneMap", "invalid_response", parsed.success ? parsed.data.error ?? "Invalid search response." : "Invalid search response.");
  return {
    data: parsed.data.results.slice(0, 8).map((item) => ({
      name: item.SEARCHVAL ?? item.ADDRESS,
      address: item.ADDRESS,
      coordinate: { lat: item.LATITUDE, lng: item.LONGITUDE },
    })),
    metadata: providerMetadata("OneMap Search", "live", { staleAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString() }),
  };
}

function decodePolyline(encoded: string): Coordinate[] {
  const points: Coordinate[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let shift = 0, result = 0, byte: number;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : result >> 1;
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

const toPlace = (value: z.infer<typeof placeSchema>): Place => ({
  name: value.name ?? "Journey point",
  shortName: value.name ?? "Journey point",
  coordinate: { lat: value.lat, lng: value.lon },
});

const toMode = (mode: string): Mode => {
  const value = mode.toLowerCase();
  if (value.includes("walk")) return "walk";
  if (value.includes("bus")) return "bus";
  if (value.includes("bicycle") || value.includes("cycle")) return "cycle";
  return "rail";
};

const stationCode = (name = "") => name.toUpperCase().match(/\b(?:EW|NS|NE|CC|DT|TE|CG|CE|BP|SE|SW|PE|PW)\d+[A-Z]?\b/g) ?? [];
const clock = (epochMs: number) => new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", hour: "2-digit", minute: "2-digit", hour12: false }).format(epochMs);

export class OneMapRoutingProvider {
  readonly source = "onemap" as const;

  async plan(routine: Routine): Promise<Journey[]> {
    const date = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Singapore", month: "2-digit", day: "2-digit", year: "numeric" }).format(new Date()).replace(/\//g, "-");
    const url = new URL("/api/public/routingsvc/route", BASE_URL);
    url.searchParams.set("start", `${routine.origin.coordinate.lat},${routine.origin.coordinate.lng}`);
    url.searchParams.set("end", `${routine.destination.coordinate.lat},${routine.destination.coordinate.lng}`);
    url.searchParams.set("routeType", "pt");
    url.searchParams.set("mode", "transit");
    url.searchParams.set("date", date);
    url.searchParams.set("time", `${routine.departureTime}:00`);
    url.searchParams.set("numItineraries", "3");
    const response = await authorizedFetch(url);
    const parsed = routeSchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.plan.itineraries.length === 0) {
      throw new ProviderError("OneMap", "invalid_response", "OneMap returned no usable public-transport itineraries.");
    }
    const metadata = providerMetadata("OneMap Routing", "live", { staleAt: new Date(Date.now() + 5 * 60_000).toISOString() });
    return parsed.data.plan.itineraries.map((itinerary, journeyIndex): Journey => {
      const legs: JourneyLeg[] = itinerary.legs.map((leg, sequence) => {
        const from = toPlace(leg.from);
        const to = toPlace(leg.to);
        const geometry = leg.legGeometry?.points ? decodePolyline(leg.legGeometry.points) : [from.coordinate, to.coordinate];
        const mode = toMode(leg.mode);
        const lineName = leg.routeLongName ?? leg.routeShortName;
        return {
          id: `onemap-${journeyIndex}-leg-${sequence}`,
          sequence,
          mode,
          from,
          to,
          instruction: mode === "walk" ? `Walk from ${from.shortName} to ${to.shortName}.` : `Take ${lineName ?? mode} to ${to.shortName}.`,
          lineId: mode === "rail" ? leg.routeShortName?.toUpperCase() : leg.routeShortName,
          lineName,
          stationCodes: [...stationCode(from.name), ...stationCode(to.name), ...(leg.intermediateStops ?? []).flatMap((stop) => stationCode(stop.name))],
          durationMinutes: Math.max(1, Math.round((leg.duration ?? ((leg.endTime ?? 0) - (leg.startTime ?? 0)) / 1000) / 60)),
          uncertaintyMinutes: mode === "walk" ? 2 : 5,
          geometry: geometry.length > 1 ? geometry : [from.coordinate, to.coordinate],
        };
      });
      const width = Math.max(6, Math.round(itinerary.duration / 60 * 0.12));
      return {
        id: `onemap-live-${journeyIndex}`,
        name: journeyIndex === 0 ? "OneMap recommended route" : `OneMap alternative ${journeyIndex + 1}`,
        origin: routine.origin,
        destination: routine.destination,
        departureAt: new Date(itinerary.startTime).toISOString(),
        arrival: { p50: clock(itinerary.endTime), earliest: clock(itinerary.endTime - width * 60_000), latest: clock(itinerary.endTime + width * 60_000) },
        legs,
        source: "onemap",
        generatedAt: metadata.fetchedAt,
        provider: metadata,
      };
    });
  }
}
