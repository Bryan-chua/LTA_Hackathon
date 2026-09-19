import type { BusArrivalInfo, Journey, JourneyLeg, ProviderMetadata } from "../domain";
import { providerMetadata } from "../provider-contracts";
import type { ProviderStateView } from "../application/journey-view-model";
import { busArrivalsForStops, etaMinutesFromNow, type ServiceNextBus } from "./bus-arrival";
import { resolveBusLegStops } from "./bus-reference";

const providerView = (metadata: ProviderMetadata): ProviderStateView => ({
  name: metadata.source,
  status: "available",
  mode: metadata.mode,
  fetchedAt: metadata.fetchedAt,
  staleAt: metadata.staleAt,
  warnings: metadata.warnings,
});

const failedProvider = (name: string, error: unknown): ProviderStateView => ({
  name,
  status: "degraded",
  mode: "live",
  fetchedAt: new Date().toISOString(),
  warnings: [error instanceof Error ? error.message : `${name} unavailable.`],
});

const unavailable = (reason: string, extra: Partial<BusArrivalInfo> = {}): BusArrivalInfo => ({
  status: "unavailable",
  reason,
  ...extra,
});

/**
 * Attaches live BusArrival (ETA + Load) data to every bus leg across the supplied
 * journeys. Bus stops used only by non-candidate journeys are never queried, and
 * DataMall is queried once per distinct boarding stop actually in use. On any
 * resolution or provider failure the leg is marked unavailable rather than given a
 * fabricated ETA or load.
 */
export async function enrichBusLegs(
  journeys: Journey[],
  now = new Date(),
): Promise<{ journeys: Journey[]; providers: ProviderStateView[] }> {
  const busLegs = journeys.flatMap((journey) => journey.legs.filter((leg) => leg.mode === "bus" && leg.lineId));
  if (busLegs.length === 0) return { journeys, providers: [] };

  const providers: ProviderStateView[] = [];
  const matches = new Map<string, Awaited<ReturnType<typeof resolveBusLegStops>>>();

  await Promise.all(busLegs.map(async (leg) => {
    try {
      const match = await resolveBusLegStops(leg.lineId!, leg.from.coordinate, leg.to.coordinate, now);
      matches.set(leg.id, match);
    } catch {
      matches.set(leg.id, undefined);
    }
  }));

  const referenceFailed = busLegs.length > 0 && [...matches.values()].every((match) => match === undefined);
  if (referenceFailed) {
    providers.push(failedProvider("LTA DataMall Bus reference", "Bus stop reference data (BusStops/BusRoutes) is unavailable."));
  } else {
    providers.push(providerView(providerMetadata("LTA DataMall Bus reference", "cached", { fetchedAt: now.toISOString() })));
  }

  const boardingStopCodes = [...new Set([...matches.values()].flatMap((match) => (match ? [match.boardingStopCode] : [])))];
  const arrivalsByStop = boardingStopCodes.length > 0 ? await busArrivalsForStops(boardingStopCodes, now) : new Map();

  for (const [stopCode, result] of arrivalsByStop) {
    if (result.status === "fulfilled") providers.push(providerView(result.value.metadata));
    else providers.push(failedProvider(`LTA DataMall BusArrival ${stopCode}`, result.reason));
  }

  const resolveLeg = (leg: JourneyLeg): JourneyLeg => {
    if (leg.mode !== "bus" || !leg.lineId) return leg;
    const match = matches.get(leg.id);
    if (!match) {
      return { ...leg, busArrival: unavailable("Bus stop could not be matched to LTA reference data.", { serviceNo: leg.lineId }) };
    }
    const stopResult = arrivalsByStop.get(match.boardingStopCode);
    if (!stopResult || stopResult.status === "rejected") {
      return {
        ...leg,
        busArrival: unavailable("Bus arrival data is unavailable for this stop.", {
          serviceNo: leg.lineId,
          boardingStopCode: match.boardingStopCode,
          alightingStopCode: match.alightingStopCode,
        }),
      };
    }
    const service: ServiceNextBus | undefined = stopResult.value.data.get(leg.lineId);
    const etaMinutes = etaMinutesFromNow(service?.estimatedArrival, now);
    if (!service || etaMinutes === undefined) {
      return {
        ...leg,
        busArrival: unavailable("No current arrival reported for this service.", {
          serviceNo: leg.lineId,
          boardingStopCode: match.boardingStopCode,
          alightingStopCode: match.alightingStopCode,
          observedAt: stopResult.value.metadata.fetchedAt,
          provider: stopResult.value.metadata,
        }),
      };
    }
    return {
      ...leg,
      busArrival: {
        status: "available",
        serviceNo: leg.lineId,
        boardingStopCode: match.boardingStopCode,
        alightingStopCode: match.alightingStopCode,
        etaMinutes,
        load: service.load,
        wheelchairAccessible: service.wheelchairAccessible,
        observedAt: stopResult.value.metadata.fetchedAt,
        staleAt: stopResult.value.metadata.staleAt,
        provider: stopResult.value.metadata,
      },
    };
  };

  return {
    providers,
    journeys: journeys.map((journey) => ({ ...journey, legs: journey.legs.map(resolveLeg) })),
  };
}
