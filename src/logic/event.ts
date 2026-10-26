import { FITNESS, WEEKLY_REWARDS } from '../config';
import type {
  AppState,
  Change,
  DayRecord,
  DayTask,
  EventWeek,
  FitnessEntry,
  FitnessTarget,
  FitnessType,
  FrontierState,
  LedgerEntry,
} from '../types';
import { ActionError, done, type ActionResult } from './errors';
import { newId } from './ids';
import {
  FITNESS_LABELS,
  pointsForRank,
  rankOf,
  rpForRank,
  rpMax,
  targetPoints,
  weekPoints,
  weekStep,
} from './rank';
import { activeDayFraction, hibernatedDaysInWeek, isSkippedWeek, requireAwake } from './hibernation';
import { getMeta, put } from './state';
import { addDays, dayKeyOf, weekKeyOf } from './time';

export const FRONTIER_ID = 'frontier';

export function fitnessTarget(state: AppState): FitnessTarget {
  return getMeta(state).settings.fitnessTarget ?? { ...FITNESS.defaultTarget };
}

export function frontier(state: AppState): FrontierState | undefined {
  return state.events.get(FRONTIER_ID);
}

export function entriesForWeek(state: AppState, weekKey: string): FitnessEntry[] {
  return [...state.fitness.values()].filter((e) => e.weekKey === weekKey);
}

