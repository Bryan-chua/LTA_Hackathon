import { z } from "zod";
import { canonicalLineId } from "../canonical-transit";
import type { Coordinate, Journey, JourneyLeg, Mode, Place, Routine } from "../domain";
import { ProviderError, providerFetch, providerMetadata } from "../provider-contracts";
import { assertLiveProvidersEnabled } from "./config";

const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const FIELD_MASK = [
  "routes.duration",
  "routes.legs.steps.staticDuration",
  "routes.legs.steps.travelMode",
  "routes.legs.steps.startLocation",
  "routes.legs.steps.endLocation",
  "routes.legs.steps.navigationInstruction.instructions",
  "routes.legs.steps.polyline.encodedPolyline",
  "routes.legs.steps.transitDetails",
].join(",");

const latLngSchema = z.object({
  latitude: z.coerce.number(),
  longitude: z.coerce.number(),
});
const locationSchema = z.object({ latLng: latLngSchema }).passthrough();
const polylineSchema = z.object({ encodedPolyline: z.string() }).passthrough();
const stopSchema = z.object({ name: z.string(), location: locationSchema }).passthrough();
const transitDetailsSchema = z.object({
  stopDetails: z.object({
    departureStop: stopSchema,
    arrivalStop: stopSchema,
    intermediateStops: z.array(stopSchema).optional(),
  }).passthrough(),
  transitLine: z.object({
    name: z.string().optional(),
    nameShort: z.string().optional(),
    vehicle: z.object({ type: z.string() }).passthrough(),
  }).passthrough(),
}).passthrough();
const stepSchema = z.object({
  staticDuration: z.string().optional(),
  travelMode: z.string(),
  startLocation: locationSchema,
  endLocation: locationSchema,
  navigationInstruction: z.object({ instructions: z.string() }).passthrough().optional(),
  polyline: polylineSchema.optional(),
  transitDetails: transitDetailsSchema.optional(),
}).passthrough();
const responseSchema = z.object({
  routes: z.array(z.object({
    duration: z.string(),
    legs: z.array(z.object({ steps: z.array(stepSchema).min(1) }).passthrough()).min(1),
  }).passthrough()).min(1),
}).passthrough();

export function googleRoutesApiKey(): string {
  assertLiveProvidersEnabled();
  const key = process.env.GOOGLE_MAPS_ROUTES_API_KEY?.trim() || process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) {
    throw new ProviderError("Google Routes", "configuration", "GOOGLE_MAPS_ROUTES_API_KEY or GOOGLE_MAPS_API_KEY is not configured.");
  }
  return key;
}

function decodePolyline(encoded: string): Coordinate[] {
  const points: Coordinate[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : result >> 1;
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

const coordinate = (location: z.infer<typeof locationSchema>): Coordinate => ({
  lat: location.latLng.latitude,
  lng: location.latLng.longitude,
});
const place = (name: string, location: z.infer<typeof locationSchema>): Place => ({
  name,
  shortName: name,
  coordinate: coordinate(location),
});
const durationSeconds = (duration = "0s") => {
  const seconds = Number(duration.replace(/s$/, ""));
  return Number.isFinite(seconds) ? seconds : 0;
};
const stationCodes = (names: string[]) => [
  ...new Set(names.flatMap((name) =>
    name.toUpperCase().match(/\b(?:EW|NS|NE|CC|DT|TE|CG|CE|BP|SE|SW|PE|PW)\d+[A-Z]?\b/g) ?? [])),
];
const modeForStep = (step: z.infer<typeof stepSchema>): Mode => {
  if (step.travelMode === "WALK") return "walk";
  if (step.travelMode === "BICYCLE") return "cycle";
  if (step.transitDetails?.transitLine.vehicle.type === "BUS") return "bus";
  return "rail";
};
const clock = (date: Date) => new Intl.DateTimeFormat("en-SG", {
  timeZone: "Asia/Singapore",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
}).format(date);

function nextDeparture(routine: Routine, now: Date): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: "year" | "month" | "day") =>
    Number(parts.find((value) => value.type === type)?.value);
  const [hour, minute] = routine.departureTime.split(":").map(Number);
  const localDate = new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
  const departure = new Date(localDate.getTime() + ((hour * 60 + minute) - 480) * 60_000);
  const allowedDays = new Set(routine.weekdays);

  while (departure <= now || (allowedDays.size > 0 && !allowedDays.has(localDate.getUTCDay()))) {
    localDate.setUTCDate(localDate.getUTCDate() + 1);
    departure.setUTCDate(departure.getUTCDate() + 1);
  }
  return departure;
}

