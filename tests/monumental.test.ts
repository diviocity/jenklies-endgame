import { describe, expect, it } from 'vitest';
import { EVENTS } from '../src/config';
import { balances } from '../src/logic/actions';
import type { ActionResult } from '../src/logic/errors';
import { scheduleHibernation, startHibernation } from '../src/logic/hibernation';
import {
  addWindow,
  bossHp,
  cancelDayOff,
  climb,
  currentFight,
  defeatReward,
  deleteWindow,
  editWindow,
  endFocus,
  ensureMonumental,
  monumental,
  runningWindow,
  setDayOff,
  startFocus,
  weekReward,
  windowDamage,
} from '../src/logic/monumental';
import { applyChanges, emptyState, seedChanges } from '../src/logic/state';
import type { AppState, FocusWindow } from '../src/types';

// Wed Oct 28 2026; Monday Nov 2 and Nov 9 start the next weeks.
const oct = (day: number, h = 9, m = 0) => new Date(2026, 9, day, h, m);
const nov = (day: number, h = 9, m = 0) => new Date(2026, 10, day, h, m);
const MIN = 60_000;

function tick(state: AppState, now: Date) {
  applyChanges(state, ensureMonumental(state, now));
}

function setup(now = oct(28)): AppState {
  const state = emptyState();
  applyChanges(state, seedChanges(now.toISOString()));
  tick(state, now);
  return state;
}

function run<T>(state: AppState, result: ActionResult<T>): T {
  applyChanges(state, result.changes);
  return result.result;
}

/** A finished window starting at `start`, `minutes` long (logged by hand, as if right after). */
function work(state: AppState, start: Date, minutes: number) {
  const end = new Date(start.getTime() + minutes * MIN);
  run(state, addWindow(state, start, end, end));
}

const win = (start: Date, minutes: number): FocusWindow => ({
  id: `${start.getTime()}`,
  startAt: start.toISOString(),
  endAt: new Date(start.getTime() + minutes * MIN).toISOString(),
  dayKey: '2026-11-02',
  weekKey: '2026-11-02',
  planned: null,
  source: 'manual',
});

describe('damage', () => {
  it('is 1 per focused minute, half for windows under 15 minutes', () => {
    const [a, b] = windowDamage([win(nov(2, 9), 40), win(nov(2, 11), 10)], nov(2, 12));
    expect([a.damage, b.damage]).toEqual([40, 5]);
    expect(b.short).toBe(true);
  });

  it('chains windows that start within 15 minutes: 1×, 1.25×, then 1.5×', () => {
    const d = windowDamage(
      [win(nov(2, 9), 40), win(nov(2, 9, 50), 40), win(nov(2, 10, 40), 40), win(nov(2, 11, 30), 40), win(nov(2, 12, 26), 40)],
      nov(2, 14),
    );
    expect(d.map((w) => w.chain)).toEqual([0, 1, 2, 3, 0]); // the last gap is 16 minutes
    expect(d.map((w) => w.damage)).toEqual([40, 50, 60, 60, 40]);
  });

  it('a 90-minute window is a deep-focus crit (+25%), combining with the chain', () => {
    const d = windowDamage([win(nov(2, 8), 30), win(nov(2, 8, 40), 30), win(nov(2, 9, 20), 90)], nov(2, 12));
    expect(d[2]).toMatchObject({ crit: true, chain: 2, damage: Math.round(90 * 1.5 * 1.25) });
    expect(windowDamage([win(nov(2, 8), 89)], nov(2, 12))[0].crit).toBe(false);
  });

  it('caps a window at 3 hours', () => {
    const [d] = windowDamage([win(nov(2, 8), 300)], nov(2, 14));
    expect(d.minutes).toBe(180);
  });
});

