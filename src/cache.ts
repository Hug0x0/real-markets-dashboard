import type { Dataset } from "./types";

/**
 * Persists the last live dataset in IndexedDB so a reload only fetches trades since the previous visit.
 * Every call is best-effort: private windows, blocked storage or quota errors simply mean no cache.
 */
const DB_NAME = "real-markets-dashboard";
const STORE = "datasets";
const VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = action(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function readCache(key: string): Promise<Dataset | null> {
  try {
    const value = (await run("readonly", (store) => store.get(key))) as Dataset | undefined;
    return value?.source === "live" && Array.isArray(value.trades) ? value : null;
  } catch {
    return null;
  }
}

export async function writeCache(key: string, dataset: Dataset): Promise<void> {
  if (dataset.source !== "live") return;
  try {
    await run("readwrite", (store) => store.put(dataset, key));
  } catch {
    // Storage unavailable or full: the next load just fetches the whole window.
  }
}
