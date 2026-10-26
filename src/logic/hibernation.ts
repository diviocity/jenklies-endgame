import { HIBERNATION } from '../config';
import type { AppState, Hibernation } from '../types';
import { ActionError, done, type ActionResult } from './errors';
import { newId } from './ids';
import { put } from './state';
import { addDays, dayKeyOf, deadlineAt } from './time';

// Hibernation: an app-wide pause for travel, illness or anything else that takes me out of
// my routine. It protects progress and never earns anything.
//
// Every event must use these helpers for anything that decays, expires, counts time or pays
// weekly rewards (see the README's "Rules for events"). Days are whole app days (4 AM
// rollover): a day is hibernated if hibernation was on at any point during it.

/** 4 AM on a day: when it starts. */
function dayStart(dayKey: string): Date {
  return deadlineAt(dayKey, 4 * 60);
}

export function periods(state: AppState): Hibernation[] {
  return [...state.hibernations.values()].sort((a, b) => (a.startAt < b.startAt ? -1 : 1));
}

/** The period on at this moment, if any. */
export function activeHibernation(state: AppState, at: Date): Hibernation | null {
  const t = at.toISOString();
  return periods(state).find((h) => h.startAt <= t && (h.endAt === null || t < h.endAt)) ?? null;
}

export function isHibernating(state: AppState, at: Date): boolean {
  return activeHibernation(state, at) !== null;
}

/** The period that's on or scheduled (there's at most one). */
export function currentHibernation(state: AppState, now: Date): Hibernation | null {
  const t = now.toISOString();
  return periods(state).find((h) => h.endAt === null || t < h.endAt) ?? null;
}

/**
 * The first and last day a period covers. An open-ended period runs through today (or its
 * first day, if it hasn't started); a scheduled end covers its planned days, future ones included.
 */
export function periodDays(h: Hibernation, now: Date): { first: string; last: string } {
  const first = dayKeyOf(new Date(h.startAt));
  if (h.endAt) return { first, last: dayKeyOf(new Date(Date.parse(h.endAt) - 1)) };
  const today = dayKeyOf(now);
  return { first, last: today > first ? today : first };
}

/** Whole days a period covers. */
export function periodLength(h: Hibernation, now: Date): number {
  const { first, last } = periodDays(h, now);
  let n = 0;
  for (let d = first; d <= last; d = addDays(d, 1)) n++;
  return n;
}

export function isHibernatedDay(state: AppState, dayKey: string, now: Date): boolean {
  return periods(state).some((h) => {
    const { first, last } = periodDays(h, now);
    return dayKey >= first && dayKey <= last;
  });
}

/** How many of a week's 7 days are hibernated. */
export function hibernatedDaysInWeek(state: AppState, weekKey: string, now: Date): number {
  let n = 0;
  for (let i = 0; i < 7; i++) if (isHibernatedDay(state, addDays(weekKey, i), now)) n++;
  return n;
}

/** The share of a week that's active (7 − hibernated days) ÷ 7, for prorating weekly maths. */
export function activeDayFraction(state: AppState, weekKey: string, now: Date): number {
  return (7 - hibernatedDaysInWeek(state, weekKey, now)) / 7;
}

/** Whether weekly resets skip this week entirely. */
export function isSkippedWeek(state: AppState, weekKey: string, now: Date): boolean {
  return hibernatedDaysInWeek(state, weekKey, now) >= HIBERNATION.skipWeekDays;
}

/** Active (not hibernated) days after `fromDay`, up to and including `toDay`. For anything that ages. */
export function activeDaysBetween(state: AppState, fromDay: string, toDay: string, now: Date): number {
  let n = 0;
  for (let d = addDays(fromDay, 1); d <= toDay; d = addDays(d, 1)) if (!isHibernatedDay(state, d, now)) n++;
  return n;
}

/** Stops an action that would earn something while hibernating. */
export function requireAwake(state: AppState, now: Date, what: string): void {
  if (isHibernating(state, now)) throw new ActionError(`You’re hibernating. Wake up to ${what}.`);
}

// ---------------------------------------------------------------- starting and ending

function checkEndDay(endDay: string | null, firstDay: string): void {
  if (endDay !== null && endDay < firstDay) throw new ActionError('The last day away can’t be before the first.');
}

function checkNoneCurrent(state: AppState, now: Date): void {
  const current = currentHibernation(state, now);
  if (current) {
    throw new ActionError(
      current.startAt <= now.toISOString() ? 'You’re already hibernating.' : 'A hibernation is already scheduled. Cancel it first.',
    );
  }
}

/** Starts hibernating now, optionally until the end of `endDay` (the last day away). */
export function startHibernation(state: AppState, endDay: string | null, now: Date): ActionResult {
  checkNoneCurrent(state, now);
  checkEndDay(endDay, dayKeyOf(now));
  const h: Hibernation = {
    id: newId(),
    startAt: now.toISOString(),
    endAt: endDay ? dayStart(addDays(endDay, 1)).toISOString() : null,
    endDay,
    createdAt: now.toISOString(),
  };
  return done([put('hibernations', h)], undefined);
}

/** Schedules hibernation from 4 AM on a future day. There's no backdating: the start is tomorrow at the earliest. */
export function scheduleHibernation(state: AppState, startDay: string, endDay: string | null, now: Date): ActionResult {
  checkNoneCurrent(state, now);
  if (startDay <= dayKeyOf(now)) throw new ActionError('Pick a start day from tomorrow on. To start today, use Start now.');
  checkEndDay(endDay, startDay);
  const h: Hibernation = {
    id: newId(),
    startAt: dayStart(startDay).toISOString(),
    endAt: endDay ? dayStart(addDays(endDay, 1)).toISOString() : null,
    endDay,
    createdAt: now.toISOString(),
  };
  return done([put('hibernations', h)], undefined);
}

/** Cancels a scheduled hibernation that hasn't started. */
export function cancelHibernation(state: AppState, id: string, now: Date): ActionResult {
  const h = state.hibernations.get(id);
  if (!h) throw new ActionError('That hibernation no longer exists.');
  if (h.startAt <= now.toISOString()) throw new ActionError('It has already started. Wake up instead.');
  return done([{ store: 'hibernations', op: 'delete', id }], undefined);
}

export function wakeUp(state: AppState, now: Date): ActionResult {
  const h = activeHibernation(state, now);
  if (!h) throw new ActionError('You’re not hibernating.');
  return done([put('hibernations', { ...h, endAt: now.toISOString() })], undefined);
}
