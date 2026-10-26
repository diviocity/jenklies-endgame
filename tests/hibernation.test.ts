import { describe, expect, it } from 'vitest';
import { WEEKLY_REWARDS } from '../src/config';
import { balances, completeTask, ensureDay, today } from '../src/logic/actions';
import { activeSlots, ageTag, ensureDepot, listItem, listingReward, markPhotographed, saveSaleItem } from '../src/logic/depot';
import type { ActionResult } from '../src/logic/errors';
import { ensureEvent, frontier, logActivity, rankStatus } from '../src/logic/event';
import { settleExpedition } from '../src/logic/expedition';
import {
  activeDayFraction,
  activeDaysBetween,
  cancelHibernation,
  hibernatedDaysInWeek,
  isHibernatedDay,
  isHibernating,
  scheduleHibernation,
  startHibernation,
  wakeUp,
} from '../src/logic/hibernation';
import { weekStep } from '../src/logic/rank';
import { applyChanges, emptyState, put, seedChanges } from '../src/logic/state';
import type { AppState } from '../src/types';

// November 2026. Monday Nov 2 starts a week; Nov 9 and Nov 16 are the next Mondays.
const at = (day: number, h = 12, m = 0) => new Date(2026, 10, day, h, m);

function tick(state: AppState, now: Date) {
  applyChanges(state, ensureDay(state, now));
  applyChanges(state, ensureEvent(state, now));
  applyChanges(state, ensureDepot(state, now));
}

function setup(now = at(2, 9)): AppState {
  const state = emptyState();
  applyChanges(state, seedChanges(now.toISOString()));
  tick(state, now);
  return state;
}

function run<T>(state: AppState, result: ActionResult<T>): T {
  applyChanges(state, result.changes);
  return result.result;
}

describe('starting, scheduling and ending', () => {
  it('starts now, counts today as hibernated, and wakes up', () => {
    const state = setup();
    run(state, startHibernation(state, null, at(2, 15)));
    expect(isHibernating(state, at(2, 16))).toBe(true);
    expect(isHibernatedDay(state, '2026-11-02', at(2, 16))).toBe(true);
    run(state, wakeUp(state, at(4, 10)));
    expect(isHibernating(state, at(4, 11))).toBe(false);
    // Nov 2, 3 and 4 were each hibernated at some point; Nov 5 wasn't.
    expect(hibernatedDaysInWeek(state, '2026-11-02', at(6))).toBe(3);
    expect(isHibernatedDay(state, '2026-11-05', at(6))).toBe(false);
  });

  it('a scheduled period starts at 4 AM on its first day and ends at 4 AM after its last', () => {
    const state = setup();
    run(state, scheduleHibernation(state, '2026-11-07', '2026-11-08', at(4)));
    expect(isHibernating(state, at(7, 3, 59))).toBe(false); // still Friday's game day
    expect(isHibernating(state, at(7, 4, 0))).toBe(true);
    expect(isHibernating(state, at(9, 3, 59))).toBe(true);
    expect(isHibernating(state, at(9, 4, 0))).toBe(false);
    expect(hibernatedDaysInWeek(state, '2026-11-02', at(10))).toBe(2);
    expect(activeDayFraction(state, '2026-11-02', at(10))).toBeCloseTo(5 / 7);
  });

  it('has no backdating: a schedule must start tomorrow or later', () => {
    const state = setup();
    expect(() => scheduleHibernation(state, '2026-11-02', null, at(2, 12))).toThrow('from tomorrow on');
    expect(() => scheduleHibernation(state, '2026-10-31', null, at(2, 12))).toThrow('from tomorrow on');
    expect(() => scheduleHibernation(state, '2026-11-05', '2026-11-04', at(2, 12))).toThrow('before the first');
  });

  it('allows one at a time; a scheduled one can be cancelled until it starts', () => {
    const state = setup();
    run(state, scheduleHibernation(state, '2026-11-07', null, at(2)));
    expect(() => startHibernation(state, null, at(3))).toThrow('already scheduled');
    const [h] = state.hibernations.values();
    run(state, cancelHibernation(state, h.id, at(3)));
    expect(state.hibernations.size).toBe(0);
    run(state, startHibernation(state, null, at(3)));
    const [started] = state.hibernations.values();
    expect(() => cancelHibernation(state, started.id, at(4))).toThrow('already started');
  });

  it('a "last day" given when starting now ends it at 4 AM the morning after', () => {
    const state = setup();
    run(state, startHibernation(state, '2026-11-04', at(2, 20)));
    expect(isHibernating(state, at(5, 3))).toBe(true);
    expect(isHibernating(state, at(5, 5))).toBe(false);
  });
});

