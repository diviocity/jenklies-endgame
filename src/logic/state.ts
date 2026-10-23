import { SCHEMA_VERSION } from '../config';
import type { AppState, Change, Meta, StoreName, StoreRecords } from '../types';
import { STORE_NAMES } from '../types';
import { DEFAULT_DEADLINES } from './time';
import { startingAffirmations, startingIndulgences, startingTemplate } from './seed';

export function emptyState(): AppState {
  const state = {} as Record<StoreName, Map<string, unknown>>;
  for (const name of STORE_NAMES) state[name] = new Map();
  return state as AppState;
}

export function put<K extends StoreName>(store: K, value: StoreRecords[K]): Change {
  return { store, op: 'put', value } as Change;
}

export function del(store: StoreName, id: string): Change {
  return { store, op: 'delete', id } as Change;
}

/** Applies changes to the in-memory state (after they have been saved). */
export function applyChanges(state: AppState, changes: Change[]): void {
  for (const c of changes) {
    const map = state[c.store] as Map<string, unknown>;
    if (c.op === 'put') map.set(c.value.id, c.value);
    else map.delete(c.id);
  }
}

export function getMeta(state: AppState): Meta {
  const meta = state.meta.get('meta');
  if (!meta) throw new Error('App data is not loaded.');
  return meta;
}

export function defaultMeta(now: string): Meta {
  return {
    id: 'meta',
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    settings: {
      deadlines: { ...DEFAULT_DEADLINES },
      soundOn: true,
      soundIgnoresSilent: false,
      sparksName: 'Sparks',
      shardsName: 'Shards',
    },
    pity5: 0,
    pity4: 0,
    lastBackupAt: null,
  };
}

/** Everything a brand-new install starts with. */
export function seedChanges(now: string): Change[] {
  return [
    put('meta', defaultMeta(now)),
    ...startingTemplate().map((t) => put('templateTasks', t)),
    ...startingAffirmations(now).map((a) => put('affirmations', a)),
    ...startingIndulgences(now).map((i) => put('indulgences', i)),
  ];
}

export function sortByOrder<T extends { order: number }>(items: Iterable<T>): T[] {
  return [...items].sort((a, b) => a.order - b.order);
}

export function sortByTime<T extends { at: string }>(items: Iterable<T>, newestFirst = true): T[] {
  const sorted = [...items].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return newestFirst ? sorted.reverse() : sorted;
}
