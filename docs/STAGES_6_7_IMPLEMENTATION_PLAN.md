# Stages 6–7 Implementation Plan

## Outcome

Finish the Smart Commute prototype as a resilient, judge-ready PWA: use live data first, retain a clearly labelled replay fallback, keep a useful journey available through connectivity gaps, deploy notification scheduling with Supabase Cron, and package evidence for the final demo.

## Stage 6 — Offline resilience

### Device persistence

- Upgrade the `smart-commute` IndexedDB database to schema version 2.
- Keep the routine authoritative on-device and add complete normalized journey snapshots, the selected journey ID, cache timestamps, provider provenance, and pending server-deletion state.
- Retain snapshots for seven days, cap them at ten records, and prune on startup and after writes.
- Migrate the legacy `smart-commute-active-journey` localStorage value once and then remove it.
- Never persist raw provider responses, credentials, push private keys, address search history, or notification decision history.

### Live-first startup and reconnection

- Hydrate from IndexedDB after the client mounts and show a saved snapshot immediately when one exists.
- When online, run a live morning check and replace the cached plan only after a valid response.
- Never silently replace a failed live request with replay data.
- Show explicit Live, Forecast, Replay, Cached, Offline, Stale, and Unable to refresh states using provider validity timestamps.
- Debounce reconnect refreshes. If live advice changes while a journey is active, show the change without silently replacing the route the commuter accepted.

### Offline shell and privacy controls

- Cache only the versioned application shell and same-origin static assets; keep APIs and third-party tiles network-only.
- Retain the existing schematic map with OpenStreetMap attribution when the live map is unavailable.
- Say “Available offline” only after IndexedDB confirms a successful snapshot write.
- Add Clear my data. Online clearing removes device data and push state; offline clearing removes device data immediately and stores only a deletion tombstone for the next connection.

### Planned-event judging path

- Add a labelled `ewl-planned-work` replay scenario using a previous-day planned-work observation and an unaffected DTL alternative.
- Expose explicit Live check, Normal replay, Unplanned disruption, and Planned work controls.

## Stage 7 — Deployment and submission hardening

### Supabase and server security

- Keep Supabase server-only through Postgres.js; do not ship Supabase keys or database URLs to the browser.
- Use the Supabase transaction pooler for `DATABASE_URL`, with a module-scoped pool of one, prepared statements disabled, and SSL required.
- Use `MIGRATION_DATABASE_URL` for migrations and maintain a migration ledger.
- Enable RLS on public notification tables and revoke `anon` and `authenticated` privileges. The application server remains the sole data path.
- Add a rate-limited, installation-owned test-push endpoint for real-device verification.

### Supabase Cron

- Replace Vercel’s five-minute cron configuration with Supabase `pg_cron`, `pg_net`, and Vault.
- Schedule `POST /api/cron/morning-checks` every five minutes with the bearer secret stored in Vault.
- Provide an idempotent setup script that never prints secrets.

### Verification

- Keep unit and contract tests and add local Playwright journeys plus axe accessibility checks. No hosted CI is added.
- Cover normal, disruption, planned work, rain, forecast/realtime crowding, partial provider failures, offline/stale/reconnect behavior, clearing data, duplicate cron delivery, cooldown/recovery, expired endpoints, opt-out, and test-push rate limiting.
- Check 320, 360, and 390 pixel layouts, keyboard flow, 44px targets, zoom, and serious/critical axe findings.
- Target Lighthouse performance 80+, accessibility 95+, best practices 90+, a warm offline view within one second, and a bounded 25-second degraded live response.
- Manually verify Android Chrome and an installed iOS Home Screen app, including notification permission, delivery, click-through, offline opening, denial, and unsubscribe.

### Submission package

- Document architecture/data flow, sources and licences, privacy/retention, evaluation evidence, the live/replay demo script, deployment, and known limitations.
- Keep claims precise: route ranking and explanations are deterministic rules, not trained ML or calibrated prediction.

## Public interface changes

- Add `CachedJourneySnapshot`, `DataFreshness`, and `PersistenceState` types.
- Add scenario ID `ewl-planned-work`.
- Change the cron endpoint to `POST` (with a compatibility `GET` only if needed during rollout).
- Add `POST /api/push/test`.
- Add `MIGRATION_DATABASE_URL`, `APP_BASE_URL`, and `PUSH_TEST_ENABLED`; production defaults to `DATA_MODE=live`.

## Completion criteria

- A saved route genuinely opens offline and is labelled with accurate provenance/freshness.
- Live refresh, replay selection, reconnection, and clearing data behave deterministically.
- Database migrations are repeatable and notification tables are inaccessible to Supabase browser roles.
- Supabase Cron configuration is reproducible without committing or logging secrets.
- Unit, contract, lint, build, browser, and accessibility checks pass locally.
- The repository contains the complete judge/demo package and honest manual-device sign-off checklist.

## Assumptions

- Rachel remains the single persona and `Asia/Singapore` the only timezone.
- There are no accounts; installation cookies provide pseudonymous ownership.
- Planned work remains a labelled fixture because a reproducible live event cannot be guaranteed during judging.
- Offline snapshots live for seven days with a maximum of ten.
- Supabase and Vercel deployment plus real-device sign-off require project credentials, public HTTPS deployment, VAPID keys, and physical devices.