describe('Frontier Expedition', () => {
  function withRp(rp: number, now = at(2, 9)) {
    const state = setup(now);
    const event = frontier(state)!;
    applyChanges(state, [put('events', { ...event, rp, rank: 10, peakRank: 10, weakStreak: 1 })]);
    return state;
  }
  const log = (state: AppState, type: 'crossfit' | 'pt' | 'activity', n: number, day: number) => {
    for (let i = 0; i < n; i++) run(state, logActivity(state, { type, note: '' }, at(day, 8, i)));
  };

  it('skips a week with 4+ hibernated days: no RP change, no decay, streak kept, nothing paid', () => {
    const state = withRp(2_000);
    log(state, 'crossfit', 1, 2);
    run(state, startHibernation(state, '2026-11-08', at(5, 8))); // Thu–Sun
    const before = balances(state);
    tick(state, at(9, 5));
    const week = state.eventWeeks.get('2026-11-02')!;
    expect(week).toMatchObject({ skipped: true, hibernatedDays: 4, rpAfter: 2_000, rewardSparks: 0, rewardShards: 0, weakStreak: 1 });
    expect(frontier(state)).toMatchObject({ rp: 2_000, rank: 10, weakStreak: 1, currentWeek: '2026-11-09' });
    expect(balances(state)).toEqual(before);
  });

  it('prorates a week with 1–3 hibernated days', () => {
    const state = withRp(2_000);
    // 3 hibernated days (Fri–Sun): active share 4/7.
    run(state, scheduleHibernation(state, '2026-11-06', '2026-11-08', at(2, 10)));
    // 120 points: below the full weak threshold (200) but above the prorated one (114.3).
    log(state, 'pt', 2, 3);
    log(state, 'activity', 2, 3);
    tick(state, at(9, 5));
    const week = state.eventWeeks.get('2026-11-02')!;
    const active = 4 / 7;
    expect(week.hibernatedDays).toBe(3);
    expect(week.weak).toBe(false);
    expect(week.decay).toBeCloseTo(0.1 * active);
    expect(week.rpAfter).toBeCloseTo(2_000 * (1 - 0.1 * active) + 120);
    expect(week.rpAfter).toBeCloseTo(weekStep(2_000, 1, 120, active).rp);
    // Reward thresholds scale too: 520 × 4/7 ≈ 297, so 120 points is under half (149) and pays nothing.
    expect(week.rewardSparks).toBe(0);
  });

  it('prorated weekly reward thresholds', () => {
    const state = withRp(2_000);
    run(state, scheduleHibernation(state, '2026-11-06', '2026-11-08', at(2, 10)));
    log(state, 'crossfit', 3, 3); // 300 ≥ 520 × 4/7 ≈ 297: the full reward
    tick(state, at(9, 5));
    expect(state.eventWeeks.get('2026-11-02')!.rewardSparks).toBe(WEEKLY_REWARDS.full.sparks);
  });

  it('the rank panel shows the prorated target, or a skipped week', () => {
    const state = withRp(2_000);
    run(state, scheduleHibernation(state, '2026-11-07', '2026-11-08', at(2, 10)));
    expect(rankStatus(state, at(3))).toMatchObject({ hibernatedDays: 2, skipped: false, target: Math.round(520 * (5 / 7)) });
    const other = withRp(2_000);
    run(other, startHibernation(other, null, at(4)));
    run(other, wakeUp(other, at(6, 10)));
    const skipped = rankStatus(other, at(4))!;
    expect(skipped).toMatchObject({ hibernatedDays: 3, skipped: false });
    // Open-ended hibernation counts days as they pass; with a last day set, the planned days count now.
    expect(skipped.hibernatedDays).toBe(3);
    const long = withRp(2_000);
    run(long, startHibernation(long, '2026-11-08', at(4)));
    const s = rankStatus(long, at(4))!;
    expect(s).toMatchObject({ hibernatedDays: 5, skipped: true, toHold: 0 });
    expect(s.projectedRank).toBe(s.rank);
  });
});

