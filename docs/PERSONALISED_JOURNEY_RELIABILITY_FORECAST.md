# Personalised Journey Reliability Forecast - Implementation Plan

## Status and objective

**Status:** MVP implemented. Replay routes use a small, visibly labelled synthetic gradient-boosted decision-stump ensemble; live routes use the deterministic fallback because no calibrated real-world model has passed promotion gates. Observation consent, 90-day retention, feedback, reasons, confidence/freshness and score integration are implemented. Real-data training, shadow deployment and personal calibration remain future stages.

Add a reliability result to every route candidate: probability of arriving before the personal deadline, P50/P90 arrival, the strongest reasons, and confidence/freshness. Use structured gradient-boosted models, not an LLM. The existing deterministic scorer remains the mandatory fallback.

## Current baseline

Already implemented:

- OneMap candidate journeys and timing;
- matched `TrainServiceAlerts`;
- `PCDRealTime`/`PCDForecast` crowd categories;
- two-hour weather applied to walking legs;
- provider provenance, validity, age and warnings;
- deterministic arrival ranges, explanations and `deadlineRisk`;
- replay scenarios suitable for cold start.

Now implemented: the forecast contract/UI, replay-only synthetic probability/P50/P90, source-backed reasons, confidence/freshness, deterministic live fallback, deadline-risk integration, separate observation consent, outcome correction/deletion, and a secured 90-day PostgreSQL observation schema.

Still not implemented: a real labelled corpus, BusArrival/road/PV features, production model training/artifacts, calibrated live probabilities, drift monitoring, or personal calibration.

## Forecast contract and presentation

```ts
interface JourneyReliabilityForecast {
  method: "model" | "synthetic_model" | "deterministic_fallback";
  modelVersion?: string;
  synthetic: boolean;
  probabilityBeforeDeadline?: number;
  p50Arrival: string;
  p90Arrival?: string;
  likelyArrival: { from: string; to: string };
  reasons: Array<{
    code: string;
    label: string;
    direction: "helps" | "hurts";
    contribution?: number;
    source: string;
  }>;
  confidence: "high" | "medium" | "low";
  freshness: "live" | "forecast" | "cached" | "stale" | "replay";
  dataCompleteness: number;
  fallbackReason?: "model_unavailable" | "stale_critical_data"
    | "insufficient_similar_journeys" | "unsupported_route"
    | "schema_mismatch";
}
```

- Eligible model: **"84% likely to arrive before 08:45 - P50 08:41 - P90 08:46."**
- Compact: **"Likely arrival between 08:37-08:46."**
- Fallback: show the deterministic interval and **"Cautious rule-based estimate - not calibrated."** Do not invent a percentage or statistical P90.
- Show at most three source-backed reasons, ordered by absolute contribution and rendered through reviewed deterministic templates.
- Show confidence/freshness next to the result; put model version and provider timestamps in Data details.

"Personalised" initially means conditioned on the commuter's route, schedule and deadline. Until enough opted-in feedback exists, describe it as a population reliability model rather than individual behavioural calibration.

## Architecture and scoring integration

Create a `ReliabilityForecaster` interface with `DeterministicReliabilityForecaster` and `ModelReliabilityForecaster` implementations. A `ForecastEligibilityService` rejects learned output when the feature schema differs, critical data is stale, the route is unsupported, comparable history is insufficient, output is invalid, or the model has failed a release/monitoring gate.

For eligible results only, set `deadlineRisk = 1 - probabilityBeforeDeadline`. Otherwise preserve the existing `deadlineRisk` function unchanged. Other deterministic score components remain inspectable.

```text
providers -> normalized candidate + point-in-time features
                              |
                     eligibility gate
                       /           \
                versioned model   deterministic fallback
                       \           /
                    forecast contract -> existing scorer
```

Feature extraction must store values exactly as known at prediction time. Later observations must never leak into earlier training rows.

## Feature schema

