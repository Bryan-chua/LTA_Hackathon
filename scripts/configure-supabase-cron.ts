import postgres from "postgres";

const databaseUrl = process.env.MIGRATION_DATABASE_URL;
const appBaseUrl = process.env.APP_BASE_URL?.replace(/\/$/, "");
const cronSecret = process.env.CRON_SECRET;
if (!databaseUrl || !appBaseUrl || !cronSecret) {
  throw new Error("MIGRATION_DATABASE_URL, APP_BASE_URL, and CRON_SECRET are required.");
}
if (!appBaseUrl.startsWith("https://")) throw new Error("APP_BASE_URL must use HTTPS.");

const sql = postgres(databaseUrl, { max: 1, prepare: false, ssl: "require" });
try {
  await sql.unsafe('create extension if not exists pg_cron with schema pg_catalog');
  await sql.unsafe('create extension if not exists pg_net with schema extensions');
  await sql.unsafe('create extension if not exists supabase_vault with schema vault');

  await sql.begin(async (transaction) => {
    await transaction`select vault.create_secret(${appBaseUrl}, 'smart_commute_app_url', 'Smart Commute public HTTPS origin')
      where not exists (select 1 from vault.secrets where name = 'smart_commute_app_url')`;
    await transaction`select vault.update_secret(id, ${appBaseUrl}) from vault.secrets where name = 'smart_commute_app_url'`;
    await transaction`select vault.create_secret(${cronSecret}, 'smart_commute_cron_secret', 'Bearer secret for morning checks')
      where not exists (select 1 from vault.secrets where name = 'smart_commute_cron_secret')`;
    await transaction`select vault.update_secret(id, ${cronSecret}) from vault.secrets where name = 'smart_commute_cron_secret'`;
    await transaction`select cron.unschedule(jobid) from cron.job where jobname = 'smart-commute-morning-checks'`;
    await transaction.unsafe(`
      select cron.schedule(
        'smart-commute-morning-checks',
        '*/5 * * * *',
        $job$
        select net.http_post(
          url := (select decrypted_secret from vault.decrypted_secrets where name = 'smart_commute_app_url') || '/api/cron/morning-checks',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'smart_commute_cron_secret')
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 50000
        );
        $job$
      )
    `);
  });
  console.log("Supabase Cron configured: smart-commute-morning-checks (every five minutes).");
} finally {
  await sql.end();
}
