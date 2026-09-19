# Evaluation and Testing

## Automated local gates

```bash
npm run lint
npm run test:unit
npm run test:contracts
npm run build
npm run test:e2e
```

`npm run test:release` runs lint, unit tests, the production build, and browser tests. Browser tests run at 320, 360, and 390 pixels and include a serious/critical axe gate. No hosted CI is configured by design.

Covered behavior includes deterministic scoring, affected-leg matching, rain exposure, provider contracts, alert thresholds, fingerprint stability, recovery, snapshot freshness, normal replay, planned work, offline state, responsive overflow, and automated accessibility.

## Release targets

- Lighthouse: performance 80+, accessibility 95+, best practices 90+.
- Warm offline view visible within one second on the target phone.
- Live provider failure becomes an honest degraded view within 25 seconds.
- All touch targets are checked manually at 44 by 44 CSS pixels or larger.

## Manual device matrix

Record date, device/OS, browser version, deployed commit, and result for:

- Android Chrome: install/open, permission allow/deny, test push, scheduled push, click-through, offline reopen, reconnect refresh, opt-out.
- iPhone/iPad: Add to Home Screen, launch installed app, permission allow/deny, test push, scheduled push, click-through, offline reopen, reconnect refresh, opt-out.
- Both: 200% text zoom, keyboard/switch navigation where available, landscape, reduced motion, and slow/failed provider responses.

Physical-device results are a release gate and must not be marked complete from desktop emulation.

## Claim discipline

Report scenario count, baseline, measurement method, and limitations with every numeric outcome. Do not describe synthetic demand, deterministic ranges, or scores as calibrated predictions.

## Reliability-model evaluation

Replay tests validate the synthetic ensemble's contract, route ordering, reasons, quantiles, explicit label and live fallback. They do not measure prediction accuracy. The real-model release protocol is defined in [PERSONALISED_JOURNEY_RELIABILITY_FORECAST.md](PERSONALISED_JOURNEY_RELIABILITY_FORECAST.md): use chronological held-out days and complete event windows, not a random row split, and compare with the deterministic scorer and provider ETA.

Required evidence includes Brier score/calibration for on-time probability; pinball loss and empirical coverage for P50/P90; deadline misses, unnecessary reroutes and useful-alert precision for commuter value; and latency, fallback and stale-data rates. Publish the evaluation period, sample count, slices and baseline beside every result. Low-confidence, stale, unsupported and schema-mismatched cases must fall back without showing a calibrated percentage.
