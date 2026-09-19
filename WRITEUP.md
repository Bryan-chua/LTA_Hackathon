# Smart Commute — Deadline Shield, Collective Rerouting, and Evidence-First Accessible Travel

Proactive, single-recommendation disruption guidance for a fixed-schedule commuter, built on OneMap routing and a MapLibre/OpenStreetMap base, with a small opt-in demo of demand-aware rerouting. The next scoped upgrade adds rain-aware sheltered-walking evidence and conservative lift-maintenance handling without claiming that an unverified route is accessible.

## 1. Problem and target persona

PS2 asks for proactive decision support during transit disruptions: reach commuters *before* problems compound, recommend one specific action, and treat planned and unplanned disruptions as equally first-class.

We scoped the MVP to one of the brief's three personas, **Rachel**: a fixed-schedule EWL commuter travelling Tampines → Raffles Place, departing 07:40, with an 08:45 arrival deadline. Rachel doesn't want a dashboard — she wants the app to stay silent when her commute is safe, and to say one clear thing when it isn't: what to do, and what it costs her.

Rachel remains the product's default persona; this is not becoming a full multi-persona app. The existing **Accessible travel** mode is a conservative, Mdm Lim-inspired option alongside **Standard commute**. Today it only reweights transfers and walking, and it never claims a route, stop, or bus is accessible. The planned upgrade in this write-up adds bounded evidence about reported lift maintenance and sheltered walking; it will still not equate an absence of an outage record with step-free access.

## 2. User journey / what the demo shows

The app runs in a **replay mode** by default (no live credentials required) with three labelled, deterministic scenarios selectable from the UI:

- **Normal day** — Rachel's usual route is on time; the app stays quiet.
- **Unplanned disruption** — an EWL incident affects her leg; the app shows the affected segment, one recommended alternative (via DTL), the reasoning, and a deadline-risk-aware notification.
- **Planned work** — a labelled maintenance-window scenario, run through the same decision path as the unplanned case, to show planned and unplanned disruptions are handled identically rather than as a bolt-on special case.

The planned accessibility and rain-shelter upgrade will add two further deterministic replay scenarios. They will remain separate from live provider results:

- **Rainy normal morning** — a normal Rachel commute with rain forecast, where an option with lower verified outdoor walking exposure can change the recommendation or its explanation.
- **Mdm Lim lift-maintenance replay** — a fixture route whose explicitly required lift is reported under maintenance. In Accessible travel mode, that fixture is rejected only when the required lift ID matches the replay outage; the app then selects a verified fixture alternative or states that no verified accessible route is available.

For the three currently shipped scenarios, the map shows the original route, the affected portion distinguished, and the alternative for direct comparison, per the brief's visualization requirement. The app also demonstrates: offline behaviour (installed PWA shows the last-accepted route and timestamp with no network), a real push notification round-trip (VAPID-based Web Push, subscribed and fired from the device), and the opt-in demand-demo panel (see §5).

*A demo recording is not yet linked — see §12.*

## 3. Solution and differentiators

- **One decision, not a feed.** The orchestrator (`lib/application/journey-orchestrator.ts`) always resolves to exactly one recommended alternative with a plain-language reason and change explanation, rather than a ranked list.
- **Planned and unplanned disruptions share one code path.** Both scenario types run through the same affected-leg matcher (`lib/journey-engine.ts`) and scorer (`lib/journey-scoring.ts`) — there is no special-cased "maintenance mode."
- **Deadline-risk-first notification logic.** `lib/morning-check.ts` computes explicit reason codes (`deadline_risk`, `material_delay`, `major_event`, `leave_earlier`) rather than firing on any delay, so Rachel is only interrupted when her 08:45 deadline is actually threatened.
- **Evidence before reassurance.** The planned upgrade treats failed, stale, missing, or unmatched facilities and geospatial data as `unverified`. It will use a reported lift outage as a warning or a fixture eligibility check—not as a complete map of step-free access—and will only report covered/exposed walking distances after reliable geometry matching.
- **Offline-safe by construction.** The service worker (`public/sw.js`) explicitly never caches `/api/*` responses — forecasts and personal data are excluded from the offline cache by design, not by oversight.
- **A small, honestly-labelled step toward demand awareness** (§5) — most hackathon disruption tools stop at "here is an alternative"; this one also models, in a limited synthetic form, what happens if many commuters are sent to the same alternative at once.

