import { describe, expect, it } from 'vitest';
import { FITNESS, SCHEMA_VERSION } from '../src/config';
import { balances, completeTask, ensureDay, inventory, today, undoTask, type ActionResult } from '../src/logic/actions';
import { ensureEvent, frontier, logActivity, weeklyReward } from '../src/logic/event';
import {
  expeditionStatus,
  gateCap,
  MAP_LENGTH,
  MAP_NODES,
  markReportsSeen,
  REGIONS,
  setActiveTitle,
  settleExpedition,
  unseenReports,
  useSelector,
} from '../src/logic/expedition';
import { migrate } from '../src/logic/migrate';
import { applyChanges, emptyState, getMeta, put, seedChanges } from '../src/logic/state';
import type { AppState, FitnessType } from '../src/types';

// Monday, Oct 19, 2026 at 9 AM; week n starts n weeks later.
const weekStart = (n: number, hour = 9) => new Date(2026, 9, 19 + 7 * n, hour);

function tick(state: AppState, now: Date) {
  applyChanges(state, ensureDay(state, now));
  applyChanges(state, ensureEvent(state, now));
  return settle(state, now);
}

function settle(state: AppState, now: Date) {
  const { changes, claimed } = settleExpedition(state, now);
  applyChanges(state, changes);
  return claimed;
}

function setup(): AppState {
  const state = emptyState();
  applyChanges(state, seedChanges(weekStart(0).toISOString()));
  tick(state, weekStart(0));
  return state;
}

function run<T>(state: AppState, result: ActionResult<T>): T {
  applyChanges(state, result.changes);
  return result.result;
}

/** Logs a session, then settles the map as the app does after every action. */
function log(state: AppState, type: FitnessType, now: Date, n = 1) {
  for (let i = 0; i < n; i++) {
    run(state, logActivity(state, { type, note: '' }, new Date(now.getTime() + i * 60_000)));
    settle(state, now);
  }
}

/** One full target week (3 CrossFit, 3 PT, 7 activities = 520 points). */
function targetWeek(state: AppState, n: number) {
  const day = weekStart(n, 10);
  log(state, 'crossfit', day, 3);
  log(state, 'pt', day, 3);
  log(state, 'activity', day, 7);
}

const position = (state: AppState) => frontier(state)!.mapProgress ?? 0;

describe('the route', () => {
  it('has five regions totalling 13,500 points', () => {
    expect(REGIONS.map((r) => [r.name, r.minRank, r.end])).toEqual([
      ['Outskirts', 1, 1500],
      ['Badlands', 5, 3100],
      ['Deep Frontier', 10, 5700],
      ['The Wall', 15, 9900],
      ['Endgame', 20, 13500],
    ]);
    expect(MAP_LENGTH).toBe(13_500);
  });

  it('has about 50 nodes, about 260 points apart, ending each region', () => {
    expect(MAP_NODES).toHaveLength(52);
    for (const region of REGIONS) expect(MAP_NODES.some((n) => n.at === region.end && n.selector)).toBe(true);
    const gaps = MAP_NODES.map((n, i) => n.at - (MAP_NODES[i - 1]?.at ?? 0));
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(250);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(267);
  });

  it('pays 250 Sparks per node, 1,000 + 5 Shards per Cache (every 4th), selectors and titles at region ends', () => {
    const kinds = MAP_NODES.map((n) => n.kind);
    expect(kinds.filter((k) => k === 'cache')).toHaveLength(11);
    expect(MAP_NODES[3]).toMatchObject({ index: 4, kind: 'cache', sparks: 1000, shards: 5 });
    expect(MAP_NODES[0]).toMatchObject({ kind: 'node', sparks: 250, shards: 0 });
    const ends = MAP_NODES.filter((n) => n.selector);
    expect(ends.map((n) => [n.selector, n.title, n.sparks])).toEqual([
      [4, 'Outskirts Scout', 0],
      [4, 'Badlands Ranger', 0],
      [5, 'Frontier Pathfinder', 0],
      [5, 'Wallbreaker', 0],
      [5, null, 0],
    ]);
    expect(MAP_NODES[51]).toMatchObject({ kind: 'final', theme: 'endgame' });
  });

  it('gates block at the start of the first region above your rank', () => {
    expect(gateCap(1)).toBe(1500);
    expect(gateCap(4)).toBe(1500);
    expect(gateCap(5)).toBe(3100);
    expect(gateCap(14)).toBe(5700);
    expect(gateCap(19)).toBe(9900);
    expect(gateCap(20)).toBe(13500);
  });
});

