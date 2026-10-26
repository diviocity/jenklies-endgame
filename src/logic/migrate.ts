import { FITNESS, SCHEMA_VERSION } from '../config';
import type { AppState, Change } from '../types';
import { payWeek, taskFitnessEntry } from './event';
import { fitnessTagFor } from './seed';
import { getMeta, put } from './state';
import { dayKeyOf } from './time';

/**
 * Upgrades saved data to the current version. Runs on every app start and on import,
 * and returns nothing when the data is already current.
 */
export function migrate(state: AppState, now: Date): Change[] {
  const meta = getMeta(state);
  if (meta.schemaVersion >= SCHEMA_VERSION) return [];
  const changes: Change[] = [];

  if (meta.schemaVersion < 2) changes.push(...toVersion2(state, now));
  if (meta.schemaVersion < 3) changes.push(...toVersion3(state, now));
  // Version 4 adds the Salvage Exchange. Its stores start empty, so there's nothing to convert.

  changes.push(
    put('meta', {
      ...meta,
      schemaVersion: SCHEMA_VERSION,
      settings: { ...meta.settings, fitnessTarget: meta.settings.fitnessTarget ?? { ...FITNESS.defaultTarget } },
    }),
  );
  return changes;
}

/**
 * Version 2 adds the Frontier Expedition: tag the CrossFit, Shoulder PT and Dog walk template
 * tasks, tag them in today's snapshot too, and log fitness for any of them already done today.
 */
function toVersion2(state: AppState, now: Date): Change[] {
  const changes: Change[] = [];
  const tags = new Map<string, NonNullable<ReturnType<typeof fitnessTagFor>>>();
  for (const task of state.templateTasks.values()) {
    const tag = task.fitness ?? fitnessTagFor(task.name);
    if (!tag) continue;
    tags.set(task.id, tag);
    if (task.fitness !== tag) changes.push(put('templateTasks', { ...task, fitness: tag }));
  }

  const today = state.days.get(dayKeyOf(now));
  if (today) {
    let changed = false;
    const tasks = today.tasks.map((t) => {
      const tag = t.templateTaskId ? tags.get(t.templateTaskId) : undefined;
      if (!tag || t.fitness) return t;
      changed = true;
      return { ...t, fitness: tag };
    });
    if (changed) {
      const day = { ...today, tasks };
      changes.push(put('days', day));
      for (const t of tasks) {
        if (!t.completedAt || !t.fitness) continue;
        if ([...state.fitness.values()].some((e) => e.taskId === t.id)) continue;
        const entry = taskFitnessEntry(day, t, t.completedAt);
        if (entry) changes.push(put('fitness', entry));
      }
    }
  }
  return changes;
}

/**
 * Version 3 adds the expedition map and weekly rewards. Weeks closed before then get their
 * weekly reward now; the map catches up on its own the next time it settles.
 */
function toVersion3(state: AppState, now: Date): Change[] {
  return [...state.eventWeeks.values()].filter((w) => w.rewardSparks === undefined).flatMap((w) => payWeek(w, now));
}
