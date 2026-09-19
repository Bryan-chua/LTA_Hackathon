import { z } from "zod";
import type { TravelCondition } from "../domain";
import { canonicalLineId } from "../canonical-transit";
import { ProviderError, providerFetch, providerMetadata, type ProviderResult } from "../provider-contracts";
import { assertLiveProvidersEnabled } from "./config";

const BASE_URL = "https://datamall2.mytransport.sg/ltaodataservice";

const accountKey = () => {
  assertLiveProvidersEnabled();
  const key = process.env.LTA_DATAMALL_ACCOUNT_KEY;
  if (!key) throw new ProviderError("LTA DataMall", "configuration", "LTA DataMall credentials are not configured.");
  return key;
};

async function dataMall(path: string): Promise<unknown> {
  const response = await providerFetch("LTA DataMall", `${BASE_URL}/${path}`, {
    headers: { AccountKey: accountKey(), accept: "application/json" },
  });
  return response.json();
}

const hashId = (value: string) => {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const trafficRow = z.object({
  Type: z.string(),
  Latitude: z.coerce.number(),
  Longitude: z.coerce.number(),
  Message: z.string(),
}).passthrough();

const trafficEnvelope = z.object({ value: z.array(trafficRow) }).passthrough();

const trafficSeverity = (type: string): TravelCondition["severity"] => {
  if (/road block|diversion|fire|reverse flow/i.test(type)) return "major";
  if (/accident|breakdown|heavy traffic|weather|obstacle|roadwork|plant failure/i.test(type)) return "minor";
  return "info";
};

export async function trafficIncidentConditions(now = new Date()): Promise<ProviderResult<TravelCondition[]>> {
  const parsed = trafficEnvelope.safeParse(await dataMall("TrafficIncidents"));
  if (!parsed.success) throw new ProviderError("LTA DataMall", "invalid_response", "TrafficIncidents returned an invalid response.");
  const observedAt = now.toISOString();
  const staleAt = new Date(now.getTime() + 2 * 60_000).toISOString();
  return {
    data: parsed.data.value.map((row): TravelCondition => ({
      id: `lta-road-${hashId(`${row.Type}|${row.Latitude}|${row.Longitude}|${row.Message}`)}`,
      kind: "road_incident",
      severity: trafficSeverity(row.Type),
      title: row.Message || `${row.Type} affecting road travel`,
      modes: ["bus", "cycle"],
      coordinate: { lat: row.Latitude, lng: row.Longitude },
      radiusMeters: 500,
      validFrom: observedAt,
      validTo: new Date(now.getTime() + 5 * 60_000).toISOString(),
      source: "LTA DataMall TrafficIncidents",
      observedAt,
      isReplay: false,
    })),
    metadata: providerMetadata("LTA DataMall TrafficIncidents", "live", { fetchedAt: observedAt, staleAt }),
  };
}

const facilityRow = z.object({
  Line: z.string(),
  StationCode: z.string(),
  StationName: z.string(),
  LiftID: z.string().optional().default(""),
  LiftDesc: z.string().optional().default(""),
}).passthrough();

const facilityEnvelope = z.object({ value: z.array(facilityRow) }).passthrough();

export async function facilityMaintenanceConditions(now = new Date()): Promise<ProviderResult<TravelCondition[]>> {
  const parsed = facilityEnvelope.safeParse(await dataMall("v2/FacilitiesMaintenance"));
  if (!parsed.success) throw new ProviderError("LTA DataMall", "invalid_response", "FacilitiesMaintenance returned an invalid response.");
  const observedAt = now.toISOString();
  const staleAt = new Date(now.getTime() + 15 * 60_000).toISOString();
  return {
    data: parsed.data.value.map((row): TravelCondition => ({
      id: `lta-lift-${hashId(`${row.Line}|${row.StationCode}|${row.LiftID}|${row.LiftDesc}`)}`,
      kind: "facility_maintenance",
      severity: "major",
      title: `${row.StationName} lift maintenance${row.LiftDesc ? `: ${row.LiftDesc}` : ""}`,
      lineIds: [canonicalLineId(row.Line)],
      stationCodes: [row.StationCode.toUpperCase()],
      modes: ["rail"],
      validFrom: observedAt,
      validTo: staleAt,
      source: "LTA DataMall FacilitiesMaintenance",
      observedAt,
      isReplay: false,
    })),
    metadata: providerMetadata("LTA DataMall FacilitiesMaintenance", "live", { fetchedAt: observedAt, staleAt }),
  };
}

const floodRow = z.object({
  alertId: z.union([z.string(), z.number()]),
  dateTime: z.string(),
  msgType: z.string(),
  severity: z.string(),
  expires: z.string(),
  headline: z.string(),
  description: z.string().optional().default(""),
  instruction: z.string().optional().default(""),
  areaDesc: z.string().optional().default(""),
  circle: z.string(),
  status: z.string().optional().default("Actual"),
}).passthrough();

const floodEnvelope = z.object({ value: z.array(floodRow) }).passthrough();

const parseCircle = (value: string) => {
  const match = /^\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*$/.exec(value);
  if (!match) return undefined;
  return {
    coordinate: { lat: Number(match[1]), lng: Number(match[2]) },
    // LTA documents this as a broadcast radius, not the physical flood extent.
    radiusMeters: Math.max(250, Number(match[3]) * 1000),
  };
};

const floodSeverity = (value: string): TravelCondition["severity"] => {
  if (/extreme|severe/i.test(value)) return "major";
  if (/moderate|minor/i.test(value)) return "minor";
  return "info";
};

export async function floodAlertConditions(now = new Date()): Promise<ProviderResult<TravelCondition[]>> {
  const parsed = floodEnvelope.safeParse(await dataMall("PubFloodAlerts"));
  if (!parsed.success) throw new ProviderError("LTA DataMall", "invalid_response", "PubFloodAlerts returned an invalid response.");
  const observedAt = now.toISOString();
  const conditions = parsed.data.value.flatMap((row): TravelCondition[] => {
    if (/cancel/i.test(row.msgType) || !/actual/i.test(row.status)) return [];
    const area = parseCircle(row.circle);
    if (!area) return [];
    return [{
      id: `lta-flood-${row.alertId}`,
      kind: "flood",
      severity: floodSeverity(row.severity),
      title: [row.headline, row.description || row.areaDesc, row.instruction].filter(Boolean).join(" - "),
      modes: ["walk", "bus", "cycle"],
      coordinate: area.coordinate,
      radiusMeters: area.radiusMeters,
      validFrom: row.dateTime,
      validTo: row.expires,
      source: "LTA DataMall PubFloodAlerts",
      observedAt: row.dateTime,
      isReplay: false,
    }];
  });
  return {
    data: conditions,
    metadata: providerMetadata("LTA DataMall PubFloodAlerts", "live", {
      fetchedAt: observedAt,
      staleAt: new Date(now.getTime() + 3 * 60_000).toISOString(),
      warnings: ["The provider circle is a broadcast radius, not a measured flood boundary."],
    }),
  };
}
