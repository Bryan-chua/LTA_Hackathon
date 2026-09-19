# Architecture and Data Flow

## Runtime boundary

Smart Commute is a Next.js PWA. The browser owns Rachel's editable routine and cached journey snapshots in IndexedDB. Server route handlers own provider credentials, live data normalization, deterministic scoring, PostgreSQL notification state, and Web Push delivery.

```text
Browser/PWA
  routine + journey cache (IndexedDB)
        |
        | validated routine, explicit consent
        v
Next.js route handlers on Vercel
  | OneMap routing/geocoding
  | LTA DataMall alerts/crowding
  | data.gov.sg weather
  | deterministic affected-leg matching + scoring
        |
        v
Supabase Postgres
  pseudonymous installation + minimized evaluation profile + decisions
        ^
        |
Supabase Cron -> authenticated POST /api/cron/morning-checks
        |
        v
Web Push service -> installed browser notification
```

## Foreground journey

1. The app opens a cached normalized snapshot, if present.
2. When online it sends the device routine to `POST /api/morning-check`.
3. The server requests provider data concurrently and normalizes provenance, validity, unknown values, and warnings.
4. The engine intersects events with leg time windows and station/line geometry, scores feasible routes, and returns one deterministic recommendation plus alternatives.
5. A valid response replaces the displayed cache and is retained for seven days. A failed live request never silently becomes fixture data.

## Notification journey

1. Explicit opt-in creates a browser subscription and copies only coordinates, schedule, timezone, deadline, threshold, enabled state, and a version hash to PostgreSQL.
2. Supabase Cron invokes the authenticated morning-check endpoint every five minutes.
3. The scheduler transactionally leases due profiles, plans live alternatives, applies the interruption policy, fingerprints the decision, and stores the result.
4. Only actionable or recovery decisions produce Web Push. HTTP 404/410 subscriptions are deleted.

## Offline behavior

- IndexedDB schema version 2 stores a maximum of ten normalized snapshots for seven days.
- The active route is never silently replaced after the commuter accepts it.
- The service worker caches the application shell and same-origin static assets only. APIs and third-party maps stay network-only.
- The offline map is a schematic with OpenStreetMap attribution.
- “Available offline” appears only after a confirmed IndexedDB write.

## AI/ML claim boundary

There is no trained ML model or LLM in the recommendation path. Matching, uncertainty ranges, interruption policy, and route ranking are deterministic and inspectable. The optional demand replay is synthetic scenario arithmetic, not measured passenger prediction.
