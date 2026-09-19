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
