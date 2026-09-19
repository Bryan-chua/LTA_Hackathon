export const DEVICE_DATABASE = "smart-commute";
export const SETTINGS_STORE = "settings";
export const JOURNEY_STORE = "journeySnapshots";
export const DEVICE_DATABASE_VERSION = 2;

export function openDeviceDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DEVICE_DATABASE, DEVICE_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SETTINGS_STORE)) database.createObjectStore(SETTINGS_STORE);
      if (!database.objectStoreNames.contains(JOURNEY_STORE)) {
        const store = database.createObjectStore(JOURNEY_STORE, { keyPath: "id" });
        store.createIndex("cachedAt", "cachedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open device storage."));
  });
}

export async function readSetting<T>(key: string): Promise<T | undefined> {
  const database = await openDeviceDatabase();
  return new Promise((resolve) => {
    const transaction = database.transaction(SETTINGS_STORE, "readonly");
    const request = transaction.objectStore(SETTINGS_STORE).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => resolve(undefined);
    transaction.oncomplete = () => database.close();
  });
}

export async function writeSetting<T>(key: string, value: T): Promise<void> {
  const database = await openDeviceDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(SETTINGS_STORE, "readwrite");
    transaction.objectStore(SETTINGS_STORE).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function deleteSetting(key: string): Promise<void> {
  const database = await openDeviceDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(SETTINGS_STORE, "readwrite");
    transaction.objectStore(SETTINGS_STORE).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function clearDeviceDatabase(): Promise<void> {
  const database = await openDeviceDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([SETTINGS_STORE, JOURNEY_STORE], "readwrite");
    transaction.objectStore(SETTINGS_STORE).clear();
    transaction.objectStore(JOURNEY_STORE).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}