describe('no rewards while hibernating', () => {
  it('blocks tasks, fitness logging and Salvage stage changes, and pauses the map', () => {
    const state = setup();
    const item = run(state, saveSaleItem(state, { name: 'Lamp', notes: '', category: '' }, at(2, 10))).id;
    run(state, startHibernation(state, null, at(2, 11)));
    const task = today(state, at(2, 12))!.tasks[0];
    expect(() => completeTask(state, task.id, at(2, 12))).toThrow('hibernating');
    expect(() => logActivity(state, { type: 'crossfit', note: '' }, at(2, 12))).toThrow('hibernating');
    expect(() => markPhotographed(state, item, at(2, 12))).toThrow('hibernating');
    expect(() => listItem(state, item, ['eBay'], at(2, 12))).toThrow('hibernating');
    applyChanges(state, [put('fitness', { id: 'f', at: at(2, 8).toISOString(), dayKey: '2026-11-02', weekKey: '2026-11-02', type: 'crossfit', points: 500, source: 'manual', note: '' })]);
    expect(settleExpedition(state, at(2, 12)).changes).toEqual([]);
    run(state, wakeUp(state, at(2, 13)));
    expect(settleExpedition(state, at(2, 14)).changes.length).toBeGreaterThan(0);
    expect(() => completeTask(state, task.id, at(2, 14))).not.toThrow();
  });
});

describe('Salvage Exchange', () => {
  it('age tags count only active days', () => {
    const state = setup();
    run(state, saveSaleItem(state, { name: 'Lamp', notes: '', category: '' }, at(2, 10)));
    run(state, scheduleHibernation(state, '2026-11-05', '2026-11-11', at(2, 11))); // 7 days away
    const slot = activeSlots(state)[0];
    // Nov 16: 14 days later, but 7 were hibernated.
    expect(activeDaysBetween(state, '2026-11-02', '2026-11-16', at(16))).toBe(7);
    expect(ageTag(state, slot, at(16)).label).toBe('1 week');
    expect(ageTag(state, slot, at(13)).label).toBe('New');
  });

  it('the fresh window counts only active days', () => {
    const state = setup();
    run(state, saveSaleItem(state, { name: 'A', notes: '', category: '' }, at(2, 9)));
    run(state, saveSaleItem(state, { name: 'B', notes: '', category: '' }, at(2, 9)));
    const c = run(state, saveSaleItem(state, { name: 'C', notes: '', category: '' }, at(2, 9))).id;
    run(state, markPhotographed(state, c, at(2, 10)));
    run(state, scheduleHibernation(state, '2026-11-03', '2026-11-08', at(2, 11)));
    // Listed Nov 10: 8 days after the photo, but only 2 active days (Nov 9, 10).
    expect(listingReward(state, state.saleItems.get(c)!, at(10)).parts).toContain('fresh');
    expect(listingReward(state, state.saleItems.get(c)!, at(12)).parts).not.toContain('fresh');
  });

  it('a mostly hibernated week has no mission, and slots refill after waking', () => {
    const state = setup();
    const a = run(state, saveSaleItem(state, { name: 'A', notes: '', category: '' }, at(2, 9))).id;
    run(state, saveSaleItem(state, { name: 'B', notes: '', category: '' }, at(2, 9)));
    run(state, saveSaleItem(state, { name: 'C', notes: '', category: '' }, at(2, 9)));
    run(state, listItem(state, a, ['eBay'], at(2, 10)));
    run(state, startHibernation(state, null, at(4, 10))); // Wed onward
    const before = balances(state);
    tick(state, at(9, 5)); // reset while hibernating
    expect(state.depotWeeks.get('2026-11-02')).toMatchObject({ skipped: true, total: 0 });
    expect(balances(state)).toEqual(before);
    expect(activeSlots(state)).toHaveLength(1); // no refill while hibernating
    run(state, wakeUp(state, at(10, 9)));
    tick(state, at(10, 9, 1));
    expect(activeSlots(state)).toHaveLength(2);
  });

  it('a week with 1–3 hibernated days keeps its mission', () => {
    const state = setup();
    const a = run(state, saveSaleItem(state, { name: 'A', notes: '', category: '' }, at(2, 9))).id;
    run(state, listItem(state, a, ['eBay'], at(2, 10)));
    run(state, scheduleHibernation(state, '2026-11-07', '2026-11-08', at(2, 11)));
    tick(state, at(9, 5));
    expect(state.depotWeeks.get('2026-11-02')).toMatchObject({ completed: true, rewardSparks: 500 });
  });
});