### Personalised Journey Reliability Forecast

Every route candidate now has a deadline-focused reliability result: probability of arriving before Rachel's deadline, P50/P90 arrival (or a likely-arrival range), the strongest disruption/crowding/weather reasons, and confidence/freshness. Replay uses a small synthetic gradient-boosted decision-stump ensemble and carries a non-glaring **Synthetic model output** label.

This is not a calibrated live-accuracy claim. Live routes use the deterministic scorer because no real labelled model has passed promotion gates. Separate opt-in feedback can collect pseudonymous point-in-time features and confirmed outcomes for 90 days; opt-out deletes them. No LLM is used. The design and remaining real-data rollout are in [`docs/PERSONALISED_JOURNEY_RELIABILITY_FORECAST.md`](docs/PERSONALISED_JOURNEY_RELIABILITY_FORECAST.md).

## 4. Collective rerouting approach, privacy safeguards, assumptions, and limitations

**What "collective rerouting" means here, precisely.** When a demo user opts in and accepts an alternative route in a running scenario, that acceptance is recorded and fed into `lib/demand-flow.ts`, which arithmetically shifts a synthetic passenger count from a hardcoded EWL baseline onto the DTL/relief-bus corridor. The next scoring pass sees a nudged crowding estimate on that corridor. This is real, running code — not just a design document — and it does change what the app recommends next.

**What it is not.** It is not live passenger telemetry, not SimplyGo or DataMall boarding data, not a trained model, and not a multi-user production system. The project's own implementation doc states this directly: *"Status: implemented as a synthetic, single-server demonstration... The app measures intent to take a demo route, not actual boarding. It does not observe SimplyGo transactions, GPS, or real commuter movements. Forecast inputs, train capacity and additional delays in this version are synthetic assumptions."* (`docs/DEMAND_AWARE_ROUTING.md`).

**Privacy safeguards actually implemented:**
- An explicit opt-in checkbox in the UI (`components/demand-panel.tsx`) — nothing is collected by default.
- The accept/withdraw payload is restricted to a scenario ID, a persona profile, and a journey ID — no coordinates, no free text, no device identifiers (`lib/application/demand-http.ts`).
- Consent is tracked via a same-origin, `HttpOnly`, `SameSite=Strict` cookie.
- A "Clear my data" control exists in the UI (`components/routine-panel.tsx`) for routine/push data.

**Assumptions and limitations, stated plainly:**
- The session identifier is **pseudonymous, not anonymous** — the project's own docs are explicit about this distinction.
- The store is an in-memory `Map` in a single Node process, capped at 250 sessions with a 30-minute TTL. It does not survive multiple server instances and is explicitly documented as unsuitable for real commuter telemetry.
- Baseline ridership, corridor capacity, and spillover figures are hardcoded synthetic constants, not derived from any real LTA dataset.
- There is no anti-abuse protection (rate limiting, bot detection) on the accept/withdraw endpoint.
- **Credible path to production**: replace the in-process store with a shared, TTL-backed store (e.g. Redis) behind real rate limiting; replace synthetic baselines with an aggregated, privacy-reviewed read from LTA's own crowding/ridership endpoints where available; and treat any move from pseudonymous session IDs to genuinely anonymous aggregation as a separate, explicitly-scoped privacy design task rather than a relabelling exercise.

## 5. Technical architecture and current implementation status

Next.js app (App Router) with API routes for journey planning, morning checks, push, and the demand demo; MapLibre GL for the map; Postgres (Supabase) for push-subscription/profile storage; a service worker + IndexedDB for offline state.

```
app/api/            journeys, morning-check, push/*, demand/participation, cron/morning-checks, geocode
components/         commute-app (shell), route-map (MapLibre + offline fallback), routine-panel, demand-panel
lib/                journey-engine (affected-leg matching), journey-scoring (Rachel score),
                    morning-check (notification decisioning), demand-flow (synthetic demand shift)
lib/live/           datamall.ts, onemap.ts, weather.ts — real HTTP integrations (see §7)
lib/application/    orchestration, demand store/http contracts
lib/client/         IndexedDB-backed offline journey/routine cache
lib/server/         Postgres access, VAPID/web-push, cron worker
db/migrations/      notification_profiles + Supabase RLS security migration
```

