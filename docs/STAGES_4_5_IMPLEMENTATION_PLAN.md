# Stages 4–5 implementation

Status: implemented in the application; live verification and push delivery require deployment configuration, database migration, and real-device testing.

## What was added

Stage 4 adds explicit live planning through authenticated OneMap public-transport routing, LTA DataMall train alerts and station crowding, and the data.gov.sg two-hour weather forecast. Provider responses are runtime-validated, normalized into the existing journey model, and returned with source, mode, freshness, and warnings. Replay mode remains separate and deterministic; a live failure is never silently replaced with fixture data.

Stage 5 adds an IndexedDB-owned editable routine, OneMap address search, a manual live morning check, a deterministic interruption policy, fingerprint/cooldown records, opt-in Web Push, and a Vercel cron worker. Enabling alerts copies only coordinates, weekdays, departure time, deadline, timezone, threshold, and enabled state to PostgreSQL. Names, address labels, travel history, contacts, GPS observations, and SimplyGo data are not synchronized.

## Runtime flow

1. The commuter edits and saves a routine on-device.
2. A manual check posts that routine to the server for one live evaluation.
3. Push opt-in creates a Web Push subscription and a minimized evaluation profile.
4. Vercel calls the authenticated cron route every five minutes.
5. The worker transactionally claims due profiles, then releases database locks before provider calls.
6. It checks at 30 and 15 minutes before departure, then performs one final five-minute verification to catch a changed or invalid recommendation; only actionable or recovery notifications are sent.
7. Fingerprints, a 60-minute cooldown, and a unique database constraint suppress duplicate delivery while allowing materially changed advice.
8. Opt-out deletes the installation, evaluation profile, and decision history through cascading foreign keys.

## Configuration

Populate server-side environment variables:

```text
DATA_MODE=replay
LIVE_PROVIDERS_ENABLED=true
LTA_DATAMALL_ACCOUNT_KEY=
ONEMAP_ACCESS_TOKEN=
DATABASE_URL=
CRON_SECRET=
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:team@example.com
PUSH_ENABLED=true
```

Generate VAPID keys with `npx web-push generate-vapid-keys`. Never use `NEXT_PUBLIC_` for private credentials.

Apply the schema before enabling push:

```bash
npm run db:migrate
```

The database connection should use the provider's pooled connection URL for Vercel.

## Deployment and verification

- Deploy to HTTPS; Push and Notifications require a secure context.
- Configure Vercel Cron with `CRON_SECRET`. The committed schedule is every five minutes in UTC; due times are calculated for Asia/Singapore.
- On iOS/iPadOS, add the PWA to the Home Screen before enabling notifications.
- First verify live manual checks with `PUSH_ENABLED=false`.
- Then migrate PostgreSQL, configure VAPID, set `PUSH_ENABLED=true`, and test an internal subscription.
- Verify Chrome/Edge desktop, Android Chrome, and an installed iOS Home Screen app.
- Confirm opt-out removes the database rows and 404/410 push responses remove expired subscriptions.

## Known boundaries

- OneMap determines feasible candidates; the app ranks the returned itineraries but cannot force OneMap to exclude a particular rail line.
- Weather is an area-level forecast and must not be described as street-level rainfall.
- Arrival intervals and disruption impact remain explainable heuristics, not calibrated probabilities.
- The scheduler is best-effort; the manual morning check remains available.
- Active-journey and condition persistence remain Stage 6 work.
- Planned roadworks, accounts, ML prediction, and additional personas remain out of scope.
