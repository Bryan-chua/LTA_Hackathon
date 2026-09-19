import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CachedJourneySnapshot } from "./journey-store";
import { snapshotFreshness } from "./journey-store";
import type { JourneyPlanView } from "../application/journey-view-model";

const plan = { providers: [] } as unknown as JourneyPlanView;
const snapshot = (expiresAt: string, staleAt?: string): CachedJourneySnapshot => ({
  id: "test",
  plan: { ...plan, providers: [{ name: "OneMap", status: "available", mode: "cached", fetchedAt: "2026-09-18T00:00:00Z", staleAt, warnings: [] }] },
  cachedAt: "2026-09-18T00:00:00Z",
  expiresAt,
});

describe("offline snapshot freshness", () => {
  it("distinguishes fresh, provider-stale, and expired snapshots", () => {
    const now = new Date("2026-09-19T00:00:00Z");
    assert.equal(snapshotFreshness(snapshot("2026-09-25T00:00:00Z", "2026-09-20T00:00:00Z"), now), "fresh");
    assert.equal(snapshotFreshness(snapshot("2026-09-25T00:00:00Z", "2026-09-18T01:00:00Z"), now), "stale");
    assert.equal(snapshotFreshness(snapshot("2026-09-18T01:00:00Z"), now), "expired");
  });
});
