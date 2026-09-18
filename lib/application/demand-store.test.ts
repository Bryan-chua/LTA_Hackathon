import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DemandStore, DEMAND_TTL_MS } from "./demand-store";

const selection = { scenarioId: "ewl-disruption", profile: "typical", journeyId: "recommended-dtl-route" } as const;

describe("demand participation", () => {
  it("requires opt-in and replaces retries or changed routes", () => {
    const store = new DemandStore();
    assert.throws(() => store.accept("unconsented", selection));
    const id = store.consent();
    assert.equal(store.consent(id), id);
    store.accept(id, selection);
    store.accept(id, selection);
    assert.deepEqual(store.selections("ewl-disruption", "typical"), [selection.journeyId]);
    store.accept(id, { ...selection, journeyId: "relief-tel-route" });
    assert.deepEqual(store.selections("ewl-disruption", "typical"), ["relief-tel-route"]);
    assert.deepEqual(store.selections("normal", "typical"), []);
    assert.deepEqual(store.selections("ewl-disruption", "surge"), []);
  });

  it("withdraws only the caller and enforces a fixed TTL", () => {
    let now = 100;
    const store = new DemandStore(() => now);
    const first = store.consent();
    const second = store.consent();
    store.accept(first, selection);
    store.accept(second, selection);
    store.withdraw(first);
    assert.equal(store.selections("ewl-disruption", "typical").length, 1);
    now += DEMAND_TTL_MS;
    assert.equal(store.has(second), false);
    assert.deepEqual(store.selections("ewl-disruption", "typical"), []);
    assert.throws(() => store.accept(second, selection));
  });

  it("bounds memory and admits new participants after expiry", () => {
    let now = 0;
    const store = new DemandStore(() => now, 1);
    store.consent();
    assert.throws(() => store.consent());
    now += DEMAND_TTL_MS;
    assert.ok(store.consent());
  });
});
