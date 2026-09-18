import type { Routine } from "../domain";
import { scenarios } from "../fixtures";

const DATABASE = "smart-commute";
const STORE = "settings";
const KEY = "routine-v1";

export const defaultRoutine = (): Routine => ({
  ...structuredClone(scenarios.normal.routine),
  timezone: "Asia/Singapore",
  materialDelayMinutes: 10,
});

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadRoutine(): Promise<Routine> {
  const database = await openDatabase();
  return new Promise((resolve) => {
    const transaction = database.transaction(STORE, "readonly");
    const request = transaction.objectStore(STORE).get(KEY);
    request.onsuccess = () => resolve((request.result as Routine | undefined) ?? defaultRoutine());
    request.onerror = () => resolve(defaultRoutine());
    transaction.oncomplete = () => database.close();
  });
}

export async function saveRoutine(routine: Routine): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(routine, KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function resetRoutine(): Promise<Routine> {
  const routine = defaultRoutine();
  await saveRoutine(routine);
  return routine;
}
