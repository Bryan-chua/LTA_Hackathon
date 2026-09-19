# Demo and Release Checklist

## Five-minute judge path

1. Open the deployed app on a phone and point out the live/replay and freshness labels.
2. Choose **Normal replay**: Rachel's usual route is safe and the companion stays quiet.
3. Choose **Unplanned disruption**: show the affected EWL segment, one-line action, deadline range, DTL alternative, and inspectable score.
4. Choose **Planned work**: show the explicitly labelled previous-day fixture and the same deterministic decision path.
5. Tap **Use this route**, enable airplane mode, and reopen the installed app. Show the saved instructions, timestamp, and OSM-attributed schematic.
6. Restore connectivity and show live refresh without silently replacing the accepted route.
7. Send a real test notification, open it, and show the owning decision. Explain that routine labels stay on device.

If a provider is unavailable, keep the replay fallback visibly labelled and state the outage. Do not describe replay output as live.

## Release checklist

- [ ] Vercel production environment uses `DATA_MODE=live` and `LIVE_PROVIDERS_ENABLED=true`.
- [ ] Supabase transaction-pooler `DATABASE_URL` and migration connection are configured.
- [ ] Migrations and Supabase Cron configuration complete without printing secrets.
- [ ] VAPID and Cron secrets are present; test push succeeds on Android and installed iOS.
- [ ] Unit, contract, lint, build, browser, axe, and manual device gates pass.
- [ ] Lighthouse evidence is captured from the deployed production URL.
- [ ] Provider attribution and current usage terms are reviewed.
- [ ] Logs and database rows are checked for prohibited personal/secrets fields.
- [ ] Replay fixtures and synthetic demand remain visibly labelled.
- [ ] Known limitations below are included in the submission.

## Known limitations

- One Singapore persona and timezone.
- Best-effort Web Push; the foreground check remains the fallback.
- No user accounts or cross-device routine synchronization.
- Planned work is a labelled fixture for reproducible judging.
- Arrival uncertainty is rule-based, not calibrated against historical outcomes.
- Demand-aware routing is a synthetic demo, not live passenger measurement.
