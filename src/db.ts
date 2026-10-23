import { openDB, type IDBPDatabase } from 'idb';
import type { AppState, Change, StoreName } from './types';
import { STORE_NAMES } from './types';
import type { BackupData } from './logic/backup';
import { emptyState } from './logic/state';

const DB_NAME = 'jenklies-endgame';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      for (const name of STORE_NAMES) {
        if (!database.objectStoreNames.contains(name)) database.createObjectStore(name, { keyPath: 'id' });
      }
    },
  });
  return dbPromise;
}

export async function loadAll(): Promise<AppState> {
  const database = await db();
  const state = emptyState();
  const tx = database.transaction(STORE_NAMES, 'readonly');
  await Promise.all(
    STORE_NAMES.map(async (name) => {
      const records = (await tx.objectStore(name).getAll()) as { id: string }[];
      const map = state[name] as Map<string, unknown>;
      for (const r of records) map.set(r.id, r);
    }),
  );
  await tx.done;
  return state;
}

/** Saves a set of changes in one transaction: all of them land, or none do. */
export async function commit(changes: Change[]): Promise<void> {
  if (changes.length === 0) return;
  const database = await db();
  const stores = [...new Set(changes.map((c) => c.store))] as StoreName[];
  const tx = database.transaction(stores, 'readwrite');
  for (const c of changes) {
    const store = tx.objectStore(c.store);
    if (c.op === 'put') void store.put(c.value);
    else void store.delete(c.id);
  }
  await tx.done;
}

/** Replaces everything with the contents of a backup, in one transaction. */
export async function replaceAll(data: BackupData): Promise<void> {
  const database = await db();
  const tx = database.transaction(STORE_NAMES, 'readwrite');
  for (const name of STORE_NAMES) {
    const store = tx.objectStore(name);
    void store.clear();
    for (const record of data[name]) void store.put(record);
  }
  await tx.done;
}
