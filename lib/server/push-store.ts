import { createHash } from "node:crypto";
import { z } from "zod";
import { database } from "./database";
import { nextCheckAt } from "../morning-check";

export const INSTALLATION_COOKIE = "smart-commute-installation";
export const evaluationProfileSchema = z.object({
  origin: z.object({ lat: z.number().min(1.1).max(1.5), lng: z.number().min(103.5).max(104.1) }),
  destination: z.object({ lat: z.number().min(1.1).max(1.5), lng: z.number().min(103.5).max(104.1) }),
  departureTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  arrivalDeadline: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  timezone: z.literal("Asia/Singapore"),
  materialDelayMinutes: z.number().int().min(5).max(60),
  enabled: z.boolean(),
}).superRefine((profile, context) => {
  if (profile.departureTime >= profile.arrivalDeadline) {
    context.addIssue({
      code: "custom",
      path: ["arrivalDeadline"],
      message: "Arrival deadline must be after departure.",
    });
  }
  if (profile.origin.lat === profile.destination.lat && profile.origin.lng === profile.destination.lng) {
    context.addIssue({
      code: "custom",
      path: ["destination"],
      message: "Origin and destination must be different.",
    });
  }
});
export const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({ p256dh: z.string().min(1).max(512), auth: z.string().min(1).max(512) }),
  profile: evaluationProfileSchema,
});

export type EvaluationProfile = z.infer<typeof evaluationProfileSchema>;

export const installationCookie = (request: Request) => request.headers.get("cookie")?.split(";").map((item) => item.trim())
  .find((item) => item.startsWith(`${INSTALLATION_COOKIE}=`))?.slice(INSTALLATION_COOKIE.length + 1);

export const profileHash = (profile: EvaluationProfile) => createHash("sha256").update(JSON.stringify(profile)).digest("hex");

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) throw new Error("Same-origin request required.");
  const parsed = new URL(origin);
  const host = request.headers.get("host") ?? new URL(request.url).host;
  if (parsed.host !== host || !["http:", "https:"].includes(parsed.protocol)) throw new Error("Same-origin request required.");
}

export async function upsertSubscription(input: z.infer<typeof subscriptionSchema>) {
  const sql = database();
  const hash = profileHash(input.profile);
  const next = nextCheckAt(new Date(), input.profile.weekdays, input.profile.departureTime);
  const installation = await sql.begin(async (transaction) => {
    const [row] = await transaction`
      insert into notification_installations (push_endpoint, push_p256dh, push_auth, timezone)
      values (${input.endpoint}, ${input.keys.p256dh}, ${input.keys.auth}, ${input.profile.timezone})
      on conflict (push_endpoint) do update set
        push_p256dh = excluded.push_p256dh,
        push_auth = excluded.push_auth,
        timezone = excluded.timezone,
        last_seen_at = now(),
        disabled_at = null
      returning id, public_id
    `;
    await transaction`
      insert into evaluation_profiles (
        installation_id, origin_lat, origin_lng, destination_lat, destination_lng,
        departure_time, arrival_deadline, weekdays, material_delay_minutes, enabled,
        version_hash, next_check_at, lease_until, updated_at
      ) values (
        ${row.id}, ${input.profile.origin.lat}, ${input.profile.origin.lng},
        ${input.profile.destination.lat}, ${input.profile.destination.lng},
        ${input.profile.departureTime}, ${input.profile.arrivalDeadline}, ${input.profile.weekdays},
        ${input.profile.materialDelayMinutes}, ${input.profile.enabled}, ${hash}, ${next}, null, now()
      )
      on conflict (installation_id) do update set
        origin_lat = excluded.origin_lat, origin_lng = excluded.origin_lng,
        destination_lat = excluded.destination_lat, destination_lng = excluded.destination_lng,
        departure_time = excluded.departure_time, arrival_deadline = excluded.arrival_deadline,
        weekdays = excluded.weekdays, material_delay_minutes = excluded.material_delay_minutes,
        enabled = excluded.enabled, version_hash = excluded.version_hash,
        next_check_at = excluded.next_check_at, lease_until = null, updated_at = now()
    `;
    return row;
  });
  return { publicId: String(installation.public_id), versionHash: hash, nextCheckAt: next.toISOString() };
}

export async function updateProfile(publicId: string, profile: EvaluationProfile) {
  const sql = database();
  const hash = profileHash(profile);
  const next = nextCheckAt(new Date(), profile.weekdays, profile.departureTime);
  const rows = await sql`
    update evaluation_profiles p set
      origin_lat = ${profile.origin.lat}, origin_lng = ${profile.origin.lng},
      destination_lat = ${profile.destination.lat}, destination_lng = ${profile.destination.lng},
      departure_time = ${profile.departureTime}, arrival_deadline = ${profile.arrivalDeadline},
      weekdays = ${profile.weekdays}, material_delay_minutes = ${profile.materialDelayMinutes},
      enabled = ${profile.enabled}, version_hash = ${hash}, next_check_at = ${next},
      lease_until = null, updated_at = now()
    from notification_installations i
    where p.installation_id = i.id and i.public_id = ${publicId} and i.disabled_at is null
    returning p.installation_id
  `;
  if (rows.length === 0) throw new Error("Notification installation not found.");
  return { versionHash: hash, nextCheckAt: next.toISOString() };
}

export async function deleteInstallation(publicId: string) {
  await database()`delete from notification_installations where public_id = ${publicId}`;
}
