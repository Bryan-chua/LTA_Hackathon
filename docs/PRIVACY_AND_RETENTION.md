# Privacy and Retention

## Device-owned data

The browser is authoritative for the routine: address labels, names, coordinates, schedule, enabled state, and cached normalized journeys. Journey snapshots expire after seven days and are capped at ten.

## Data copied after explicit push consent

- origin and destination coordinates;
- departure time, arrival deadline, weekdays, and `Asia/Singapore` timezone;
- material-delay threshold and enabled state;
- a profile version hash;
- Web Push endpoint and public subscription keys.

Names, address labels, contacts, GPS observations, travel history, and provider credentials are not copied.

## Server retention and access

- Notification decisions expire according to their stored expiry and are used for deduplication/recovery.
- Installations inactive for 30 days are eligible for pruning by the morning scheduler.
- Push endpoints returning 404/410 are removed immediately.
- Opt-out deletes the installation, cascaded profile, and decisions immediately.
- Notification tables have RLS enabled and all privileges revoked from Supabase `anon` and `authenticated` roles. Only the server database connection is an application data path.

## Clear my data

Online clearing deletes the server installation, unsubscribes Web Push, and clears device storage. Offline clearing removes device data immediately and retains only a boolean deletion tombstone; the app retries server deletion on reconnection.

Logs must not include address labels, names, database URLs, provider credentials, push endpoints/keys, VAPID secrets, Cron secrets, or raw provider headers.

## Reliability-improvement consent

The Personalised Journey Reliability Forecast uses optional consent separate from push notifications. If enabled, the server retains a pseudonymous route signature, coarse departure bucket, normalized point-in-time features, model output, and user-confirmed on-time/arrival feedback. It does not retain address labels, raw GPS trails, contacts, credentials, raw headers, or unrestricted provider payloads for training.

The approved retention period is 90 days. Opt-out deletes the installation and cascades all observation rows immediately. Repeated route/time signatures remain pseudonymous and carry re-identification risk; they are not described as anonymous. Training exports/model artifacts still require a documented deletion and retraining policy before production use.