describe('logging focus', () => {
  it('starts and ends, refusing a second running window', () => {
    const state = setup();
    run(state, startFocus(state, 50, oct(28, 9)));
    expect(() => startFocus(state, null, oct(28, 9, 5))).toThrow('already running');
    expect(run(state, endFocus(state, oct(28, 9, 45))).minutes).toBe(45);
    expect(runningWindow(state)).toBeNull();
  });

  it('past 3 hours, asks when you stopped, and caps the answer', () => {
    const state = setup();
    run(state, startFocus(state, null, oct(28, 9)));
    expect(() => endFocus(state, oct(28, 13))).toThrow('When did you stop?');
    run(state, endFocus(state, oct(28, 13), oct(28, 11, 30)));
    const [w] = state.focusWindows.values();
    expect(w.endAt).toBe(oct(28, 11, 30).toISOString());

    const other = setup();
    run(other, startFocus(other, null, oct(28, 9)));
    run(other, endFocus(other, oct(28, 15), oct(28, 14))); // later than the cap
    expect([...other.focusWindows.values()][0].endAt).toBe(oct(28, 12).toISOString());
  });

  it('adds, adjusts and deletes today’s windows only, without overlaps or windows over 3 hours', () => {
    const state = setup();
    work(state, oct(28, 9), 60);
    expect(() => addWindow(state, oct(28, 9, 30), oct(28, 10, 30), oct(28, 11))).toThrow('overlaps');
    expect(() => addWindow(state, oct(28, 11), oct(28, 14, 30), oct(28, 15))).toThrow('at most 3 hours');
    expect(() => addWindow(state, oct(27, 9), oct(27, 10), oct(28, 11))).toThrow('only be added or adjusted for today');
    const [w] = state.focusWindows.values();
    run(state, editWindow(state, w.id, oct(28, 8, 30), oct(28, 10), oct(28, 11)));
    expect(state.focusWindows.get(w.id)!.startAt).toBe(oct(28, 8, 30).toISOString());
    expect(() => deleteWindow(state, w.id, oct(29, 9))).toThrow('Only today');
    run(state, deleteWindow(state, w.id, oct(28, 12)));
    expect(state.focusWindows.size).toBe(0);
  });

  it('is off while hibernating, and a running window ends when hibernation starts', () => {
    const state = setup();
    run(state, startFocus(state, null, oct(28, 9)));
    run(state, startHibernation(state, null, oct(28, 10)));
    tick(state, oct(28, 10, 30));
    expect([...state.focusWindows.values()][0].endAt).toBe(oct(28, 10).toISOString());
    expect(() => startFocus(state, null, oct(28, 11))).toThrow('hibernating');
  });
});

describe('days off', () => {
  it('are workdays, today or ahead, never on a day with focus logged, and cancellable until they pass', () => {
    const state = setup();
    expect(() => setDayOff(state, '2026-10-31', oct(28))).toThrow('Monday to Friday');
    expect(() => setDayOff(state, '2026-10-27', oct(28))).toThrow('today or later');
    work(state, oct(28, 9), 30);
    expect(() => setDayOff(state, '2026-10-28', oct(28, 11))).toThrow('already logged focus');
    run(state, setDayOff(state, '2026-11-04', oct(28)));
    expect(() => startFocus(state, null, nov(4))).toThrow('day off');
    run(state, cancelDayOff(state, '2026-11-04', nov(3)));
    run(state, setDayOff(state, '2026-11-04', nov(3)));
    expect(() => cancelDayOff(state, '2026-11-04', nov(5))).toThrow('stay in the log');
  });
});

describe('the boss', () => {
  it('is there straight away, at full HP however late in the week the event starts', () => {
    const state = setup(); // a Wednesday
    expect(currentFight(state, oct(29))).toMatchObject({ name: 'Lethargos', fight: { tier: 1, weekKey: '2026-10-26' }, hp: { hp: 300 } });
    work(state, oct(29, 9), 60);
    tick(state, nov(2, 5));
    expect(state.bossWeeks.get('2026-10-26')).toMatchObject({ result: 'escaped', damage: 60, nextTier: 1 });
    expect(currentFight(state, nov(2, 5))).toMatchObject({ name: 'Lethargos', hp: { hp: 300 } });
  });

  it('prorates HP for days off and hibernated workdays, and skips mostly hibernated weeks', () => {
    const state = setup();
    tick(state, nov(2, 5));
    const fight = monumental(state)!.fight!;
    run(state, setDayOff(state, '2026-11-06', nov(2, 6)));
    expect(bossHp(state, fight, nov(2, 7))).toMatchObject({ hp: 240, daysOff: 1 });
    run(state, scheduleHibernation(state, '2026-11-04', '2026-11-05', nov(2, 7)));
    expect(bossHp(state, fight, nov(2, 7))).toMatchObject({ hp: 120, hibernatedWorkdays: 2, skipped: false });

    const other = setup();
    tick(other, nov(2, 5));
    run(other, scheduleHibernation(other, '2026-11-04', '2026-11-06', nov(2, 7)));
    expect(bossHp(other, monumental(other)!.fight!, nov(2, 7)).skipped).toBe(true);
  });

  it('records when it fell and shows today’s assault marker', () => {
    const state = setup();
    tick(state, nov(2, 5));
    work(state, nov(2, 8), 120);
    work(state, nov(2, 10, 10), 120); // chained, and both are crits
    work(state, nov(2, 12, 30), 60); // a 20-minute gap breaks the chain
    const f = currentFight(state, nov(2, 14))!;
    expect(f.damage).toBe(120 * 1.25 + Math.round(120 * 1.25 * 1.25) + 60); // 150 + 188 + 60
    expect(f.defeatedAt).toBe(nov(2, 12, 10).toISOString()); // 338 ≥ 300 when the second window ended
    expect(f).toMatchObject({ todayTarget: 60, todayDamage: 398 });
  });
});

