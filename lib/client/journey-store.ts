import type { JourneyPlanView } from "../application/journey-view-model";
import { JOURNEY_STORE, openDeviceDatabase, readSetting, writeSetting } from "./device-database";

const ACTIVE_SNAPSHOT_KEY = "active-snapshot-v2";
const PENDING_SERVER_DELETE_KEY = "pending-server-delete-v1";
const LEGACY_ACTIVE_KEY = "smart-commute-active-journey";
const RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_SNAPSHOTS = 10;

export interface CachedJourneySnapshot {
  id: string;
  plan: JourneyPlanView;
  selectedJourneyId?: string;
  cachedAt: string;
  expiresAt: string;
}

export type DataFreshness = "fresh" | "stale" | "expired";
export type PersistenceState = "saving" | "saved" | "unavailable";

export function snapshotFreshness(snapshot: CachedJourneySnapshot, now = new Date()): DataFreshness {
  if (new Date(snapshot.expiresAt).getTime() <= now.getTime()) return "expired";
  const staleTimes = snapshot.plan.providers?.map((provider) => provider.staleAt).filter(Boolean) as string[] | undefined;
  if (staleTimes?.some((value) => new Date(value).getTime() <= now.getTime())) return "stale";
  return "fresh";
}

async function allSnapshots(): Promise<CachedJourneySnapshot[]> {
  const database = await openDeviceDatabase();
  return new Promise((resolve) => {
    const transaction = database.transaction(JOURNEY_STORE, "readonly");
    const request = transaction.objectStore(JOURNEY_STORE).getAll();
    request.onsuccess = () => resolve((request.result as CachedJourneySnapshot[]).sort((a, b) => b.cachedAt.localeCompare(a.cachedAt)));
    request.onerror = () => resolve([]);
    transaction.oncomplete = () => database.close();
  });
}

export async function pruneJourneySnapshots(now = new Date()): Promise<void> {
  const snapshots = await allSnapshots();
  const remove = snapshots.filter((snapshot, index) => index >= MAX_SNAPSHOTS || new Date(snapshot.expiresAt).getTime() <= now.getTime());
  if (!remove.length) return;
  const database = await openDeviceDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(JOURNEY_STORE, "readwrite");
    for (const snapshot of remove) transaction.objectStore(JOURNEY_STORE).delete(snapshot.id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function saveJourneySnapshot(plan: JourneyPlanView, selectedJourneyId?: string): Promise<CachedJourneySnapshot> {
  const cachedAt = new Date();
  const snapshot: CachedJourneySnapshot = {
    id: `${cachedAt.getTime()}-${plan.scenario.id}`,
    plan: structuredClone(plan),
    selectedJourneyId,
    cachedAt: cachedAt.toISOString(),
    expiresAt: new Date(cachedAt.getTime() + RETENTION_MS).toISOString(),
  };
  const database = await openDeviceDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(JOURNEY_STORE, "readwrite");
    transaction.objectStore(JOURNEY_STORE).put(snapshot);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
  await writeSetting(ACTIVE_SNAPSHOT_KEY, snapshot.id);
  await pruneJourneySnapshots(cachedAt);
  return snapshot;
}

export async function loadLatestJourneySnapshot(): Promise<CachedJourneySnapshot | undefined> {
  await pruneJourneySnapshots();
  const activeId = await readSetting<string>(ACTIVE_SNAPSHOT_KEY);
  const snapshots = await allSnapshots();
  return snapshots.find((snapshot) => snapshot.id === activeId) ?? snapshots[0];
}

export async function updateSelectedJourney(snapshot: CachedJourneySnapshot, selectedJourneyId: string): Promise<CachedJourneySnapshot> {
  const updated = { ...snapshot, selectedJourneyId };
  const database = await openDeviceDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(JOURNEY_STORE, "readwrite");
    transaction.objectStore(JOURNEY_STORE).put(updated);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
  await writeSetting(ACTIVE_SNAPSHOT_KEY, snapshot.id);
  return updated;
}

export function consumeLegacyActiveJourney(): string | undefined {
  try {
    const value = localStorage.getItem(LEGACY_ACTIVE_KEY) ?? undefined;
    localStorage.removeItem(LEGACY_ACTIVE_KEY);
    return value;
  } catch {
    return undefined;
  }
}

export const setPendingServerDeletion = (pending: boolean) => writeSetting(PENDING_SERVER_DELETE_KEY, pending);
export const hasPendingServerDeletion = async () => (await readSetting<boolean>(PENDING_SERVER_DELETE_KEY)) === true;