Implementation status is intentionally granular rather than a single "done" claim:

| Area | Status |
|---|---|
| Affected-leg detection, scoring, single-recommendation logic | Implemented, unit-tested |
| Replay-mode demo scenarios (normal / unplanned / planned work) | Implemented, deterministic fixtures |
| Live OneMap routing | Implemented, requires either a real `ONEMAP_ACCESS_TOKEN` or `ONEMAP_EMAIL`/`ONEMAP_PASSWORD` (auto-refreshed token) |
| Live LTA DataMall TrainServiceAlerts + Station Crowd Density | Implemented, requires a real `LTA_DATAMALL_ACCOUNT_KEY` |
| Live 2-hour weather advisory on walking legs | Implemented (`api-open.data.gov.sg` two-hour forecast only) |
| Offline PWA shell, service worker, IndexedDB journey cache | Implemented |
| Web Push (VAPID) subscribe/send/test | Implemented, needs a real VAPID keypair + HTTPS |
| Deadline-risk morning-check + Supabase Cron worker | Implemented |
| Synthetic demand-aware rerouting demo | Implemented as a single-process, pseudonymous, explicitly-labelled demo (§4) |
| Bus arrival / `Load` occupancy (LTA DataMall `v3/BusArrival`, `BusStops`, `BusRoutes`) | Implemented for standard-mode scoring and the Compare/Journey views, requires a real `LTA_DATAMALL_ACCOUNT_KEY`; bus-stop/bus-vehicle accessibility remains unverified and is never inferred from arrival data (see §10) |
| Accessible travel-mode toggle | Implemented as a minimal interactive scoring reweighting (transfers, walking) plus explicit `Accessibility: Unverified` labelling on bus legs; it is not step-free routing and has no verified lift evidence yet |
| Facilities Maintenance / lift-outage data | **Planned accessibility upgrade** — add LTA DataMall `v2/FacilitiesMaintenance`, preserving station/lift identifiers, source, freshness, and warnings. Failed, stale, or unmatched results will be `unverified`, never `available`. |
| Covered walking / station-exit evidence | **Planned accessibility upgrade** — retrieve DataMall `GeospatialWholeIsland` layers (`CoveredLinkWay`, with `Footpath` and `TrainStationExit` only when useful) server-side through a bounded cache. Coverage remains unverified until route-geometry matching is reliable. |
| Personalised Journey Reliability Forecast contract/UI | Implemented |
| Replay synthetic probability, P50/P90, reasons and confidence/freshness | Implemented and visibly labelled synthetic |
| Calibrated live on-time probability and statistical P50/P90 | **Not implemented; no real training corpus or promoted artifact yet** |
| Low-confidence/stale/cold-start forecast fallback | Implemented through the existing deterministic scorer |
| Opt-in outcomes and 90-day pseudonymous observation schema | Implemented; deployment requires migration 003 |
| 24-hour and 4-day weather forecasts | **Not implemented** (sample API response files exist in `docs/` for reference only; never fetched live) |
| Self-hosted routing engine (GraphHopper/Valhalla) | **Not implemented** — considered in design docs, never built; OneMap is the only live routing provider |

## 6. Routing and recommendation logic

- **Live routing**: `lib/live/onemap.ts` calls OneMap's public-transport routing service directly (geocoding + `routeType=pt&mode=transit`), returning up to three real itineraries with decoded polyline geometry.
- **Replay/demo routing**: `lib/fixtures.ts` provides hand-authored, deterministic `Journey`/`JourneyLeg` fixtures for the three named scenarios. This is what judges see by default (no credentials required) and is explicitly labelled as replay in the UI, not presented as live.
- **Affected-segment detection** is a real algorithm, not a fixture: `lib/journey-engine.ts` intersects disruption validity windows against each leg's timing and canonical line/station codes to determine exactly which legs are affected.
- **Recommendation scoring**: `lib/journey-scoring.ts` applies a nine-factor weighted score tuned to Rachel (deadline safety margin, added walking time, transfer count, MRT crowding, bus wait time, bus vehicle load, etc.) and deterministically resolves ties, so the app always surfaces exactly one recommendation rather than a ranked list a commuter has to interpret. Bus vehicle load (`SEA`/`SDA`/`LSD`) is scored and displayed separately from MRT station crowding and is never folded into it.
- **Uncertainty is shown, not hidden**: arrival ranges are labelled by their source (live, forecast, replay) and the app avoids presenting them as calibrated statistical confidence, since they have not been validated against observed outcomes.
- **Forecast integration**: eligible replay probability replaces only `deadlineRisk`; all other score components remain inspectable. Live routes retain the current rule until a calibrated artifact passes the documented eligibility gates.

