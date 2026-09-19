import { sendWebPush } from "./web-push";
import { createHash } from "node:crypto";
import type { Routine } from "../domain";
import { planLiveJourney } from "../live/live-planner";
import { decideMorningCheck, nextCheckAt } from "../morning-check";
import { database } from "./database";

interface ClaimedProfile {
  installation_id: number;
  public_id: string;
  push_endpoint: string;
  push_p256dh: string;
  push_auth: string;
  origin_lat: number;
  origin_lng: number;
  destination_lat: number;
  destination_lng: number;
  departure_time: string;
  arrival_deadline: string;
  weekdays: number[];
  material_delay_minutes: number;
  version_hash: string;
}

async function claimDueProfiles(limit = 20): Promise<ClaimedProfile[]> {
  return database().begin(async (sql) => sql<ClaimedProfile[]>`
    with due as (
      select p.installation_id
      from evaluation_profiles p
      join notification_installations i on i.id = p.installation_id
      where p.enabled
        and p.next_check_at <= now()
        and (p.lease_until is null or p.lease_until < now())
        and i.disabled_at is null
      order by p.next_check_at
      limit ${limit}
      for update of p skip locked
    )
    update evaluation_profiles p
    set lease_until = now() + interval '5 minutes'
    from due, notification_installations i
    where p.installation_id = due.installation_id and i.id = p.installation_id
    returning p.installation_id, i.public_id, i.push_endpoint, i.push_p256dh, i.push_auth,
      p.origin_lat, p.origin_lng, p.destination_lat, p.destination_lng,
      p.departure_time::text, p.arrival_deadline::text, p.weekdays,
      p.material_delay_minutes, p.version_hash
  `);
}

const routineFrom = (profile: ClaimedProfile): Routine => ({
  id: `scheduled-${profile.public_id}`,
  travellerName: "Commuter",
  origin: { name: "Saved origin", shortName: "Origin", coordinate: { lat: profile.origin_lat, lng: profile.origin_lng } },
  destination: { name: "Saved destination", shortName: "Destination", coordinate: { lat: profile.destination_lat, lng: profile.destination_lng } },
  departureTime: profile.departure_time.slice(0, 5),
  arrivalDeadline: profile.arrival_deadline.slice(0, 5),
  weekdays: profile.weekdays.map(Number),
  enabled: true,
  timezone: "Asia/Singapore",
  materialDelayMinutes: Number(profile.material_delay_minutes),
});

async function processProfile(profile: ClaimedProfile) {
  const sql = database();
  const routine = routineFrom(profile);
  try {
    const previous = await sql`
      select result from notification_decisions
      where installation_id = ${profile.installation_id} and sent_at > now() - interval '24 hours'
      order by sent_at desc limit 1
    `;
    const plan = await planLiveJourney(routine);
    const decision = decideMorningCheck(profile.public_id, profile.version_hash, routine, plan, previous[0]?.result === "action_required");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60_000);
    const inserted = await sql`
      insert into notification_decisions (
        installation_id, fingerprint, result, reason_codes, title, body, target_url, expires_at
      ) values (
        ${profile.installation_id}, ${decision.fingerprint}, ${decision.result}, ${decision.reasonCodes},
        ${decision.title}, ${decision.body}, '/', ${expiresAt}
      )
      on conflict (installation_id, fingerprint) do update set
        result = excluded.result, reason_codes = excluded.reason_codes,
        title = excluded.title, body = excluded.body, target_url = excluded.target_url,
        evaluated_at = now(), sent_at = null, expires_at = excluded.expires_at
      where notification_decisions.evaluated_at <= now() - interval '60 minutes'
      returning id, public_id
    `;
    if (inserted.length > 0 && ["action_required", "recovery"].includes(decision.result)) {
      const targetUrl = `/?decision=${inserted[0].public_id}`;
      try {
        await sendWebPush({
          endpoint: profile.push_endpoint,
          p256dh: profile.push_p256dh,
          auth: profile.push_auth,
        }, { title: decision.title, body: decision.body, url: targetUrl, decisionId: inserted[0].public_id });
        await sql`update notification_decisions set sent_at = now(), target_url = ${targetUrl} where id = ${inserted[0].id}`;
      } catch (error) {
        const status = typeof error === "object" && error && "statusCode" in error ? Number(error.statusCode) : 0;
        if (status === 404 || status === 410) {
          await sql`delete from notification_installations where id = ${profile.installation_id}`;
          return { sent: 0, removed: 1, failed: 0 };
        }
        throw error;
      }
    }
    await sql`
      update evaluation_profiles
      set next_check_at = ${nextCheckAt(new Date(), routine.weekdays, routine.departureTime)}, lease_until = null
      where installation_id = ${profile.installation_id}
    `;
    return { sent: inserted.length > 0 && ["action_required", "recovery"].includes(decision.result) ? 1 : 0, removed: 0, failed: 0 };
  } catch {
    const failedFingerprint = createHash("sha256")
      .update([profile.public_id, profile.version_hash, "failed", Math.floor(Date.now() / 300_000)].join("|"))
      .digest("hex");
    await sql`
      insert into notification_decisions (
        installation_id, fingerprint, result, reason_codes, title, body, target_url, expires_at
      ) values (
        ${profile.installation_id}, ${failedFingerprint}, 'failed', '{}', 'Commute check failed',
        'Live providers could not complete the scheduled check.', '/', now() + interval '24 hours'
      ) on conflict (installation_id, fingerprint) do nothing`;
    await sql`
      update evaluation_profiles
      set next_check_at = ${nextCheckAt(new Date(), routine.weekdays, routine.departureTime)}, lease_until = null
      where installation_id = ${profile.installation_id}
    `;
    return { sent: 0, removed: 0, failed: 1 };
  }
}

export async function runMorningChecks() {
  const profiles = await claimDueProfiles();
  const totals = { claimed: profiles.length, sent: 0, removed: 0, failed: 0 };
  for (const profile of profiles) {
    const result = await processProfile(profile);
    totals.sent += result.sent;
    totals.removed += result.removed;
    totals.failed += result.failed;
  }
  await database()`delete from notification_installations where last_seen_at < now() - interval '30 days'`;
  await database()`delete from notification_decisions where expires_at < now()`;
  return totals;
}