function toLeg(step: z.infer<typeof stepSchema>, routeIndex: number, sequence: number): JourneyLeg {
  const transit = step.transitDetails;
  const from = transit
    ? place(transit.stopDetails.departureStop.name, transit.stopDetails.departureStop.location)
    : place(sequence === 0 ? "Journey start" : "Transfer point", step.startLocation);
  const to = transit
    ? place(transit.stopDetails.arrivalStop.name, transit.stopDetails.arrivalStop.location)
    : place("Journey point", step.endLocation);
  const mode = modeForStep(step);
  const lineName = transit?.transitLine.name ?? transit?.transitLine.nameShort;
  const lineIdentifier = transit?.transitLine.nameShort ?? lineName;
  const stopNames = transit
    ? [
      transit.stopDetails.departureStop.name,
      ...(transit.stopDetails.intermediateStops ?? []).map((stop) => stop.name),
      transit.stopDetails.arrivalStop.name,
    ]
    : [];
  const geometry = step.polyline
    ? decodePolyline(step.polyline.encodedPolyline)
    : [from.coordinate, to.coordinate];

  return {
    id: "google-" + routeIndex + "-leg-" + sequence,
    sequence,
    mode,
    from,
    to,
    instruction: step.navigationInstruction?.instructions
      ?? (mode === "walk" ? "Walk to " + to.shortName + "." : "Take " + (lineName ?? mode) + " to " + to.shortName + "."),
    lineId: lineIdentifier ? canonicalLineId(lineIdentifier) : undefined,
    lineName,
    stationCodes: stationCodes(stopNames),
    durationMinutes: Math.max(1, Math.round(durationSeconds(step.staticDuration) / 60)),
    uncertaintyMinutes: mode === "walk" ? 2 : 5,
    geometry: geometry.length > 1 ? geometry : [from.coordinate, to.coordinate],
  };
}

export class GoogleRoutesRoutingProvider {
  readonly source = "google" as const;

  async plan(routine: Routine, now = new Date()): Promise<Journey[]> {
    const departure = nextDeparture(routine, now);
    const response = await providerFetch("Google Routes", ROUTES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": googleRoutesApiKey(),
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        origin: { location: { latLng: {
          latitude: routine.origin.coordinate.lat,
          longitude: routine.origin.coordinate.lng,
        } } },
        destination: { location: { latLng: {
          latitude: routine.destination.coordinate.lat,
          longitude: routine.destination.coordinate.lng,
        } } },
        travelMode: "TRANSIT",
        departureTime: departure.toISOString(),
        computeAlternativeRoutes: true,
        languageCode: "en-SG",
        units: "METRIC",
        transitPreferences: {
          allowedTravelModes: ["BUS", "SUBWAY", "TRAIN", "LIGHT_RAIL", "RAIL"],
        },
      }),
    }, 10_000);

    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new ProviderError(
        "Google Routes",
        "invalid_response",
        "Google Routes returned no usable public-transport routes.",
      );
    }

    const metadata = providerMetadata("Google Routes", "live", {
      staleAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
    });

    return parsed.data.routes.map((route, routeIndex): Journey => {
      const legs = route.legs
        .flatMap((leg) => leg.steps)
        .map((step, sequence) => toLeg(step, routeIndex, sequence));
      const duration = durationSeconds(route.duration);
      const arrival = new Date(departure.getTime() + duration * 1000);
      const uncertaintyMinutes = Math.max(6, Math.round(duration / 60 * 0.12));

      return {
        id: "google-live-" + routeIndex,
        name: routeIndex === 0
          ? "Google recommended transit route"
          : "Google transit alternative " + (routeIndex + 1),
        origin: routine.origin,
        destination: routine.destination,
        departureAt: departure.toISOString(),
        arrival: {
          p50: clock(arrival),
          earliest: clock(new Date(arrival.getTime() - uncertaintyMinutes * 60_000)),
          latest: clock(new Date(arrival.getTime() + uncertaintyMinutes * 60_000)),
        },
        legs,
        source: "google",
        generatedAt: metadata.fetchedAt,
        provider: metadata,
      };
    });
  }
}

export class GoogleRoutesProvider extends GoogleRoutesRoutingProvider {}