/** Closed weeks, oldest first. */
export function eventHistory(state: AppState): EventWeek[] {
  return [...state.eventWeeks.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * Starts the event if needed and runs every weekly reset that's due, including weeks
 * the app wasn't opened (they count as zero-point weeks).
 */
export function ensureEvent(state: AppState, now: Date): Change[] {
  const thisWeek = weekKeyOf(dayKeyOf(now));
  const existing = frontier(state);
  if (!existing) {
    const fresh: FrontierState = {
      id: FRONTIER_ID,
      startedWeek: thisWeek,
      currentWeek: thisWeek,
      rp: 0,
      rank: 1,
      weakStreak: 0,
      peakRank: 1,
    };
    return [put('events', fresh)];
  }
  if (existing.currentWeek >= thisWeek) return [];

  const target = targetPoints(fitnessTarget(state));
  const max = rpMax(target);
  const changes: Change[] = [];
  const event = { ...existing };
  while (event.currentWeek < thisWeek) {
    const points = weekPoints(entriesForWeek(state, event.currentWeek));
    const hibernatedDays = hibernatedDaysInWeek(state, event.currentWeek, now);
    if (isSkippedWeek(state, event.currentWeek, now)) {
      // Mostly hibernated: skipped entirely. Nothing decays and nothing is paid.
      changes.push(
        put('eventWeeks', {
          id: event.currentWeek,
          points,
          targetPoints: target,
          rpMax: max,
          rpBefore: event.rp,
          rpAfter: event.rp,
          decay: 0,
          weak: false,
          weakStreak: event.weakStreak,
          rankBefore: event.rank,
          rankAfter: event.rank,
          closedAt: now.toISOString(),
          seen: false,
          hibernatedDays,
          skipped: true,
          rewardSparks: 0,
          rewardShards: 0,
          mapAtClose: event.mapProgress ?? 0,
        }),
      );
      event.currentWeek = addDays(event.currentWeek, 7);
      continue;
    }
    // A few hibernated days prorate the week: decay, the weak threshold and reward thresholds.
    const step = weekStep(event.rp, event.weakStreak, points, activeDayFraction(state, event.currentWeek, now));
    const rankAfter = rankOf(step.rp, max);
    const record: EventWeek = {
      id: event.currentWeek,
      points,
      targetPoints: target,
      rpMax: max,
      rpBefore: event.rp,
      rpAfter: step.rp,
      decay: step.decay,
      weak: step.weak,
      weakStreak: step.weakStreak,
      rankBefore: event.rank,
      rankAfter,
      closedAt: now.toISOString(),
      seen: false,
      hibernatedDays,
    };
    record.mapAtClose = event.mapProgress ?? 0;
    changes.push(...payWeek(record, now));
    event.rp = step.rp;
    event.weakStreak = step.weakStreak;
    event.rank = rankAfter;
    event.peakRank = Math.max(event.peakRank, rankAfter);
    event.currentWeek = addDays(event.currentWeek, 7);
  }
  changes.push(put('events', event));
  return changes;
}

// ---------------------------------------------------------------- weekly rewards

/** The weekly reward for a week's points against the target, and for holding Rank 20. */
export function weeklyReward(points: number, target: number, rankAfter: number): { sparks: number; shards: number } {
  const { full, half } = WEEKLY_REWARDS;
  const tier = target <= 0 ? null : points >= target * full.share ? full : points >= target * half.share ? half : null;
  return {
    sparks: tier?.sparks ?? 0,
    shards: (tier?.shards ?? 0) + (rankAfter >= 20 ? WEEKLY_REWARDS.rank20Shards : 0),
  };
}

function ledger(entry: Omit<LedgerEntry, 'id'>): Change {
  return put('ledger', { id: newId(), ...entry });
}

/** The share of a closed week that was active (hibernated days prorate its reward thresholds). */
export function weekActiveShare(week: EventWeek): number {
  return (7 - (week.hibernatedDays ?? 0)) / 7;
}

/** Pays a closed week's reward into the ledger and records it on the week. Skipped weeks pay nothing. */
export function payWeek(week: EventWeek, now: Date): Change[] {
  const { sparks, shards } = week.skipped
    ? { sparks: 0, shards: 0 }
    : weeklyReward(week.points, week.targetPoints * weekActiveShare(week), week.rankAfter);
  const at = now.toISOString();
  const note = `Expedition: week of ${week.id}`;
  const changes: Change[] = [put('eventWeeks', { ...week, rewardSparks: sparks, rewardShards: shards })];
  if (sparks) changes.push(ledger({ at, currency: 'sparks', amount: sparks, reason: 'event_weekly', note }));
  if (shards) changes.push(ledger({ at, currency: 'shards', amount: shards, reason: 'event_weekly', note }));
  return changes;
}

export interface RankStatus {
  rank: number;
  rp: number;
  rpMax: number;
  target: number;
  /** Points earned so far this week (after the activity cap). */
  weekPoints: number;
  /** Rank if the week ended now. */
  projectedRank: number;
  /** More points needed this week to keep the current rank at the reset (0 if already safe). */
  toHold: number;
  /** More points needed this week to reach the next rank (null at Rank 20). */
  toNext: number | null;
  /** Whether this week's points so far already keep the current rank at the reset. */
  holding: boolean;
  /** Progress (0–1) toward holding the rank, or once held, toward the next rank. */
  progress: number;
  weekKey: string;
  history: EventWeek[];
  /** Hibernated days this week (known so far, plus any scheduled). */
  hibernatedDays: number;
  /** This week will be skipped at the reset (too many hibernated days). */
  skipped: boolean;
}

export function rankStatus(state: AppState, now: Date): RankStatus | null {
  const event = frontier(state);
  if (!event) return null;
  const fullTarget = targetPoints(fitnessTarget(state));
  const max = rpMax(fullTarget);
  const weekKey = weekKeyOf(dayKeyOf(now));
  const points = weekPoints(entriesForWeek(state, weekKey));
  const hibernatedDays = hibernatedDaysInWeek(state, weekKey, now);
  const skipped = isSkippedWeek(state, weekKey, now);
  // Hibernated days prorate this week's target, decay and thresholds.
  const active = activeDayFraction(state, weekKey, now);
  const target = Math.round(fullTarget * active);
  // Rank shown is from the last reset; it rescales at once if the target changes.
  const rank = rankOf(event.rp, max);
  if (skipped) {
    return {
      rank,
      rp: event.rp,
      rpMax: max,
      target,
      weekPoints: points,
      projectedRank: rank,
      toHold: 0,
      toNext: null,
      holding: true,
      progress: 1,
      weekKey,
      history: eventHistory(state),
      hibernatedDays,
      skipped,
    };
  }
  const projected = weekStep(event.rp, event.weakStreak, points, active).rp;
  const lower = rpForRank(rank, max);
  const upper = rpForRank(rank + 1, max);
  return {
    rank,
    rp: event.rp,
    rpMax: max,
    target,
    weekPoints: points,
    projectedRank: rankOf(projected, max),
    toHold: Math.max(0, pointsForRank(event.rp, event.weakStreak, rank, max, active) - points),
    toNext: rank >= 20 ? null : Math.max(0, pointsForRank(event.rp, event.weakStreak, rank + 1, max, active) - points),
    holding: projected >= lower - 1e-9,
    progress:
      projected < lower - 1e-9
        ? Math.max(0, projected / lower)
        : rank >= 20
          ? 1
          : Math.min(1, (projected - lower) / (upper - lower)),
    weekKey,
    history: eventHistory(state),
    hibernatedDays,
    skipped,
  };
}

// ---------------------------------------------------------------- fitness log

function fitnessEntry(input: Omit<FitnessEntry, 'id' | 'weekKey' | 'points'>): FitnessEntry {
  return {
    id: newId(),
    ...input,
    weekKey: weekKeyOf(input.dayKey),
    points: FITNESS.points[input.type],
  };
}

/** The fitness entry a tagged task logs when it's checked off. */
export function taskFitnessEntry(day: DayRecord, task: DayTask, at: string): FitnessEntry | null {
  if (!task.fitness) return null;
  return fitnessEntry({ at, dayKey: day.id, type: task.fitness, source: 'task', taskId: task.id, note: task.name });
}

export function taskFitnessEntries(state: AppState, dayKey: string, taskId: string): FitnessEntry[] {
  return [...state.fitness.values()].filter((e) => e.dayKey === dayKey && e.taskId === taskId);
}

/** Whether a new entry of this type would earn points this week (activities past the cap don't). */
export function wouldCount(state: AppState, weekKey: string, type: FitnessType): boolean {
  if (type !== 'activity') return true;
  const activities = entriesForWeek(state, weekKey).filter((e) => e.type === 'activity').length;
  return activities < FITNESS.activityWeeklyCap;
}

export function logActivity(
  state: AppState,
  input: { type: FitnessType; note: string },
  now: Date,
): ActionResult<{ points: number }> {
  if (!(input.type in FITNESS.points)) throw new ActionError('Pick an activity type.');
  requireAwake(state, now, 'log activity');
  const dayKey = dayKeyOf(now);
  const entry = fitnessEntry({
    at: now.toISOString(),
    dayKey,
    type: input.type,
    source: 'manual',
    note: input.note.trim() || FITNESS_LABELS[input.type],
  });
  const points = wouldCount(state, entry.weekKey, entry.type) ? entry.points : 0;
  return done([put('fitness', entry)], { points });
}

export function undoActivity(state: AppState, entryId: string, now: Date): ActionResult {
  const entry = state.fitness.get(entryId);
  if (!entry) throw new ActionError('That entry no longer exists.');
  if (entry.source !== 'manual') throw new ActionError('Undo the task on Today instead.');
  if (entry.dayKey !== dayKeyOf(now)) throw new ActionError('Only today’s entries can be undone.');
  return done([{ store: 'fitness', op: 'delete', id: entryId }], undefined);
}