describe('rewards', () => {
  it('pays 1,000 + 200 per tier and 3 + 1 Shard per two tiers', () => {
    expect(defeatReward(1)).toEqual({ sparks: 1_000, shards: 3 });
    expect(defeatReward(2)).toEqual({ sparks: 1_200, shards: 3 });
    expect(defeatReward(3)).toEqual({ sparks: 1_400, shards: 4 });
    expect(defeatReward(11)).toEqual({ sparks: 3_000, shards: 8 });
  });

  it('adds the overkill bonus at 120%, and pays half or a quarter for close escapes', () => {
    expect(EVENTS.rewardMultiplier).toBe(1);
    expect(weekReward(1, 300, 300)).toEqual({ sparks: 1_000, shards: 3, result: 'defeated' });
    expect(weekReward(1, 300, 360)).toEqual({ sparks: 1_500, shards: 5, result: 'defeated' });
    expect(weekReward(1, 300, 225)).toEqual({ sparks: 500, shards: 1, result: 'escaped' }); // 75%
    expect(weekReward(1, 300, 150)).toEqual({ sparks: 250, shards: 0, result: 'escaped' }); // 50%
    expect(weekReward(1, 300, 149)).toEqual({ sparks: 0, shards: 0, result: 'escaped' });
    expect(weekReward(11, 1_500, 1_200)).toEqual({ sparks: 1_500, shards: 4, result: 'escaped' });
  });
});

describe('the ladder', () => {
  it('climbs on a defeat, stays on one escape, drops after two, never below Tier 1, and ignores skipped weeks', () => {
    expect(climb(3, 0, 'defeated')).toEqual({ tier: 4, escapes: 0 });
    expect(climb(3, 1, 'defeated')).toEqual({ tier: 4, escapes: 0 });
    expect(climb(3, 0, 'escaped')).toEqual({ tier: 3, escapes: 1 });
    expect(climb(3, 1, 'escaped')).toEqual({ tier: 2, escapes: 0 });
    expect(climb(1, 1, 'escaped')).toEqual({ tier: 1, escapes: 0 });
    expect(climb(3, 1, 'skipped')).toEqual({ tier: 3, escapes: 1 });
    expect(climb(11, 0, 'defeated').tier).toBe(11);
  });

  it('settles each week at the reset: reward, record and the next boss', () => {
    const state = setup();
    tick(state, nov(2, 5));
    work(state, nov(2, 8), 180);
    work(state, nov(3, 8), 180); // two 3-hour crits: 450, overkill
    const before = balances(state);
    tick(state, nov(9, 5));
    expect(state.bossWeeks.get('2026-11-02')).toMatchObject({ result: 'defeated', damage: 450, nextTier: 2, rewardSparks: 1_500, rewardShards: 5 });
    expect(balances(state).sparks - before.sparks).toBe(1_500);
    expect(currentFight(state, nov(9, 6))).toMatchObject({ name: 'Akedia Shard', hp: { hp: 420 } });

    // Two escapes in a row drop back to Tier 1.
    tick(state, nov(16, 5));
    expect(state.bossWeeks.get('2026-11-09')).toMatchObject({ result: 'escaped', nextTier: 2 });
    tick(state, nov(23, 5));
    expect(state.bossWeeks.get('2026-11-16')).toMatchObject({ result: 'escaped', nextTier: 1 });
    expect(currentFight(state, nov(23, 6))!.name).toBe('Lethargos');
  });

  it('a mostly hibernated week has no result and leaves the ladder alone', () => {
    const state = setup();
    tick(state, nov(2, 5));
    const before = monumental(state)!; // the first week was escaped
    expect(before.escapes).toBe(1);
    run(state, scheduleHibernation(state, '2026-11-03', '2026-11-08', nov(2, 6)));
    tick(state, nov(9, 5));
    expect(state.bossWeeks.get('2026-11-02')).toMatchObject({ result: 'skipped', rewardSparks: 0, seen: true });
    expect(monumental(state)).toMatchObject({ tier: 1, escapes: 1 });
  });
});