describe('moving along the map', () => {
  it('moves live as points come in and pays each node once', () => {
    const state = setup();
    log(state, 'crossfit', weekStart(0, 10), 2);
    expect(position(state)).toBe(200);
    log(state, 'pt', weekStart(0, 11));
    expect(position(state)).toBe(250);
    expect(balances(state).sparks).toBe(250); // node 1 at 250
  });

  it('banks points at a closed gate and catches up when rank allows', () => {
    const state = setup();
    for (let i = 0; i < 18; i++) log(state, 'crossfit', weekStart(0, 10), 1); // 1,800 points
    expect(position(state)).toBe(1500); // Badlands needs Rank 5
    expect(expeditionStatus(state)).toMatchObject({ banked: 300, gate: { name: 'Badlands' } });
    // Rank 5 at the next reset releases the banked points.
    applyChanges(state, [put('events', { ...frontier(state)!, rp: 1170, rank: 5 })]);
    settle(state, weekStart(0, 12));
    expect(position(state)).toBe(1800);
  });

  it('never moves back: a rank drop or an undo takes nothing away, and redoing does not pay twice', () => {
    const state = setup();
    const tuesday = new Date(2026, 9, 20, 7);
    tick(state, tuesday);
    log(state, 'pt', tuesday, 4); // 200
    const crossfit = today(state, tuesday)!.tasks.find((t) => t.name === 'CrossFit')!;
    run(state, completeTask(state, crossfit.id, tuesday));
    settle(state, tuesday);
    expect(position(state)).toBe(300);
    const sparks = balances(state).sparks;
    run(state, undoTask(state, crossfit.id, tuesday));
    settle(state, tuesday);
    expect(position(state)).toBe(300);
    run(state, completeTask(state, crossfit.id, tuesday));
    expect(settle(state, tuesday)).toEqual([]);
    expect(position(state)).toBe(300);
    expect(balances(state).sparks).toBe(sparks);
  });

  it('at target pace, regions finish around weeks 3, 6, 11, 20 and 26', () => {
    const state = setup();
    const doneWeek: number[] = [];
    for (let n = 0; n < 30; n++) {
      tick(state, weekStart(n));
      targetWeek(state, n);
      for (const region of REGIONS) {
        if (doneWeek[region.index] === undefined && position(state) >= region.end) doneWeek[region.index] = n + 1;
      }
    }
    expect(doneWeek).toEqual([3, 6, 11, 20, 26]);
    const record = frontier(state)!.completion!;
    expect(record).toMatchObject({ peakRank: 20, weeks: 26 });
    // It finishes partway through week 26, so the record counts the sessions up to that point.
    expect(record.sessions).toBeGreaterThan(25 * 13);
    expect(record.sessions).toBeLessThanOrEqual(26 * 13);
  });

  it('map plus weekly rewards come to roughly 2,000–2,500 Sparks a week at target pace', () => {
    const state = setup();
    for (let n = 0; n < 26; n++) {
      tick(state, weekStart(n));
      targetWeek(state, n);
    }
    tick(state, weekStart(26));
    const perWeek = balances(state).sparks / 26;
    expect(perWeek).toBeGreaterThan(2000);
    expect(perWeek).toBeLessThan(2500);
  });
});

