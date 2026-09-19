import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { z } from "zod";
import { canonicalLineId, canonicalStationCodes } from "../canonical-transit";
import type { TravelCondition } from "../domain";
import { ProviderError, providerFetch, providerMetadata, type ProviderResult } from "../provider-contracts";
import { assertLiveProvidersEnabled } from "./config";

const INDEX_URL = "https://datamall2.mytransport.sg/ltaodataservice/GTFSRealtimeTrainTripUpdates";
const indexEnvelope = z.object({
  value: z.array(z.object({ timestamp: z.string(), link: z.string().url() }).passthrough()),
}).passthrough();

const accountKey = () => {
  assertLiveProvidersEnabled();
  const key = process.env.LTA_DATAMALL_ACCOUNT_KEY;
  if (!key) throw new ProviderError("LTA DataMall", "configuration", "LTA DataMall credentials are not configured.");
  return key;
};

const asNumber = (value: number | { toString(): string } | null | undefined) => {
  if (value === null || value === undefined) return undefined;
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? parsed : undefined;
};

const stationCode = (stopId: string) => stopId.toUpperCase().match(/^(EW|NS|NE|CC|DT|TE|CG|CE|BP|SE|SW|PE|PW)\d+[A-Z]?/)?.[0];
const lineFromTrip = (routeId: string, tripId: string) => canonicalLineId((routeId || tripId).split("_")[0] || "");

type FeedMessage = InstanceType<typeof GtfsRealtimeBindings.transit_realtime.FeedMessage>;

export function normalizeTrainTripUpdates(feed: FeedMessage, fallback: Date): TravelCondition[] {
  const headerTimestamp = asNumber(feed.header.timestamp);
  const fallbackObservedAt = headerTimestamp ? new Date(headerTimestamp * 1000).toISOString() : fallback.toISOString();

  return feed.entity.flatMap((entity): TravelCondition[] => {
    const update = entity.tripUpdate;
    if (!update) return [];
    const routeId = update.trip.routeId || "";
    const tripId = update.trip.tripId || entity.id;
    const lineId = lineFromTrip(routeId, tripId);
    if (!lineId) return [];
    const stopUpdates = update.stopTimeUpdate ?? [];

    const delays = [update.delay, ...stopUpdates.flatMap((stop) => [stop.arrival?.delay, stop.departure?.delay])]
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const maxDelaySeconds = delays.length > 0 ? Math.max(0, ...delays) : 0;
    const skipped = stopUpdates
      .filter((stop) => stop.scheduleRelationship === GtfsRealtimeBindings.transit_realtime.TripUpdate.StopTimeUpdate.ScheduleRelationship.SKIPPED)
      .flatMap((stop) => stop.stopId ? [stationCode(stop.stopId)] : [])
      .filter((code): code is string => Boolean(code));
    const cancelled = update.trip.scheduleRelationship === GtfsRealtimeBindings.transit_realtime.TripDescriptor.ScheduleRelationship.CANCELED
      || update.trip.scheduleRelationship === GtfsRealtimeBindings.transit_realtime.TripDescriptor.ScheduleRelationship.DELETED;
    if (!cancelled && skipped.length === 0 && maxDelaySeconds < 120) return [];

    const updateTimestamp = asNumber(update.timestamp);
    const observedAt = updateTimestamp ? new Date(updateTimestamp * 1000).toISOString() : fallbackObservedAt;
    const delayMinutes = Math.ceil(maxDelaySeconds / 60);
    const stationCodes = canonicalStationCodes(skipped);
    const title = cancelled
      ? `${lineId} train trip cancelled`
      : stationCodes.length > 0
        ? `${lineId} train will skip ${stationCodes.join(", ")}`
        : `${lineId} train delayed by about ${delayMinutes} minutes`;
    return [{
      id: `lta-gtfs-${entity.id}`,
      kind: "train_disruption",
      severity: cancelled || stationCodes.length > 0 || delayMinutes >= 10 ? "major" : "minor",
      title,
      lineIds: [lineId],
      stationCodes: stationCodes.length > 0 ? stationCodes : undefined,
      modes: ["rail"],
      expectedDelayMinutes: cancelled ? 15 : Math.max(2, delayMinutes),
      validFrom: observedAt,
      validTo: new Date(Date.parse(observedAt) + 5 * 60_000).toISOString(),
      source: "LTA DataMall GTFS Realtime Train Trip Updates",
      observedAt,
      isReplay: false,
    }];
  });
}

export async function trainTripUpdateConditions(now = new Date()): Promise<ProviderResult<TravelCondition[]>> {
  const indexResponse = await providerFetch("LTA DataMall GTFS Trip Updates", INDEX_URL, {
    headers: { AccountKey: accountKey(), accept: "application/json" },
  });
  const parsed = indexEnvelope.safeParse(await indexResponse.json());
  const item = parsed.success ? parsed.data.value[0] : undefined;
  if (!item) throw new ProviderError("LTA DataMall", "invalid_response", "GTFSRealtimeTrainTripUpdates returned no downloadable feed.");

  const feedResponse = await providerFetch("LTA DataMall GTFS Trip Updates", item.link, { headers: { accept: "application/x-protobuf" } });
  let feed: FeedMessage;
  try {
    feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(await feedResponse.arrayBuffer()));
  } catch {
    throw new ProviderError("LTA DataMall", "invalid_response", "GTFS train trip updates could not be decoded.");
  }
  return {
    data: normalizeTrainTripUpdates(feed, now),
    metadata: providerMetadata("LTA DataMall GTFS Realtime Train Trip Updates", "live", {
      fetchedAt: item.timestamp,
      staleAt: new Date(Date.parse(item.timestamp) + 5 * 60_000).toISOString(),
    }),
  };
}
