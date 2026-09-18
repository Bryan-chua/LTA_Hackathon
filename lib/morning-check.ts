import { createHash } from "node:crypto";
import type { JourneyPlanView } from "./application/journey-view-model";
import type { Routine } from "./domain";
import { minutesSinceMidnight } from "./journey-scoring";

export type DecisionResult = "no_action" | "action_required" | "recovery" | "failed";
export interface MorningDecision {
  result: DecisionResult;
  reasonCodes: string[];
  title: string;
  body: string;
  targetUrl: string;
  fingerprint: string;
}

const minutesDifference = (left: string, right: string) => minutesSinceMidnight(left) - minutesSinceMidnight(right);

export function decideMorningCheck(
  installationId: string,
  profileVersion: string,
  routine: Routine,
  plan: JourneyPlanView,
  previousAction = false,
): MorningDecision {
  const recommended = plan.alternatives.find((alternative) => alternative.recommended) ?? plan.alternatives[0];
  const usual = plan.alternatives.find((alternative) => alternative.journey.id === plan.scenario.usualJourney.id) ?? plan.alternatives[0];
  const reasons: string[] = [];
  if (minutesDifference(recommended.journey.arrival.latest, routine.arrivalDeadline) > 0) reasons.push("deadline_risk");
  if (minutesDifference(usual.journey.arrival.p50, recommended.journey.arrival.p50) >= (routine.materialDelayMinutes ?? 10)) reasons.push("material_delay");
  if (plan.scenario.conditions.some((condition) => condition.severity === "major") && plan.affectedSegments.length > 0) reasons.push("major_event");
  if (minutesDifference(routine.departureTime, recommended.journey.departureAt) >= 5) reasons.push("leave_earlier");
  const providerUnavailable = plan.providers?.some((provider) => provider.status === "unavailable") ?? false;
  const result: DecisionResult = providerUnavailable ? "failed" : reasons.length > 0 ? "action_required" : previousAction ? "recovery" : "no_action";
  const title = result === "action_required" ? "Your commute needs a change" :
    result === "recovery" ? "Your usual commute is safe again" :
    result === "failed" ? "Commute check could not be verified" : "Usual commute on track";
  const body = result === "action_required" ? `${plan.recommendation.action}. ${plan.recommendation.reason}` :
    result === "recovery" ? `Leave around ${routine.departureTime} as usual. Conditions no longer require the previous change.` :
    result === "failed" ? "Open Smart Commute to review the latest available information." :
    `No material change. Expected arrival ${recommended.journey.arrival.earliest}–${recommended.journey.arrival.latest}.`;
  const departureBucket = recommended.journey.departureAt.slice(0, 16);
  const eventIds = plan.scenario.conditions.map((condition) => condition.id).sort().join(",");
  const risk = reasons.includes("deadline_risk") ? "late" : reasons.length ? "material" : "safe";
  const fingerprint = createHash("sha256")
    .update([installationId, profileVersion, eventIds, recommended.journey.id, departureBucket, risk, result].join("|"))
    .digest("hex");
  return { result, reasonCodes: reasons, title, body, targetUrl: "/", fingerprint };
}

export function nextCheckAt(now: Date, weekdays: number[], departureTime: string): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const [hour, minute] = departureTime.split(":").map(Number);
  for (let dayOffset = 0; dayOffset < 8; dayOffset += 1) {
    const base = new Date(Date.UTC(value("year"), value("month") - 1, value("day") + dayOffset));
    const weekday = base.getUTCDay();
    if (!weekdays.includes(weekday)) continue;
    for (const lead of [30, 15, 5]) {
      const due = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hour - 8, minute - lead));
      if (due.getTime() > now.getTime() + 60_000) return due;
    }
  }
  return new Date(now.getTime() + 24 * 60 * 60_000);
}
