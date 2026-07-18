export interface StoredSnapshot { id: string; deckId: string; createdAt: number; html: string; revision: string; }
const DB_NAME = "slides-studio";
const STORE = "snapshots";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { const db = request.result; if (!db.objectStoreNames.contains(STORE)) { const store = db.createObjectStore(STORE, { keyPath: "id" }); store.createIndex("deckId", "deckId"); } };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveSnapshot(snapshot: StoredSnapshot, limit = 50): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => { const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).put(snapshot); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
  const all = await listSnapshots(snapshot.deckId);
  const stale = all.slice(limit);
  if (stale.length) await new Promise<void>((resolve, reject) => { const tx = db.transaction(STORE, "readwrite"); stale.forEach((item) => tx.objectStore(STORE).delete(item.id)); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
  db.close();
}

export async function listSnapshots(deckId: string): Promise<StoredSnapshot[]> {
  const db = await openDb();
  const result = await new Promise<StoredSnapshot[]>((resolve, reject) => { const tx = db.transaction(STORE); const request = tx.objectStore(STORE).index("deckId").getAll(deckId); request.onsuccess = () => resolve(request.result as StoredSnapshot[]); request.onerror = () => reject(request.error); });
  db.close();
  return result.toSorted((left, right) => right.createdAt - left.createdAt);
}

export const revisionFor = async (html: string): Promise<string> => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(html)))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