Phase 1 uses existing candidate duration, transfers, modes, walk/wait time, uncertainty, route signature, departure bucket, deadline margin, alert intersection/severity/mitigation/age, crowd category/mode/age, forecast weather/walking exposure, and provider-quality fields.

Phase 2 adds:

- `BusArrival`: ETA spread, reported load and accessibility for bus legs;
- road feeds: incident/roadworks intersection and speed-band change;
- `PV/Train`, `PV/ODTrain`, `PV/Bus`, `PV/ODBus` as monthly normal-demand baselines only;
- planned works with strict effective-time handling;
- opted-in actual-arrival/on-time and route-taken feedback.

Keep forecast versus observed weather separate, real-time versus forecast crowding separate, and missing/`NA` values explicit.

## Observation and consent design

Add a versioned `journey_forecast_observations` store containing a pseudonymous installation ID, non-reversible route signature, coarse departure bucket, schema/model versions, normalized point-in-time features, prediction, confidence/fallback reason, optional confirmed label, consent, and expiry timestamps.

Do not store address labels, raw GPS trails, contacts, credentials, raw headers, or unrestricted raw provider payloads. Exact endpoints are unnecessary in the training table. Route/time signatures remain pseudonymous and must not be called anonymous.

- Ask after the arrival window: **"Did you arrive by 08:45?"**, optional arrival time, and **"Did you take the recommended route?"**
- Use separate consent from Web Push; allow correction, opt-out and deletion.
- Do not infer arrival from continuous/background location.
- Exclude unconfirmed outcomes from supervised training.
- Proposed personal-observation retention is 90 days; this requires confirmation.

## Model design

Train three models over one feature schema:

1. Gradient-boosted classifier for `P(arrive before deadline)`.
2. Quantile gradient-boosted regressor for P50 journey duration.
3. Quantile gradient-boosted regressor for P90 journey duration.

Predict duration/delay, then add it to departure. Calibrate the classifier on a time-separated validation set using isotonic or sigmoid calibration selected by held-out Brier score. Enforce `P90 >= P50` and reject materially inconsistent output.

Start with a population model. Add an installation-specific calibration offset only after a configurable minimum of confirmed journeys (proposed: 20), rather than fitting a small per-user tree model.

Map feature contributions through an allow-list of commuter-facing templates. Reasons must name their source and must not imply causation beyond the input. No raw feature identifiers or arbitrary model text reaches the UI.

## Confidence and fallback policy

Confidence combines critical-provider freshness/completeness, training-distribution distance, comparable-journey count, calibration and quantile coverage for the relevant slice, and disagreement with the deterministic range. It is not derived from the largest predicted probability.

Proposed starting eligibility gates are 500 labelled candidates overall, 30 comparable route/mode/time observations, and 20 confirmed personal journeys before personal calibration. They are configurable engineering defaults to revise after data profiling.

Low confidence, stale data, insufficient similarity, unsupported routes, inference failure and schema mismatch always fall back. Record the reason and do not issue a model-only alert unless it also passes the existing interruption policy.

## Deferred GCP implementation path

The ML feature is implemented before the Cloud Run transition. The current deployment remains unchanged; the owner will move the application to Cloud Run separately.

- Cloud Run: public web/API deployment or a separately versioned forecast service.
- Cloud Run Jobs: feature validation, training, backtesting and promotion.
- Cloud Scheduler: approved snapshot collection and retraining triggers.
- Cloud Storage: immutable, checksum-verified model bundles and reports.
- Secret Manager: provider/service credentials, never client bundles.
- Cloud Logging/Monitoring: version, latency, fallback and drift metrics without personal route data.
- Optional BigQuery: de-identified training/evaluation data when it outgrows PostgreSQL. Supabase may remain the consent and transactional store.

Online planning must not depend on a slow training-platform call. Bound inference with a short timeout and fall directly back to deterministic scoring.

## Delivery stages

### A - contract and honest fallback - implemented

- Add forecast domain/API/view-model fields.
- Wrap the existing interval and `deadlineRisk` in the deterministic forecaster.
- Rank source-backed disruption/crowding/weather reasons.
- Add confidence/freshness UI and Data details.
- Test fallback selection and no-percentage copy.

