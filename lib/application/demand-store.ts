import { randomUUID } from "node:crypto";
import type { DemandProfile } from "../demand-flow";
import type { Scenario } from "../domain";

export const DEMAND_TTL_MS = 30 * 60_000;
export const DEMAND_COOKIE = "smart-commute-demand";
export const demandDemoEnabled = () => process.env.DEMAND_DEMO_ENABLED === "true" ||
  (process.env.NODE_ENV !== "production" && process.env.DEMAND_DEMO_ENABLED !== "false");

interface Participation {
  expiresAt: number;
  selection?: { scenarioId: Scenario["id"]; profile: DemandProfile; journeyId: string };
}

/** Bounded, single-process demo store; use transactional shared storage before live use. */
export class DemandStore {
  private readonly participants = new Map<string, Participation>();
  constructor(private readonly now = Date.now, private readonly limit = 250) {}

  private prune() {
    for (const [id, item] of this.participants) {
      if (item.expiresAt <= this.now()) this.participants.delete(id);
    }
  }

  has(id: string | undefined): boolean {
    this.prune();
    return Boolean(id && this.participants.has(id));
  }

  consent(previous?: string): string {
    this.prune();
    if (previous && this.participants.has(previous)) return previous;
    if (this.participants.size >= this.limit) throw new Error("Demand demo is full. Please try again later.");
    const id = randomUUID();
    this.participants.set(id, { expiresAt: this.now() + DEMAND_TTL_MS });
    return id;
  }

  accept(id: string, selection: NonNullable<Participation["selection"]>) {
    this.prune();
    const participant = this.participants.get(id);
    if (!participant) throw new Error("Consent expired. Please opt in again.");
    // Replacement is atomic in one JS process: retries/route switches never accumulate.
    participant.selection = selection;
  }

  withdraw(id?: string) {
    if (id) this.participants.delete(id);
  }

  selections(scenarioId: Scenario["id"], profile: DemandProfile): string[] {
    this.prune();
    return [...this.participants.values()].flatMap(({ selection }) =>
      selection?.scenarioId === scenarioId && selection.profile === profile ? [selection.journeyId] : []);
  }
}

const globalStore = globalThis as typeof globalThis & { demandDemoStore?: DemandStore };
export const demandStore = globalStore.demandDemoStore ??= new DemandStore();

export function demandCookie(request: Request): string | undefined {
  return request.headers.get("cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${DEMAND_COOKIE}=`))?.slice(DEMAND_COOKIE.length + 1);
}
