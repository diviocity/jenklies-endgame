import { describe, expect, it } from 'vitest';
import { FITNESS, SCHEMA_VERSION } from '../src/config';
import { completeTask, ensureDay, today, undoTask, type ActionResult } from '../src/logic/actions';
import { buildBackup, parseBackup, restoredData } from '../src/logic/backup';
import {
  ensureEvent,
  entriesForWeek,
  eventHistory,
  frontier,
  logActivity,
  rankStatus,
  undoActivity,
} from '../src/logic/event';
import { migrate } from '../src/logic/migrate';
import { applyChanges, emptyState, getMeta, put, seedChanges } from '../src/logic/state';
import type { AppState, FitnessType } from '../src/types';

// Tuesday, Oct 20, 2026; its week starts Monday Oct 19.
const at = (h: number, m = 0, day = 20) => new Date(2026, 9, day, h, m);
const WEEK = '2026-10-19';

function tick(state: AppState, now: Date) {
  applyChanges(state, ensureDay(state, now));
  applyChanges(state, ensureEvent(state, now));
}

function setup(now = at(7)): AppState {
  const state = emptyState();
  applyChanges(state, seedChanges(now.toISOString()));
  tick(state, now);
  return state;
}

function run<T>(state: AppState, result: ActionResult<T>): T {
  applyChanges(state, result.changes);
  return result.result;
}

const taskNamed = (state: AppState, name: string, now = at(7)) => today(state, now)!.tasks.find((t) => t.name === name)!;

function log(state: AppState, type: FitnessType, now: Date, n = 1) {
  for (let i = 0; i < n; i++) run(state, logActivity(state, { type, note: '' }, new Date(now.getTime() + i * 60_000)));
}

describe('fitness tagging', () => {
  it('the starting template tags CrossFit, Shoulder PT and Dog walk', () => {
    const state = setup();
    const tagged = [...state.templateTasks.values()].filter((t) => t.fitness).map((t) => `${t.name}:${t.fitness}`);
    expect(new Set(tagged)).toEqual(new Set(['Shoulder PT:pt', 'CrossFit:crossfit', 'Dog walk:activity']));
    expect(taskNamed(state, 'CrossFit').fitness).toBe('crossfit');
    expect(taskNamed(state, 'Shower').fitness).toBeNull();
  });

  it('checking off a tagged task logs fitness, and undo removes it', () => {
    const state = setup();
    const id = taskNamed(state, 'CrossFit').id;
    expect(run(state, completeTask(state, id, at(8))).fitness).toBe(100);
    expect(entriesForWeek(state, WEEK)).toHaveLength(1);
    expect(entriesForWeek(state, WEEK)[0]).toMatchObject({ type: 'crossfit', source: 'task', points: 100 });
    run(state, undoTask(state, id, at(9)));
    expect(entriesForWeek(state, WEEK)).toHaveLength(0);
  });

  it('activities past 7 a week log but earn nothing', () => {
    const state = setup();
    log(state, 'activity', at(6, 10), 7);
    expect(rankStatus(state, at(8))!.weekPoints).toBe(70);
    expect(run(state, completeTask(state, taskNamed(state, 'Dog walk').id, at(12))).fitness).toBe(0);
    expect(rankStatus(state, at(12))!.weekPoints).toBe(70);
  });
});

describe('logging activity', () => {
  it('logs points and can be undone the same day', () => {
    const state = setup();
    expect(run(state, logActivity(state, { type: 'workout', note: 'Hike' }, at(10)))).toEqual({ points: 75 });
    const entry = entriesForWeek(state, WEEK)[0];
    expect(entry).toMatchObject({ note: 'Hike', source: 'manual', dayKey: '2026-10-20' });
    run(state, undoActivity(state, entry.id, at(11)));
    expect(entriesForWeek(state, WEEK)).toHaveLength(0);
  });

  it("can't undo another day's entry, or a task's entry", () => {
    const state = setup();
    run(state, logActivity(state, { type: 'workout', note: '' }, at(10)));
    const manual = entriesForWeek(state, WEEK)[0];
    expect(() => undoActivity(state, manual.id, at(10, 0, 21))).toThrow(/today/);
    run(state, completeTask(state, taskNamed(state, 'CrossFit').id, at(8)));
    const fromTask = entriesForWeek(state, WEEK).find((e) => e.source === 'task')!;
    expect(() => undoActivity(state, fromTask.id, at(10))).toThrow(/Today/);
  });
});

