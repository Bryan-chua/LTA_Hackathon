import assert from "node:assert/strict";
import { describe, it } from "node:test";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { normalizeTrainTripUpdates } from "./gtfs-train";

describe("GTFS realtime train trip updates", () => {
  it("turns a material delay into a route condition", () => {
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.create({
      header: { gtfsRealtimeVersion: "2.0", timestamp: 1_779_405_600 },
      entity: [{
        id: "ew-delay",
        tripUpdate: {
          trip: { tripId: "EWL_EB_WD_42", routeId: "EWL_CGL" },
          timestamp: 1_779_405_600,
          stopTimeUpdate: [{ stopId: "EW13_A", arrival: { delay: 420 } }],
        },
      }],
    });
    const conditions = normalizeTrainTripUpdates(feed, new Date("2026-05-22T00:00:00Z"));
    assert.equal(conditions.length, 1);
    assert.equal(conditions[0]?.kind, "train_disruption");
    assert.deepEqual(conditions[0]?.lineIds, ["EWL"]);
    assert.equal(conditions[0]?.expectedDelayMinutes, 7);
  });

  it("keeps an empty or sub-two-minute feed quiet", () => {
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.create({
      header: { gtfsRealtimeVersion: "2.0" },
      entity: [{ id: "small-delay", tripUpdate: {
        trip: { tripId: "DTL_WD_1", routeId: "DTL" },
        stopTimeUpdate: [{ stopId: "DT10_A", arrival: { delay: 60 } }],
      } }],
    });
    assert.deepEqual(normalizeTrainTripUpdates(feed, new Date("2026-09-19T00:00:00Z")), []);
  });

  it("marks cancelled trips as major even without a delay value", () => {
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.create({
      header: { gtfsRealtimeVersion: "2.0" },
      entity: [{ id: "cancelled", tripUpdate: {
        trip: {
          tripId: "NEL_NB_WD_1",
          routeId: "NEL",
          scheduleRelationship: GtfsRealtimeBindings.transit_realtime.TripDescriptor.ScheduleRelationship.CANCELED,
        },
      } }],
    });
    const [condition] = normalizeTrainTripUpdates(feed, new Date("2026-09-19T00:00:00Z"));
    assert.equal(condition?.severity, "major");
    assert.match(condition?.title ?? "", /cancelled/i);
  });
});
