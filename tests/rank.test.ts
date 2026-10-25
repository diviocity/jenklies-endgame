import { describe, expect, it } from 'vitest';
import { FITNESS } from '../src/config';
import {
  pointsForRank,
  rankOf,
  rpMax,
  targetPoints,
  weekPoints,
  weekStep,
} from '../src/logic/rank';
import { weekKeyOf } from '../src/logic/time';
import type { FitnessEntry, FitnessType } from '../src/types';

const TARGET = targetPoints(FITNESS.defaultTarget);
const MAX = rpMax(TARGET);

/** Runs weeks of the given points from a starting RP; returns the rank after each. */
function simulate(weeks: number[], rp = 0, streak = 0): { ranks: number[]; rp: number } {
  const ranks: number[] = [];
  for (const points of weeks) {
    ({ rp, weakStreak: streak } = weekStep(rp, streak, points));
    ranks.push(rankOf(rp, MAX));
  }
  return { ranks, rp };
}

const repeat = (points: number, n: number) => Array<number>(n).fill(points);
const week = (cf: number, pt: number, walks: number) => cf * 100 + pt * 50 + walks * 10;

describe('targets', () => {
  it('the default target week is 520 points and RP_max 4,680', () => {
    expect(TARGET).toBe(520);
    expect(MAX).toBeCloseTo(4680, 6);
  });

  it('RP_max rescales when the target changes (e.g. when PT ends)', () => {
    const noPt = targetPoints({ crossfit: 3, pt: 0, workout: 0, activity: 7 });
    expect(noPt).toBe(370);
    expect(rpMax(noPt)).toBeCloseTo(3330, 6);
  });

  it('activities past the weekly cap do not raise the target', () => {
    expect(targetPoints({ crossfit: 0, pt: 0, workout: 0, activity: 10 })).toBe(70);
  });
});

describe('rank', () => {
  it('maps RP to 1–20, exact thresholds included', () => {
    expect(rankOf(0, MAX)).toBe(1);
    expect(rankOf(4680, MAX)).toBe(20);
    expect(rankOf(5200 * 0.9, MAX)).toBe(20); // 4679.999… from floating point still counts
    expect(rankOf(99_999, MAX)).toBe(20);
    expect(rankOf(234, MAX)).toBe(1);
    expect(rankOf(468, MAX)).toBe(2);
  });

  it('steady target weeks from zero: 2, 4, 6, 7, 9, 10… and Rank 20 at week 22', () => {
    const { ranks } = simulate(repeat(TARGET, 24));
    expect(ranks.slice(0, 6)).toEqual([2, 4, 6, 7, 9, 10]);
    expect(ranks.indexOf(20) + 1).toBe(22);
    expect(ranks[20]).toBeLessThan(20);
  });

  it('typical weeks settle at about 17, 9 and 2', () => {
    expect(simulate(repeat(week(2, 3, 7), 200)).ranks.pop()).toBe(17);
    expect(simulate(repeat(week(1, 1, 7), 200)).ranks.pop()).toBe(9);
    expect(simulate(repeat(week(0, 0, 7), 200)).ranks.pop()).toBe(2);
  });

  it('from Rank 20 with zero activity: about 19, 16, 12, 9, 6', () => {
    // Months of target weeks leave RP around 5,000, above the Rank 20 line.
    const { rp } = simulate(repeat(TARGET, 30));
    expect(rp).toBeGreaterThan(4950);
    expect(simulate(repeat(0, 5), rp).ranks).toEqual([19, 16, 12, 9, 6]);
    // Freshly at Rank 20 (just over the line) it falls one rank faster at first.
    const fresh = simulate(repeat(TARGET, 22)).rp;
    expect(simulate(repeat(0, 5), fresh).ranks).toEqual([18, 15, 11, 8, 6]);
  });
});

describe('decay', () => {
  it('escalates 10% → 15% → 25% over consecutive weak weeks', () => {
    const decays: number[] = [];
    let rp = 4000;
    let streak = 0;
    for (let i = 0; i < 4; i++) {
      const s = weekStep(rp, streak, 0);
      decays.push(s.decay);
      ({ rp, weakStreak: streak } = s);
    }
    expect(decays).toEqual([0.1, 0.15, 0.25, 0.25]);
  });

  it('one non-weak week resets decay to normal', () => {
    const a = weekStep(4000, 2, 0); // third weak week
    expect(a.decay).toBe(0.25);
    const b = weekStep(a.rp, a.weakStreak, a.rp * 0.1); // exactly enough to hold
    expect(b).toMatchObject({ weak: false, weakStreak: 0, decay: 0.1 });
    expect(weekStep(b.rp, b.weakStreak, 0).decay).toBe(0.1);
  });

  it('a week is weak only below RP × 10%', () => {
    expect(weekStep(1000, 0, 99).weak).toBe(true);
    expect(weekStep(1000, 0, 100).weak).toBe(false);
    expect(weekStep(0, 0, 0).weak).toBe(false);
  });
});

describe('points needed this week', () => {
  const cases: [rp: number, streak: number][] = [
    [0, 0],
    [988, 0],
    [2436, 0],
    [3000, 1],
    [3000, 2],
    [4688, 0],
    [5200, 0],
  ];

  it('is exactly enough to reach the rank, and one point fewer is not', () => {
    for (const [rp, streak] of cases) {
      for (let rank = 1; rank <= 20; rank++) {
        const p = pointsForRank(rp, streak, rank, MAX);
        expect(rankOf(weekStep(rp, streak, p).rp, MAX)).toBeGreaterThanOrEqual(rank);
        if (p > 0) expect(rankOf(weekStep(rp, streak, p - 1).rp, MAX)).toBeLessThan(rank);
      }
    }
  });

  it('holding Rank 20 near the line takes about a target week', () => {
    expect(pointsForRank(4688, 0, 20, MAX)).toBe(461);
  });
});

describe('weekly points', () => {
  const entry = (type: FitnessType, i: number): FitnessEntry => ({
    id: `e${i}`,
    at: `2026-10-26T1${i % 10}:00:00.000Z`,
    dayKey: '2026-10-26',
    weekKey: '2026-10-26',
    type,
    points: FITNESS.points[type],
    source: 'manual',
    note: '',
  });

  it('counts only the first 7 activities', () => {
    const walks = Array.from({ length: 9 }, (_, i) => entry('activity', i));
    expect(weekPoints(walks)).toBe(70);
    expect(weekPoints([...walks, entry('crossfit', 9)])).toBe(170);
  });

  it('weeks start Monday at the 4 AM rollover', () => {
    expect(weekKeyOf('2026-10-26')).toBe('2026-10-26'); // Monday
    expect(weekKeyOf('2026-11-01')).toBe('2026-10-26'); // Sunday (and Monday before 4 AM)
    expect(weekKeyOf('2026-11-02')).toBe('2026-11-02');
    expect(weekKeyOf('2026-10-28')).toBe('2026-10-26');
  });
});
