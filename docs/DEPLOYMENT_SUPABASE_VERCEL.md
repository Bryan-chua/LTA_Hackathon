# Supabase and Vercel Deployment

## 1. Create secrets

Generate a strong `CRON_SECRET` and VAPID key pair. Never commit or paste their values into documentation or logs.

## 2. Configure Vercel

Use the Supabase **transaction pooler** connection for `DATABASE_URL` and set:

```text
DATA_MODE=live
LIVE_PROVIDERS_ENABLED=true
LTA_DATAMALL_ACCOUNT_KEY=...
ONEMAP_ACCESS_TOKEN=...
ONEMAP_EMAIL=...
ONEMAP_PASSWORD=...
DATABASE_URL=postgresql://...:6543/postgres
CRON_SECRET=...
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:team-contact@example.com
PUSH_ENABLED=true
PUSH_TEST_ENABLED=true
NEXT_PUBLIC_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/bright
```

For a long-running deployment, prefer `ONEMAP_EMAIL` and `ONEMAP_PASSWORD`; the server obtains and caches a token and renews it before expiry. `ONEMAP_ACCESS_TOKEN` is an optional manual override and must be replaced when it expires.

Before deploying, verify all live sources without printing credentials:

```bash
npm run providers:check
```

The app uses a module-scoped Postgres.js client with pool size one, prepared statements disabled, and SSL required, matching Supabase serverless guidance.

## 3. Apply migrations locally

Use a direct or session connection reachable from your machine:

```text
MIGRATION_DATABASE_URL=postgresql://...
APP_BASE_URL=https://your-app.vercel.app
```

Then run:

```bash
npm run db:migrate
```

The runner applies sorted migrations once through `app_schema_migrations`. Migration 002 enables RLS, removes browser-role privileges, and adds the test-push cooldown column.

## 4. Deploy Vercel, then configure Supabase Cron

After the production HTTPS URL responds successfully, run:

```bash
npm run db:configure-cron
```

The idempotent script enables `pg_cron`, `pg_net`, and Vault, stores the app URL and Cron bearer secret in Vault, replaces the named job, and schedules an authenticated `POST /api/cron/morning-checks` every five minutes. It prints no secret values.

Verify `cron.job` contains `smart-commute-morning-checks` and inspect recent `net._http_response`/Cron history in the Supabase dashboard without exposing request authorization headers.

## 5. Production checks

1. Subscribe on Android Chrome and use **Send test notification**.
2. Install to an iPhone Home Screen, subscribe, and send a test.
3. Confirm a second test inside five minutes receives HTTP 429.
4. Confirm opt-out removes the installation and cascaded rows.
5. Use an expired test endpoint in staging and confirm HTTP 404/410 removes it.
6. Invoke the Cron endpoint without or with a wrong bearer token and confirm HTTP 401.

Supabase references: [serverless database connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), and [scheduled functions/Cron](https://supabase.com/docs/guides/functions/schedule-functions).
