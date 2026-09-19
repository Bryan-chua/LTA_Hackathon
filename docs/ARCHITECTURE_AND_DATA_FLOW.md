# Architecture and Data Flow

## Runtime boundary

Smart Commute is a Next.js PWA. The browser owns Rachel's editable routine and cached journey snapshots in IndexedDB. Server route handlers own provider credentials, live data normalization, deterministic scoring, PostgreSQL notification state, and Web Push delivery.

```text
Browser/PWA
  routine + journey cache (IndexedDB)
        |
        | validated routine, explicit consent
        v
Next.js route handlers on Google Cloud Run
  | Google Maps Routes transit routing
  | OneMap Singapore geocoding
  | LTA DataMall alerts/crowding/bus arrivals
  | LTA GTFS train trip updates
  | LTA traffic incidents/floods/lift maintenance
  | data.gov.sg forecast + rainfall observations
  | deterministic affected-leg matching + scoring
        |
        v
Supabase Postgres
  pseudonymous installation + minimized evaluation profile + decisions
        ^
        |
Google Cloud Scheduler (OIDC) -> authenticated POST /api/cron/morning-checks
        |
        v
Web Push service -> installed browser notification
```

## Foreground journey

1. The app opens a cached normalized snapshot, if present.
2. When online it sends the device routine to `POST /api/morning-check`.
3. The server requests provider data concurrently and normalizes provenance, validity, unknown values, and warnings.
4. The engine intersects line/station and spatial events with each leg's travel mode, geometry and traversal window. Only conditions affecting a candidate journey are retained; they adjust uncertainty and route scoring before one deterministic recommendation and its alternatives are returned.
5. A valid response replaces the displayed cache and is retained for seven days. A failed live request never silently becomes fixture data.

## Notification journey

1. Explicit opt-in creates a browser subscription and copies only coordinates, schedule, timezone, deadline, threshold, enabled state, and a version hash to PostgreSQL.
2. Google Cloud Scheduler invokes the morning-check endpoint every five minutes with a Google-signed OIDC token.
3. The scheduler transactionally leases due profiles, plans live alternatives, applies the interruption policy, fingerprints the decision, and stores the result.
4. Only actionable or recovery decisions produce Web Push. HTTP 404/410 subscriptions are deleted.

## Offline behavior

- IndexedDB schema version 2 stores a maximum of ten normalized snapshots for seven days.
- The active route is never silently replaced after the commuter accepts it.
- The service worker caches the application shell and same-origin static assets only. APIs and third-party maps stay network-only.
- The offline map is a schematic with OpenStreetMap attribution.
- “Available offline” appears only after a confirmed IndexedDB write.

## AI/ML claim boundary

There is no calibrated real-world ML model or LLM in the live recommendation path. Replay routes use an explicitly labelled synthetic gradient-boosted decision-stump ensemble to exercise the forecast contract; live routes fall back to deterministic, inspectable uncertainty and scoring. The optional demand replay remains synthetic scenario arithmetic, not measured passenger prediction.

## Planned reliability-forecast extension

The forecast layer is specified in [PERSONALISED_JOURNEY_RELIABILITY_FORECAST.md](PERSONALISED_JOURNEY_RELIABILITY_FORECAST.md). It adds a guarded forecast after normalization and before final scoring. Replay output supplies a synthetic on-time probability and P50/P90; live, stale, unsupported, low-confidence or out-of-distribution requests continue through deterministic `deadlineRisk`.

Opted-in point-in-time observations and confirmed outcomes are stored for 90 days behind server-only PostgreSQL access. Calibrated model training remains deferred work and is not a current-deployment claim.