**Exit:** every candidate has an understandable reliability panel without an ML claim.

### B - consent and observations - implemented

- Add separate forecast-improvement consent and feedback UI.
- Add migration, server-only repository, retention/deletion job and access controls.
- Persist normalized point-in-time features and confirmed labels.
- Collect sanitized network snapshots only where provider terms permit.
- Add schema validation and data-quality reporting.

**Exit:** labelled examples can be collected, exported and deleted reproducibly without raw locations or GPS trails.

### C - real-data baseline model and offline evaluation - pending labelled data

- Share reproducible feature extraction between inference and training.
- Train the classifier and P50/P90 models.
- Use chronological train/validation/test splits; keep whole events/days together.
- Compare with the deterministic scorer and provider ETA.
- Create a versioned model manifest with schema, training window, metrics and supported slices.

**Exit:** promote an artifact only if it beats the baseline and passes release gates.

### D - guarded calibrated inference - pending

- Load a pinned model behind `RELIABILITY_MODEL_ENABLED`.
- Start in shadow mode without changing recommendations.
- Run eligibility and inference inside journey planning.
- Promote gradually and roll back on schema mismatch, latency/error increase, calibration degradation or excessive disagreement.

**Exit:** qualified candidates show calibrated probability and P50/P90; others fall back safely.

### E - enrichment and personal calibration - pending

- Add BusArrival, road and monthly PV features.
- Add personal calibration only after the confirmed-label threshold.
- Monitor route, mode, time, disruption, rain and confidence slices.

**Exit:** keep enrichments only where they measurably outperform the population model and deterministic fallback.

## Evaluation and release gates

Use chronological held-out data, never a random row split. Report:

- probability: Brier score, log loss, reliability diagram and expected calibration error;
- P50/P90: pinball loss, median absolute error and empirical quantile coverage;
- commuter value: deadline misses, unnecessary reroutes, useful-alert precision and silence on normal journeys;
- operations: inference latency, availability, fallback/stale/schema-failure rates;
- slices: route family, mode, time bucket, normal/disrupted, dry/rain and data mode.

Promotion requires improvement over the deterministic baseline on held-out probability and commuter value, no material disruption/rain regression, declared P90 coverage tolerance, no temporal leakage, verified reason templates, reliable fallback, and passing consent/deletion/expiry tests. Never publish an accuracy percentage without test period, sample count, baseline and calibration result.

## Test plan

- Unit: extraction, missing values, quantile ordering, similarity, eligibility, confidence, reasons and score conversion.
- Contract: model manifest/schema and malformed/expired artifact rejection.
- Integration: fresh result, stale fallback, unsupported route, cold start, shadow mode, timeout, correction and opt-out deletion.
- Offline evaluation: deterministic versus model over held-out days and complete event windows.
- End to end: mobile forecast card, accessible reason disclosure, Data details, qualitative fallback, consent and feedback.
- Privacy/security: no secrets, labels, raw GPS, push keys or unrestricted payloads in observations/logs.

## Feature flags

```text
RELIABILITY_FORECAST_UI_ENABLED=true
RELIABILITY_OBSERVATION_ENABLED=false
RELIABILITY_MODEL_ENABLED=false
RELIABILITY_MODEL_SHADOW_MODE=true
RELIABILITY_MODEL_URI=
RELIABILITY_MODEL_VERSION=
RELIABILITY_MIN_GLOBAL_LABELS=500
RELIABILITY_MIN_SIMILAR_LABELS=30
RELIABILITY_MIN_PERSONAL_LABELS=20
```

Flags default to deterministic behavior until consent, data, evaluation and deployment gates pass.

## Confirmed decisions

1. Implement the ML experience first; the owner will handle the Cloud Run transition later.
2. Retain opted-in pseudonymous labelled observations for 90 days, with immediate cascade deletion on opt-out.
3. Show replay forecasts with the small, non-glaring **Synthetic model output** label. Synthetic output is never presented as calibrated live performance.