describe('weekly reset', () => {
  it('starts the event in the current week at Rank 1', () => {
    const state = setup();
    expect(frontier(state)).toMatchObject({ startedWeek: WEEK, currentWeek: WEEK, rp: 0, rank: 1 });
  });

  it('closes the week at Monday 4 AM, not before', () => {
    const state = setup();
    log(state, 'crossfit', at(10), 3);
    log(state, 'pt', at(11), 3);
    log(state, 'activity', at(12), 7);
    tick(state, at(3, 59, 26)); // still Sunday's game day
    expect(eventHistory(state)).toHaveLength(0);
    tick(state, at(4, 0, 26));
    const [week] = eventHistory(state);
    expect(week).toMatchObject({ id: WEEK, points: 520, rankBefore: 1, rankAfter: 2, weak: false, seen: false });
    expect(frontier(state)).toMatchObject({ currentWeek: '2026-10-26', rp: 520, rank: 2 });
  });

  it('catches up on weeks the app was not opened, as zero-point weeks', () => {
    const state = setup();
    for (let i = 0; i < 6; i++) log(state, 'crossfit', at(10 + i), 1);
    log(state, 'pt', at(17), 3);
    log(state, 'activity', at(18), 4); // 750 points this week
    tick(state, new Date(2026, 10, 16, 9)); // Monday Nov 16: four resets due
    const weeks = eventHistory(state);
    expect(weeks.map((w) => w.id)).toEqual(['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09']);
    expect(weeks.map((w) => w.points)).toEqual([790, 0, 0, 0]);
    expect(weeks.map((w) => w.decay)).toEqual([0.1, 0.1, 0.15, 0.25]);
    expect(frontier(state)).toMatchObject({ weakStreak: 3, currentWeek: '2026-11-16' });
  });

  it('shows the points needed to hold and to rank up', () => {
    const state = setup();
    // RP 2,436 (six target weeks in): Rank 10.
    applyChanges(state, [put('events', { ...frontier(state)!, rp: 2436, rank: 10 })]);
    const status = rankStatus(state, at(9))!;
    expect(status).toMatchObject({ rank: 10, weekPoints: 0, toHold: 148, toNext: 382 });
    log(state, 'crossfit', at(10));
    expect(rankStatus(state, at(11))).toMatchObject({ weekPoints: 100, toHold: 48, toNext: 282 });
  });

  it('a lower target rescales rank straight away', () => {
    const state = setup();
    applyChanges(state, [put('events', { ...frontier(state)!, rp: 3330, rank: 14 })]);
    const meta = getMeta(state);
    applyChanges(state, [
      put('meta', { ...meta, settings: { ...meta.settings, fitnessTarget: { ...FITNESS.defaultTarget, pt: 0 } } }),
    ]);
    expect(rankStatus(state, at(9))!.rank).toBe(20);
  });
});

/** A version-1 state: no fitness tags, no event, CrossFit already done today. */
function versionOne(): AppState {
  const state = setup();
  const meta = getMeta(state);
  const { fitnessTarget: _, ...settings } = meta.settings;
  const day = today(state, at(7))!;
  applyChanges(state, [
    put('meta', { ...meta, schemaVersion: 1, settings }),
    ...[...state.templateTasks.values()].map((t) => {
      const { fitness: _f, ...rest } = t;
      return put('templateTasks', rest);
    }),
    put('days', {
      ...day,
      tasks: day.tasks.map(({ fitness: _f, ...t }) =>
        t.name === 'CrossFit' ? { ...t, completedAt: at(6, 30).toISOString(), onTime: true } : t,
      ),
    }),
  ]);
  for (const name of ['fitness', 'events', 'eventWeeks', 'selectors'] as const) state[name].clear();
  return state;
}

describe('upgrading saved data', () => {
  it('tags tasks, tags today, and counts fitness already done today', () => {
    const state = versionOne();
    const changes = migrate(state, at(8));
    applyChanges(state, changes);
    expect(getMeta(state)).toMatchObject({ schemaVersion: SCHEMA_VERSION, settings: { fitnessTarget: FITNESS.defaultTarget } });
    expect([...state.templateTasks.values()].filter((t) => t.fitness)).toHaveLength(4); // Dog walk is in two buckets
    expect(taskNamed(state, 'CrossFit').fitness).toBe('crossfit');
    expect(entriesForWeek(state, WEEK)).toMatchObject([{ type: 'crossfit', source: 'task', points: 100 }]);
    // Running it again changes nothing.
    expect(migrate(state, at(9))).toEqual([]);
  });

  it('restores a version-1 backup (without the new stores) and upgrades it', () => {
    const old = versionOne();
    const file = buildBackup(old, at(8)) as unknown as { schemaVersion: number; data: Record<string, unknown> };
    file.schemaVersion = 1;
    for (const name of ['fitness', 'events', 'eventWeeks', 'selectors']) delete file.data[name];
    const parsed = parseBackup(JSON.stringify(file));
    const data = restoredData(parsed, at(9));
    expect(data.meta[0].schemaVersion).toBe(SCHEMA_VERSION);
    expect(data.templateTasks.filter((t) => t.fitness)).toHaveLength(4);
    expect(data.fitness).toHaveLength(1);
  });

  it('exports and restores event data', () => {
    const state = setup();
    log(state, 'workout', at(10));
    tick(state, at(5, 0, 26));
    const data = restoredData(parseBackup(JSON.stringify(buildBackup(state, at(6, 0, 26)))), at(6, 0, 26));
    expect(data.fitness).toHaveLength(1);
    expect(data.events).toHaveLength(1);
    expect(data.eventWeeks).toHaveLength(1);
  });
});