### Planned rain-shelter and accessibility extension

The extension preserves the deterministic, explainable scorer; it does not introduce machine learning, confidence scores, or accuracy claims. Standard commute remains deadline-risk-first. If rain is forecast and reliable coverage matching exists, exposed walking adds a further penalty on top of the existing rain/walking treatment, allowing a slightly slower but more sheltered option to win. If coverage cannot be computed, the ordinary rain penalty remains and the UI says that outdoor exposure is unverified.

Accessible travel will first apply a hard eligibility check only to replay fixtures that explicitly identify a required station exit and lift. A fixture is rejected only for a matching reported lift outage. For live journeys, the app will surface a prominent station-level lift-maintenance warning when relevant, but will label access as unverified unless a curated station-exit/lift mapping proves the required path. It will never infer accessibility merely because there is no reported outage. After that eligibility step, Accessible travel weights walking, transfers, verified exposed walking, and known shelter coverage more strongly.

Both modes will keep an accepted active journey stable: condition refreshes affect future recommendations, never silently replace instructions the commuter has already accepted.

The planned UI work keeps the two-mode control keyboard-accessible and phone-friendly, and persists its choice with the local routine rather than treating it as a temporary screen state. Today, Compare, and Journey will show the rain condition with provider and timestamp, lift-maintenance warnings, and covered/exposed walking only when verified. If evidence is insufficient, the explanation remains factual—such as `Accessibility information could not be verified for this route.`—and Accessible travel can reach a clear `No verified accessible route is available right now.` state.

## 7. Data sources: actual vs. planned

| Source | Actual status |
|---|---|
| LTA DataMall `TrainServiceAlerts` | **Live**, real HTTP call with account-key auth (`lib/live/datamall.ts`) |
| LTA DataMall Station Crowd Density (`PCDRealTime`/`PCDForecast`) | **Live**, same client, Zod-validated |
| OneMap geocoding + public-transport routing | **Live**, real HTTP calls (`lib/live/onemap.ts`) |
| data.gov.sg 2-hour weather forecast | **Live**, applied to walking legs |
| data.gov.sg 24-hour / 4-day weather forecast | **Planned, not implemented** — sample response files kept for reference only |
| LTA DataMall bus arrival / `Load` occupancy (`v3/BusArrival`, `BusStops`, `BusRoutes`) | **Live**, real HTTP calls scoped to stops used by current candidate journeys, Zod-validated (`lib/live/bus-arrival.ts`, `lib/live/bus-reference.ts`) |
| LTA DataMall `v2/FacilitiesMaintenance` | **Planned, not implemented** — will supply reported MRT lift-maintenance evidence (line, station code/name, lift ID/description when supplied, provenance and freshness). It does not prove a station or route is step-free. |
| LTA DataMall `GeospatialWholeIsland`: `CoveredLinkWay`, `Footpath`, `TrainStationExit` | **Planned, not implemented** — server-side, bounded-cache retrieval for shelter/exit geometry. Only reliable route matching can yield verified covered/exposed walking distance; otherwise coverage is unverified. |
| OpenStreetMap (via MapLibre + OSM-derived vector tiles) | **Live**, used as the map base layer; OSM is not used for route computation itself |

All disruption scenarios shown in the default demo are **replay/fixture data**, clearly selectable and labelled as such in the UI (Normal / Unplanned disruption / Planned work), because live disruptions are infrequent and cannot be relied on to occur during judging. The two planned rain/accessibility scenarios follow the same rule. A live provider failure must report that failure or unverified evidence; it must never silently substitute a replay fixture.

