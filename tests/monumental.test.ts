import { describe, expect, it } from 'vitest';
import { EVENTS } from '../src/config';
import { balances } from '../src/logic/actions';
import type { ActionResult } from '../src/logic/errors';
import { scheduleHibernation, startHibernation } from '../src/logic/hibernation';
import {
  addWindow,
  bestiary,
  bossHp,
  chainMultiplier,
  cancelDayOff,
  climb,
  currentFight,
  defeatReward,
  deleteWindow,
  editWindow,
  endFocus,
  ensureMonumental,
  fightStatus,
  focusStats,
  milestonesEarned,
  modifierOf,
  monumental,
  runningWindow,
  setDayOff,
  spawn,
  startFocus,
  weekReward,
  windowDamage,
} from '../src/logic/monumental';
import { applyChanges, emptyState, seedChanges } from '../src/logic/state';
import { put } from '../src/logic/state';
import { seededRng } from '../src/logic/gacha';
import { earnedTitles, unlockedThemes } from '../src/logic/honors';
import type { AppState, BossFight, BossWeek, FocusWindow } from '../src/types';

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
    // Defeating Akrasia opens Agony Mode (Tier 12); a defeat keeps it, two escapes drop back to Tier 11.
    expect(climb(11, 0, 'defeated').tier).toBe(12);
    expect(climb(12, 0, 'defeated').tier).toBe(12);
    expect(climb(12, 1, 'escaped')).toEqual({ tier: 11, escapes: 0 });
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

// ---------------------------------------------------------------- phase 2

const agonyFight = (modifier: string, boss = 0): BossFight => ({ weekKey: '2026-11-02', tier: 12, boss, agony: true, modifier });

/** A state on the week of Nov 2 with this fight and these windows. */
function fightWith(fight: BossFight, windows: [Date, number][]) {
  const state = setup(nov(2, 5));
  applyChanges(state, [put('monumental', { ...monumental(state)!, tier: fight.tier, fight })]);
  for (const [start, minutes] of windows) work(state, start, minutes);
  return state;
}

describe('Agony modifiers', () => {
  it('Enraged: windows under 20 minutes deal no damage', () => {
    const d = windowDamage([win(nov(2, 8), 19), win(nov(2, 9), 20)], nov(2, 12), modifierOf('enraged'));
    expect(d.map((w) => w.damage)).toEqual([0, 20]);
  });

  it('Fortified: chains continue only with a gap of 10 minutes or less', () => {
    const windows = [win(nov(2, 8), 40), win(nov(2, 8, 52), 40)]; // a 12-minute gap
    expect(windowDamage(windows, nov(2, 12))[1].chain).toBe(1);
    expect(windowDamage(windows, nov(2, 12), modifierOf('fortified'))[1].chain).toBe(0);
  });

  it('Dampened: the chain multiplier is capped at 1.25×', () => {
    expect(chainMultiplier(2)).toBe(1.5);
    expect(chainMultiplier(2, modifierOf('dampened'))).toBe(1.25);
    const d = windowDamage([win(nov(2, 8), 40), win(nov(2, 8, 45), 40), win(nov(2, 9, 30), 40)], nov(2, 12), modifierOf('dampened'));
    expect(d.map((w) => w.damage)).toEqual([40, 50, 50]);
  });

  it('Exposed: +15% HP, but crits deal +50%', () => {
    const state = fightWith(agonyFight('exposed'), []);
    expect(bossHp(state, agonyFight('exposed'), nov(2, 6)).max).toBe(Math.round(1500 * 1.15));
    expect(windowDamage([win(nov(2, 8), 90)], nov(2, 12), modifierOf('exposed'))[0].damage).toBe(135);
  });

  it('Regenerating: each quiet workday heals 5% of max HP at the rollover; a defeated boss stays down', () => {
    // Monday: 120 damage (no heal). Tuesday: 30 (heals 75 at Wednesday 4 AM). Wednesday: a day off (no heal).
    const state = fightWith(agonyFight('regenerating'), [
      [nov(2, 8), 80],
      [nov(2, 10), 40],
      [nov(3, 9), 30],
    ]);
    run(state, setDayOff(state, '2026-11-04', nov(3, 12)));
    const status = fightStatus(state, monumental(state)!.fight!, nov(5, 9));
    expect(status.healed).toBe(75);
    expect(status.damage).toBe(80 + 40 + 30 - 75);
    // Thursday and Friday without focus heal again, but never below zero damage: 75 more, not 150.
    const later = fightStatus(state, monumental(state)!.fight!, nov(7, 9));
    expect(later).toMatchObject({ healed: 150, damage: 0 });
  });
});

