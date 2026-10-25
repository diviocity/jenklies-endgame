import { FITNESS, RANK } from '../config';
import type { FitnessEntry, FitnessTarget, FitnessType } from '../types';

/** Display names. The stored codes (crossfit, pt, …) predate the names and stay as they are. */
export const FITNESS_LABELS: Record<FitnessType, string> = {
  crossfit: 'Major activity',
  workout: 'Other workout',
  pt: 'Moderate activity',
  activity: 'Minor activity',
};

/** In points order: 100, 75, 50, 10. */
export const FITNESS_TYPES: FitnessType[] = ['crossfit', 'workout', 'pt', 'activity'];

/** Points for a full target week. */
export function targetPoints(target: FitnessTarget): number {
  const activities = Math.min(target.activity, FITNESS.activityWeeklyCap);
  return (
    target.crossfit * FITNESS.points.crossfit +
    target.pt * FITNESS.points.pt +
    target.workout * FITNESS.points.workout +
    activities * FITNESS.points.activity
  );
}

/** The RP that means Rank 20, scaled from the target week. */
export function rpMax(targetPts: number): number {
  return (RANK.rpMaxFactor * targetPts) / RANK.baseDecay;
}

/** Rank 1–20 for an amount of RP. A tiny tolerance keeps exact thresholds from rounding down. */
export function rankOf(rp: number, max: number): number {
  if (max <= 0) return 1;
  const raw = Math.floor((RANK.maxRank * rp) / max + 1e-9);
  return Math.min(RANK.maxRank, Math.max(1, raw));
}

/** The RP needed for a rank. */
export function rpForRank(rank: number, max: number): number {
  return rank <= 1 ? 0 : (rank * max) / RANK.maxRank;
}

/** Decay for a weak week, given how many weak weeks in a row it makes. */
export function weakDecay(streak: number): number {
  const steps = RANK.weakDecay;
  return steps[Math.min(streak, steps.length) - 1];
}

export interface WeekStep {
  rp: number;
  weak: boolean;
  weakStreak: number;
  decay: number;
}

/** The weekly reset: RP = RP × (1 − decay) + this week's points. */
export function weekStep(rp: number, weakStreak: number, points: number): WeekStep {
  const weak = points < rp * RANK.weakThreshold;
  const streak = weak ? weakStreak + 1 : 0;
  const decay = weak ? weakDecay(streak) : RANK.baseDecay;
  return { rp: rp * (1 - decay) + points, weak, weakStreak: streak, decay };
}

/**
 * The fewest points this week that put RP at `rank` or above at the next reset
 * (accounting for the higher decay of a weak week). Infinity can't happen, since RP grows with points.
 */
export function pointsForRank(rp: number, weakStreak: number, rank: number, max: number): number {
  const need = rpForRank(rank, max);
  const threshold = rp * RANK.weakThreshold;
  // As a weak week (fewer points than the threshold), decay is higher.
  const asWeak = Math.max(0, need - rp * (1 - weakDecay(weakStreak + 1)));
  if (asWeak < threshold) return Math.ceil(asWeak - 1e-9);
  // Otherwise the week isn't weak, so normal decay applies.
  return Math.ceil(Math.max(threshold, need - rp * (1 - RANK.baseDecay)) - 1e-9);
}

/** Which entries of a week earn points: only the first few activities count. */
export function countedEntryIds(entries: FitnessEntry[]): Set<string> {
  const counted = new Set<string>();
  let activities = 0;
  for (const e of [...entries].sort((a, b) => (a.at < b.at ? -1 : 1))) {
    if (e.type === 'activity' && ++activities > FITNESS.activityWeeklyCap) continue;
    counted.add(e.id);
  }
  return counted;
}

/** A week's points from its entries, after the activity cap. */
export function weekPoints(entries: FitnessEntry[]): number {
  const counted = countedEntryIds(entries);
  return entries.reduce((sum, e) => (counted.has(e.id) ? sum + e.points : sum), 0);
}