## 8. Alignment to PS2 mandatory requirements

- **3.2.1 Route planning** — multi-modal (rail/bus/walk) door-to-door journeys, live-responsive when live providers are configured, with visible uncertainty ranges rather than a single confident ETA. *Met.*
- **3.2.2 Geospatial base** — OpenStreetMap-derived vector tiles via MapLibre are the map base. Attribution is rendered via MapLibre's `AttributionControl` on the live map and is hardcoded in the offline schematic fallback (`"Route schematic · © OpenStreetMap contributors"`, `components/route-map.tsx`). We have not independently re-verified the live tile attribution renders on every viewport at demo time — worth a final visual check before judging, since this is an explicit scoring cap trigger if missing.
- **3.2.3 Visualization** — original route, affected portion, and alternative are shown together on the map; the app targets one-handed phone use. We have not yet run a real-phone, bright-sunlight legibility pass — see §11.
- **No personal data without permission** — the demand demo is opt-in and cookie-scoped; push profiles store only coordinates/times/thresholds needed for the feature, no names or addresses.
- **No committed credentials** — `.env.example` lists variable names only; `.gitignore` excludes all `.env*` except `.env.example`.
- **Mocked data must be clearly labelled** — all three demo scenarios are explicitly named as replay/fixture in the UI copy; the demand feature is labelled synthetic in its own panel and docs.
- **Accessibility claims** — currently, bus accessibility is explicitly unverified and Accessible travel is only a scoring preference. The planned extension makes this more conservative, not less: lift-maintenance and shelter evidence will carry source/freshness labels, unavailable data will remain unverified, and no route will be called step-free without a curated proof of its required access path.
- **Beyond the brief (3.3)** — the synthetic demand-aware rerouting demo is offered as a modest, explicitly-scoped step toward "beyond 3.2" innovation. We are not claiming it as a calibrated or production-grade prediction system, per the honesty requirements above.

## 9. Evaluation approach and success metrics

We have **not** run and do not report any accuracy figures, user counts, or device-testing matrices — none exist yet, and inventing them would violate both the brief's verifiability requirement and our own honesty bar.

What does exist:
- An automated test suite (unit tests under `lib/**/*.test.ts`, a separate contract suite for the live-provider clients under `lib/live/*.test.ts` that mocks `fetch` rather than hitting real APIs, and Playwright end-to-end tests including an automated accessibility check via `@axe-core/playwright`). These can be run by a judge with `npm run test:unit`, `npm run test:contracts`, and `npm run test:e2e`.
- No CI is configured (by design, documented in `docs/EVALUATION_AND_TESTING.md`), so there is no automated, judge-independent record of a passing run — only what a judge reproduces themselves from a clean clone.
- Before judging, we intend to actually run the full suite ourselves and report the real, reproducible result here rather than an unverified narrative claim.

The planned upgrade adds testable, deterministic acceptance criteria: existing saved routines default to Standard commute; verified shelter data increases the rain penalty for exposed walking and can favour a better-sheltered route; unavailable shelter data leaves Standard mode functional without a false coverage claim; and a replay route with a matching required-lift outage is rejected in Accessible travel. Provider-contract and Playwright coverage will also check visible source/freshness/replay labels, the no-verified-accessible-route state, mobile/keyboard accessibility, and that live failures never fall back to fixtures. Existing bus arrival/load behaviour remains covered and is not evidence of accessibility.
The synthetic replay ensemble is tested for contract, ordering, reasons and fallback behavior, not reported as accuracy. A future real model will use chronological held-out days; required evidence includes calibration/Brier score, P50/P90 pinball loss and coverage, deadline misses/unnecessary reroutes, and disruption/rain/mode/route slices. No live reliability claim will be added without sample count, evaluation period and deterministic baseline.

## 10. Known limitations and next steps before final judging

