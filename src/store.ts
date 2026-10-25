import { useEffect, useReducer } from 'preact/hooks';
import { commit, loadAll, replaceAll } from './db';
import { ActionError, ensureDay, type ActionResult } from './logic/actions';
import { restoredData, type BackupFile } from './logic/backup';
import { ensureEvent } from './logic/event';
import { settleExpedition, type MapNode } from './logic/expedition';
import { migrate } from './logic/migrate';
import { applyChanges, emptyState, seedChanges } from './logic/state';
import type { AppState } from './types';

let state: AppState = emptyState();
let ready = false;
let version = 0;
const listeners = new Set<() => void>();

function notify() {
  version++;
  for (const l of listeners) l();
}

export function getState(): AppState {
  return state;
}

export function isReady(): boolean {
  return ready;
}

/** Re-renders the calling component whenever app data changes. */
export function useStore(): AppState {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const renderedVersion = version;
  useEffect(() => {
    const rerender = () => bump(undefined);
    listeners.add(rerender);
    // Catch up on anything that changed between render and subscribing.
    if (version !== renderedVersion) rerender();
    return () => void listeners.delete(rerender);
  }, []);
  return state;
}

async function save(changes: ActionResult<unknown>['changes']) {
  await commit(changes);
  applyChanges(state, changes);
}

const claimListeners = new Set<(nodes: MapNode[]) => void>();

/** Hears about expedition nodes as they're reached (for toasts). */
export function onExpeditionClaims(listener: (nodes: MapNode[]) => void): () => void {
  claimListeners.add(listener);
  return () => void claimListeners.delete(listener);
}

/** Moves the expedition map forward if points or rank allow, claiming any nodes passed. */
async function settle(now: Date): Promise<boolean> {
  const { changes, claimed } = settleExpedition(state, now);
  if (!changes.length) return false;
  await save(changes);
  if (claimed.length) for (const l of claimListeners) l(claimed);
  return true;
}

/** Starts a new day's snapshot past 4 AM, runs the weekly event reset when one is due, and settles the map. */
export async function tick(now = new Date()): Promise<void> {
  const changes = [...ensureDay(state, now), ...ensureEvent(state, now)];
  if (changes.length) await save(changes);
  const settled = await settle(now);
  if (changes.length || settled) notify();
}

export async function init(): Promise<void> {
  state = await loadAll();
  if (!state.meta.has('meta')) {
    const changes = seedChanges(new Date().toISOString());
    await save(changes);
  } else {
    await save(migrate(state, new Date()));
  }
  ready = true;
  await tick();
  notify();
}

export type RunOutcome<T> = { ok: true; result: T } | { ok: false; error: string };

/**
 * Runs a game action against current data and saves what it changed.
 * Today's snapshot is always taken first, so template edits never touch today.
 */
export function run<T>(action: (s: AppState, now: Date) => ActionResult<T>): Promise<RunOutcome<T>> {
  // Actions run one at a time so a quick double tap can't act on stale data.
  const next = queue.then(() => runNow(action));
  queue = next.then(() => undefined);
  return next;
}

let queue: Promise<void> = Promise.resolve();

async function runNow<T>(action: (s: AppState, now: Date) => ActionResult<T>): Promise<RunOutcome<T>> {
  const now = new Date();
  try {
    await tick(now);
    const { changes, result } = action(state, now);
    await save(changes);
    await settle(now);
    notify();
    return { ok: true, result };
  } catch (e) {
    if (e instanceof ActionError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: `Something went wrong: ${(e as Error).message}` };
  }
}

export async function importBackup(file: BackupFile): Promise<void> {
  await replaceAll(restoredData(file, new Date()));
  state = await loadAll();
  await tick();
  notify();
}
