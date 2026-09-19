import { createHash } from "node:crypto";
import { z } from "zod";
import type { Alternative, Journey, TravelCondition } from "../domain";
import type { JourneyPlanView } from "../application/journey-view-model";
import { RELIABILITY_FEATURE_SCHEMA_VERSION } from "../reliability-forecast";
import { database } from "./database";

export const FORECAST_COOKIE = "smart-commute-forecast";
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export const feedbackSchema = z.object({
  observationId: z.string().uuid(),
  arrivedBeforeDeadline: z.boolean(),
  actualArrival: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  tookRecommended: z.boolean(),
});

export const forecastCookie = (request: Request) => {
  const value = request.headers.get("cookie")?.split(";")
    .map((item) => item.trim()).find((item) => item.startsWith(`${FORECAST_COOKIE}=`))
    ?.slice(FORECAST_COOKIE.length + 1);
  return z.string().uuid().safeParse(value).data;
};

export async function createForecastInstallation(existingPublicId?: string) {
  if (existingPublicId) {
    const [existing] = await database()`
      update forecast_installations set last_seen_at = now(), disabled_at = null
      where public_id = ${existingPublicId} returning public_id
    `;
    if (existing) return String(existing.public_id);
  }
  const [row] = await database()`insert into forecast_installations default values returning public_id`;
  return String(row.public_id);
}

export async function deleteForecastInstallation(publicId: string) {
  await database()`delete from forecast_installations where public_id = ${publicId}`;
}

const routeSignature = (journey: Journey) => sha256(JSON.stringify(journey.legs.map((leg) => ({
  mode: leg.mode,
  line: leg.lineId ?? null,
  stations: leg.stationCodes ?? [],
}))));

const normalizedFeatures = (alternative: Alternative, conditions: TravelCondition[]) => ({
  durationMinutes: alternative.journey.legs.reduce((sum, leg) => sum + leg.durationMinutes, 0),
  walkingMinutes: alternative.journey.legs.filter((leg) => leg.mode === "walk").reduce((sum, leg) => sum + leg.durationMinutes, 0),
  transfers: alternative.transfers,
  crowding: alternative.crowding,
  uncertaintyMinutes: alternative.scoreBreakdown.components.find((item) => item.key === "uncertaintyPenalty")?.valueLabel,
  disruptionCount: conditions.filter((condition) => condition.kind === "train_disruption" || condition.kind === "planned_work").length,
  weatherSeverity: conditions.find((condition) => condition.kind === "weather")?.severity ?? "none",
  providerMode: alternative.journey.provider?.mode ?? "replay",
});

export async function recordForecastObservations(publicId: string, plan: JourneyPlanView) {
  const sql = database();
  const [installation] = await sql`
    update forecast_installations set last_seen_at = now()
    where public_id = ${publicId} and disabled_at is null
    returning id
  `;
  if (!installation) return;
  await sql.begin(async (transaction) => {
    for (const alternative of plan.alternatives) {
      const reliability = alternative.reliability;
      const signature = routeSignature(alternative.journey);
      const fingerprint = sha256(JSON.stringify([
        plan.scenario.id, alternative.journey.id, plan.scenario.updatedAt,
        reliability.modelVersion ?? reliability.method,
      ]));
      const [row] = await transaction`
        insert into journey_forecast_observations (
          installation_id, observation_fingerprint, route_signature, departure_bucket,
          feature_schema_version, model_version, method, features, forecast, expires_at
        ) values (
          ${installation.id}, ${fingerprint}, ${signature},
          ${alternative.journey.departureAt.includes("T") ? alternative.journey.departureAt.slice(11, 16) : alternative.journey.departureAt},
          ${RELIABILITY_FEATURE_SCHEMA_VERSION}, ${reliability.modelVersion ?? null}, ${reliability.method},
          ${sql.json(normalizedFeatures(alternative, plan.scenario.conditions))},
          ${sql.json({ probabilityBeforeDeadline: reliability.probabilityBeforeDeadline,
            p50Arrival: reliability.p50Arrival, p90Arrival: reliability.p90Arrival,
            confidence: reliability.confidence, freshness: reliability.freshness,
            synthetic: reliability.synthetic })},
          now() + interval '90 days'
        )
        on conflict (installation_id, observation_fingerprint) do update set
          observation_fingerprint = excluded.observation_fingerprint
        returning public_id
      `;
      if (row) reliability.observationId = String(row.public_id);
    }
  });
}

export async function saveForecastFeedback(publicId: string, input: z.infer<typeof feedbackSchema>) {
  const rows = await database()`
    update journey_forecast_observations o set
      arrived_before_deadline = ${input.arrivedBeforeDeadline},
      actual_arrival = ${input.actualArrival ?? null},
      took_recommended = ${input.tookRecommended},
      label_source = 'user_feedback', labelled_at = now()
    from forecast_installations i
    where o.installation_id = i.id and i.public_id = ${publicId}
      and o.public_id = ${input.observationId} and i.disabled_at is null and o.expires_at > now()
    returning o.public_id
  `;
  if (rows.length === 0) throw new Error("Forecast observation not found.");
}

export async function pruneForecastData() {
  await database()`delete from journey_forecast_observations where expires_at <= now()`;
  await database()`delete from forecast_installations where disabled_at is not null or last_seen_at < now() - interval '90 days'`;
}