- Built and tuned for one persona (Rachel) and one city/timezone; Accessible travel is conservative support, not validation that the product meets every Mdm Lim use case.
- Bus arrival/`Load` is a reliability signal only. It does not establish bus-stop, vehicle, or route accessibility, and the product must keep showing `Accessibility: Unverified` for bus legs unless a separate verified source is added.
- The planned Facilities Maintenance integration reports individual maintained lifts. Even a matching lift outage does not prove that an entire station or route is inaccessible; conversely, no outage record does not prove a step-free path exists.
- Covered-link matching can be incomplete: a source layer may fail to load, be stale, omit a link, or not align reliably with a route geometry. In those cases the app must show coverage as unverified, retain the ordinary rain penalty, and avoid saying `fully sheltered`.
- Only the 2-hour weather forecast is live; it is area-level rather than street-level. The 24-hour/4-day files are unused reference samples, not integrations.
- The interactive mode toggle is not stored in the current server-side push profile. Therefore scheduled push checks currently use Standard commute. The planned work must either add a migration, validation, and safe Standard default to persist the preference, or retain this explicit local-only limitation.
- ETA/arrival ranges are rule-based and have not been calibrated against observed outcomes.
- Replay reliability probabilities are synthetic demonstration output, not calibrated live performance; no real actual-arrival training corpus exists yet.
- The demand-aware rerouting demo is a single-process, pseudonymous, synthetic-data demonstration — not a production telemetry or prediction system.
- Web Push delivery is best-effort and platform-dependent; the in-app manual check remains the reliable fallback. There is no user account or cross-device routine sync.
- No CI and no independently verified test-run record yet; OSM attribution rendering also still needs a final live-map visual check.

**Next steps before final judging**: implement the bounded, server-side Facilities Maintenance and GeospatialWholeIsland adapters; inspect real layer payloads and attributes before committing to field mappings; add the two labelled replay cases and their tests; decide whether travel mode belongs in the scheduled-profile schema; and run `npm run lint`, `npm run test:unit`, `npm run test:contracts`, `npm run build`, and `npm run test:e2e`, recording their real output. Finish with a real-phone, bright-sunlight and one-handed-use pass, verify OSM attribution on the live tile style, record the required demo video, and re-check OneMap/DataMall terms and quotas under live credentials.

## 11. How to run the project locally

Minimal path — replay/demo mode, no credentials required:

```bash
npm ci
npm run dev
# open http://localhost:3000
```

This is enough to see all three demo scenarios, the map, the scoring/recommendation logic, and the opt-in demand demo panel.

To exercise the full feature set:

```bash
# 1. Copy env template and fill in real values (never commit the filled file)
cp .env.example .env.local

# 2. Apply database migrations (needed for push notifications / routine profiles)
npm run db:migrate

# 3. Build and start in production mode (the service worker only registers in production)
npm run build
npm run start
```

Environment variables required (see `.env.example` for the full list; no values are committed): `LTA_DATAMALL_ACCOUNT_KEY`, `ONEMAP_ACCESS_TOKEN` (or `ONEMAP_EMAIL` / `ONEMAP_PASSWORD` for auto-refreshed auth), `LIVE_PROVIDERS_ENABLED`, `DATABASE_URL` / `MIGRATION_DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`, `PUSH_ENABLED`, `DEMAND_DEMO_ENABLED`, reliability feature flags, and `NEXT_PUBLIC_MAP_STYLE_URL`. Web Push requires HTTPS (a secure context), so live push testing needs a deployed HTTPS URL rather than plain `localhost`.

Test/quality gates: `npm run lint`, `npm run test:unit`, `npm run test:contracts`, `npm run test:e2e` (run `npx playwright install` once first), `npm run build`.

## 12. Demo video

*No demo video has been recorded yet.* Link to be added here before submission: **`[DEMO VIDEO URL — TBD]`**. Per the submission spec, this must be a single, real, end-to-end commuter journey through one disruption scenario, five minutes maximum, shown on an actual phone or phone-sized browser window, and linked here rather than committed to the repository.

## 13. Sources / acknowledgements

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, rendered via MapLibre GL and OSM-derived vector tiles.
- Routing and geocoding via [OneMap](https://www.onemap.gov.sg/) (Singapore Land Authority).
- Transit disruption and crowding data via [LTA DataMall](https://datamall.lta.gov.sg/).
- Weather advisories via [data.gov.sg](https://data.gov.sg/) real-time API.
- PS2 problem statement and submission requirements: [NebulaX Hackathon Problem Statement, PS2](https://github.com/aochinwen/NebulaX-Hackathon-ProblemStatement/tree/main/PS2).