describe('Agony Mode', () => {
  it('rolls a random boss and modifier, never the same as the week before', () => {
    const rng = seededRng(7);
    let prev: BossFight | null = null;
    for (let i = 0; i < 200; i++) {
      const next = spawn(12, '2026-11-02', prev, rng);
      expect(next).toMatchObject({ tier: 12, agony: true });
      expect(next.boss).toBeGreaterThanOrEqual(0);
      expect(next.boss).toBeLessThan(11);
      if (prev) {
        expect(next.boss).not.toBe(prev.boss);
        expect(next.modifier).not.toBe(prev.modifier);
      }
      prev = next;
    }
    expect(spawn(5, '2026-11-02', prev, rng)).toEqual({ weekKey: '2026-11-02', tier: 5, boss: 4 });
  });

  it('opens after defeating Akrasia, and two escapes drop back to Tier 11', () => {
    const state = fightWith({ weekKey: '2026-11-02', tier: 11, boss: 10 }, []);
    for (let d = 2; d <= 6; d++) {
      work(state, nov(d, 8), 180);
      work(state, nov(d, 11, 5), 180);
    }
    tick(state, nov(9, 5));
    expect(state.bossWeeks.get('2026-11-02')).toMatchObject({ result: 'defeated', nextTier: 12 });
    const agony = monumental(state)!.fight!;
    expect(agony).toMatchObject({ tier: 12, agony: true });
    expect(currentFight(state, nov(9, 6))!.name).toMatch(/^Agony /);
    tick(state, nov(16, 5));
    tick(state, nov(23, 5));
    expect(monumental(state)).toMatchObject({ tier: 11 });
    expect(monumental(state)!.fight).toMatchObject({ tier: 11, boss: 10 });
    expect(monumental(state)!.fight!.agony).toBeUndefined();
  });

  it('pays 3,000 + 10 Shards for an Agony defeat', () => {
    expect(defeatReward(12)).toEqual({ sparks: 3_000, shards: 10 });
    expect(weekReward(12, 1_500, 1_500)).toEqual({ sparks: 3_000, shards: 10, result: 'defeated' });
  });
});

describe('one-time rewards', () => {
  const week = (id: number, tier: number, boss: number, agony = false): BossWeek => ({
    id: `w${id}`,
    tier,
    boss,
    hp: 1,
    damage: 1,
    result: 'defeated',
    defeatedAt: `2026-01-${String((id % 28) + 1).padStart(2, '0')}T12:00:00Z`,
    nextTier: tier,
    rewardSparks: 0,
    rewardShards: 0,
    closedAt: '',
    seen: true,
    ...(agony ? { agony: true } : {}),
  });

  it('first defeats of Tiers 3, 6 and 9 give 4★ selectors; Akrasia gives a 5★, a title and the theme', () => {
    const ids = (weeks: BossWeek[]) => milestonesEarned(weeks).map((m) => m.id);
    expect(ids([week(1, 2, 1)])).toEqual([]);
    expect(ids([week(1, 3, 2), week(2, 6, 5), week(3, 9, 8)])).toEqual(['first-3', 'first-6', 'first-9']);
    const akrasia = milestonesEarned([week(1, 11, 10)]).find((m) => m.id === 'akrasia')!;
    expect(akrasia).toMatchObject({ selector: 5, title: 'Monument Breaker', theme: 'monolith' });
  });

  it('all 11 Agony variants give a 5★ and “Agony Unbound”, and every 10 Agony victories a 5★', () => {
    const ten = Array.from({ length: 10 }, (_, i) => week(i, 12, i, true));
    expect(milestonesEarned(ten).map((m) => m.id)).toEqual(['agony-10']);
    const all = [...ten, week(10, 12, 10, true)];
    expect(milestonesEarned(all).find((m) => m.id === 'agony-all')).toMatchObject({ selector: 5, title: 'Agony Unbound' });
    const thirty = Array.from({ length: 30 }, (_, i) => week(i, 12, i % 11, true));
    expect(milestonesEarned(thirty).map((m) => m.id)).toEqual(['agony-all', 'agony-10', 'agony-20', 'agony-30']);
  });

  it('are claimed at the reset, once', () => {
    const state = fightWith({ weekKey: '2026-11-02', tier: 11, boss: 10 }, []);
    for (let d = 2; d <= 6; d++) {
      work(state, nov(d, 8), 180);
      work(state, nov(d, 11, 5), 180);
    }
    tick(state, nov(9, 5));
    expect(monumental(state)!.milestones).toEqual(['akrasia']);
    expect(earnedTitles(state)).toEqual(['Monument Breaker']);
    expect(unlockedThemes(state)).toEqual(['monolith']);
    expect([...state.selectors.values()].map((s) => s.rarity)).toEqual([5]);
    tick(state, nov(16, 5));
    expect([...state.selectors.values()]).toHaveLength(1);
  });
});

describe('Bestiary and stats', () => {
  it('lists every boss and Agony variant, with first-defeat dates and counts', () => {
    const state = setup();
    work(state, oct(28, 8), 180);
    work(state, oct(28, 11, 5), 180);
    tick(state, nov(2, 5));
    const entries = bestiary(state);
    expect(entries).toHaveLength(22);
    expect(entries[0]).toMatchObject({ name: 'Lethargos', defeats: 1 });
    expect(entries[0].firstDefeat).not.toBeNull();
    expect(entries[11]).toMatchObject({ name: 'Agony Lethargos', defeats: 0, firstDefeat: null });
  });

  it('reports hours per week, the longest window and chain, and the average window', () => {
    const state = setup();
    work(state, oct(28, 8), 30);
    work(state, oct(28, 8, 40), 60); // chain of 2, 90 minutes
    work(state, oct(28, 13), 120);
    const stats = focusStats(state, oct(28, 16), 4);
    expect(stats.weeks.map((w) => w.hours)).toEqual([0, 0, 0, 3.5]);
    expect(stats.longestWindow).toBe(120);
    expect(stats.longestChain).toEqual({ windows: 2, minutes: 90 });
    expect(stats.averageWindow).toBe(70);
  });
});