describe('rewards', () => {
  it('region ends give a selector and a title, and the newest title is shown', () => {
    const state = setup();
    for (let i = 0; i < 15; i++) log(state, 'crossfit', weekStart(0, 10));
    expect([...state.selectors.values()]).toMatchObject([{ rarity: 4, usedAt: null, source: 'Outskirts cleared' }]);
    expect(frontier(state)).toMatchObject({ titles: ['Outskirts Scout'], activeTitle: 'Outskirts Scout' });
    run(state, setActiveTitle(state, null));
    expect(frontier(state)!.activeTitle).toBeNull();
    expect(() => setActiveTitle(state, 'Wallbreaker')).toThrow(/not earned/);
  });

  it('a selector puts the chosen indulgence in the Bag', () => {
    const state = setup();
    for (let i = 0; i < 15; i++) log(state, 'crossfit', weekStart(0, 10));
    const [selector] = state.selectors.values();
    const five = [...state.indulgences.values()].find((i) => i.rarity === 5)!;
    const four = [...state.indulgences.values()].find((i) => i.rarity === 4)!;
    expect(() => useSelector(state, selector.id, five.id, weekStart(0, 11))).toThrow(/4★/);
    expect(run(state, useSelector(state, selector.id, four.id, weekStart(0, 11)))).toEqual({ name: four.name });
    expect(inventory(state).get(four.id)).toBe(1);
    expect(() => useSelector(state, selector.id, four.id, weekStart(0, 12))).toThrow(/already/);
  });

  it('weekly rewards: 50% → 500 + 2, 100% → 1,500 + 5, Rank 20 → +5 Shards', () => {
    expect(weeklyReward(259, 520, 3)).toEqual({ sparks: 0, shards: 0 });
    expect(weeklyReward(260, 520, 3)).toEqual({ sparks: 500, shards: 2 });
    expect(weeklyReward(520, 520, 3)).toEqual({ sparks: 1500, shards: 5 });
    expect(weeklyReward(0, 520, 20)).toEqual({ sparks: 0, shards: 5 });
    expect(weeklyReward(600, 520, 20)).toEqual({ sparks: 1500, shards: 10 });
  });

  it('pays the weekly reward at the reset and records it on the week', () => {
    const state = setup();
    log(state, 'crossfit', weekStart(0, 10), 3); // 300 of 520
    tick(state, weekStart(1));
    const [week] = state.eventWeeks.values();
    expect(week).toMatchObject({ rewardSparks: 500, rewardShards: 2, mapAtClose: 300 });
    expect(balances(state)).toEqual({ sparks: 250 + 500, shards: 2 });
  });
});

describe('weekly report', () => {
  it('lists unseen weeks with their map progress, until marked seen', () => {
    const state = setup();
    targetWeek(state, 0);
    tick(state, weekStart(1));
    targetWeek(state, 1);
    tick(state, weekStart(2));
    const reports = unseenReports(state);
    expect(reports.map((r) => [r.week.id, r.mapFrom, r.mapTo, r.nodes.length])).toEqual([
      ['2026-10-19', 0, 520, 2],
      ['2026-10-26', 520, 1040, 2],
    ]);
    run(state, markReportsSeen(state));
    expect(unseenReports(state)).toEqual([]);
  });
});

describe('upgrading saved data', () => {
  it('pays weekly rewards for weeks closed before version 3, and the map catches up', () => {
    const state = setup();
    log(state, 'crossfit', weekStart(0, 10), 6); // 600 points
    tick(state, weekStart(1));
    // Make it look like phase 1 data: no rewards, no map, version 2.
    const [week] = state.eventWeeks.values();
    const { rewardSparks: _s, rewardShards: _h, mapAtClose: _m, ...bare } = week;
    const { mapProgress: _p, titles: _t, activeTitle: _a, themes: _th, completion: _c, ...event } = frontier(state)!;
    state.ledger.clear();
    applyChanges(state, [
      put('eventWeeks', bare),
      put('events', event),
      put('meta', { ...getMeta(state), schemaVersion: 2, settings: { ...getMeta(state).settings, fitnessTarget: { ...FITNESS.defaultTarget } } }),
    ]);
    applyChanges(state, migrate(state, weekStart(1, 10)));
    expect(getMeta(state).schemaVersion).toBe(SCHEMA_VERSION);
    expect(balances(state)).toEqual({ sparks: 1500, shards: 5 });
    settle(state, weekStart(1, 10));
    expect(position(state)).toBe(600);
    expect(balances(state).sparks).toBe(1500 + 500); // nodes at 250 and 500
    expect(migrate(state, weekStart(1, 11))).toEqual([]);
  });
});
