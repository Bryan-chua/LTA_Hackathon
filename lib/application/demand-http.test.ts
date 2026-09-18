import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleDemandRequest } from "./demand-http";

const url = "http://localhost:3000/api/demand/participation";
const post = (body: unknown, cookie = "", origin = "http://localhost:3000") => new Request(url, {
  method: "POST", headers: { "content-type": "application/json", origin, cookie }, body: JSON.stringify(body),
});

describe("demand HTTP boundary", () => {
  it("is disabled in production unless the demo is explicitly enabled", async () => {
    const previousMode = process.env.NODE_ENV;
    const previousFlag = process.env.DEMAND_DEMO_ENABLED;
    try {
      Object.assign(process.env, { NODE_ENV: "production" });
      delete process.env.DEMAND_DEMO_ENABLED;
      assert.equal((await handleDemandRequest(new Request(url))).status, 404);
      process.env.DEMAND_DEMO_ENABLED = "true";
      assert.equal((await handleDemandRequest(new Request(url))).status, 200);
    } finally {
      if (previousMode === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
      else Object.assign(process.env, { NODE_ENV: previousMode });
      if (previousFlag === undefined) delete process.env.DEMAND_DEMO_ENABLED; else process.env.DEMAND_DEMO_ENABLED = previousFlag;
    }
  });

  it("accepts the browser host when Next normalises the internal request URL", async () => {
    const request = new Request(url, { method: "POST", headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" }, body: JSON.stringify({ action: "consent", consent: true }) });
    const response = await handleDemandRequest(request);
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    await handleDemandRequest(new Request(url, { method: "DELETE", headers: { origin: "http://localhost:3000", cookie } }));
  });

  it("rejects malformed input, forged cross-site requests and acceptance without consent", async () => {
    for (const body of [null, [], {}, { action: "consent", consent: false }]) {
      assert.equal((await handleDemandRequest(post(body))).status, 400);
    }
    assert.equal((await handleDemandRequest(post({ action: "consent", consent: true }, "", "https://evil.example"))).status, 403);
    assert.equal((await handleDemandRequest(post({ action: "accept", scenarioId: "ewl-disruption", profile: "typical", journeyId: "recommended-dtl-route" }))).status, 403);
  });

  it("issues a private HttpOnly session, validates choices and supports withdrawal", async () => {
    const consent = await handleDemandRequest(post({ action: "consent", consent: true }));
    const cookie = consent.headers.get("set-cookie")!;
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(consent.headers.get("cache-control")!, /no-store/);
    const token = cookie.split(";")[0];
    const accept = { action: "accept", scenarioId: "ewl-disruption", profile: "typical", journeyId: "recommended-dtl-route" };
    assert.equal((await handleDemandRequest(post({ ...accept, journeyId: "arbitrary-location" }, token))).status, 400);
    assert.equal((await handleDemandRequest(post({ ...accept, latitude: 1.23 }, token))).status, 400);
    assert.equal((await handleDemandRequest(post(accept, token))).status, 200);
    const withdrawn = await handleDemandRequest(new Request(url, { method: "DELETE", headers: { origin: "http://localhost:3000", cookie: token } }));
    assert.equal(withdrawn.status, 200);
    assert.match(withdrawn.headers.get("set-cookie")!, /Max-Age=0/);
    assert.equal((await handleDemandRequest(post(accept, token))).status, 403);
  });
});
