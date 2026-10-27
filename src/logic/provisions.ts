import { HIBERNATION, PROVISIONS } from '../config';
import type {
  AppState,
  Change,
  DayRecord,
  DayTask,
  LedgerEntry,
  MealRating,
  PrepKind,
  PrepLog,
  ProvisionsState,
  ProvisionsWeek,
  Stamp,
  SupplyStatus,
} from '../types';
import { ActionError, done, type ActionResult } from './errors';
import { activeDaysBetween, hibernatedDaysInWeek, isHibernatedDay, isHibernating, isSkippedWeek, requireAwake } from './hibernation';
import { newId } from './ids';
import { balances, getMeta, put, withChanges } from './state';
import { addDays, bucketDayType, dayKeyOf, dayTypeOf, deadlineAt, weekKeyOf, weekdayOf } from './time';

// Contingency Provisions: eating right consistently, built around the two keystone habits
// of shopping and cooking. Meals earn stamps; the week's supply line (both prep steps
// logged) decides whether they count double, count, or are held.

export const PROVISIONS_ID = 'provisions';

export function provisions(state: AppState): ProvisionsState | undefined {
  return state.provisions.get(PROVISIONS_ID);
}

/** 4 AM on a week's Monday: its reset. */
function weekStart(weekKey: string): Date {
  return deadlineAt(weekKey, 4 * 60);
}

// ---------------------------------------------------------------- prep and the supply line

/** The week a prep log supplies: Friday–Sunday logs supply the next week, Monday–Thursday the current one. */
export function supplyWeekOf(dayKey: string): string {
  const week = weekKeyOf(dayKey);
  return PROVISIONS.nextWeekDays.includes(weekdayOf(dayKey)) ? addDays(week, 7) : week;
}

export interface Supply {
  status: SupplyStatus;
  /** The first shopping and cooking logs for the week (null if missing). */
  shopping: PrepLog | null;
  cooking: PrepLog | null;
  /** When both were in. */
  upAt: string | null;
}

/** A week's supply line: up on time (both before its reset), up late (during the week) or down. */
export function supplyFor(state: AppState, weekKey: string): Supply {
  const logs = [...state.prepLogs.values()].filter((l) => l.weekKey === weekKey).sort((a, b) => (a.at < b.at ? -1 : 1));
  const shopping = logs.find((l) => l.kind === 'shopping') ?? null;
  const cooking = logs.find((l) => l.kind === 'cooking') ?? null;
  if (!shopping || !cooking) return { status: 'down', shopping, cooking, upAt: null };
  const upAt = shopping.at > cooking.at ? shopping.at : cooking.at;
  return { status: upAt < weekStart(weekKey).toISOString() ? 'onTime' : 'late', shopping, cooking, upAt };
}

function prepLog(kind: PrepKind, at: Date, source: PrepLog['source'], taskId?: string, dayKey = dayKeyOf(at)): PrepLog {
  const log: PrepLog = { id: newId(), at: at.toISOString(), dayKey, kind, weekKey: supplyWeekOf(dayKey), source };
  if (taskId) log.taskId = taskId;
  return log;
}

/** The prep log a tagged task logs when it's checked off. */
export function taskPrepLog(day: DayRecord, task: DayTask, at: string): PrepLog | null {
  return task.prep ? prepLog(task.prep, new Date(at), 'task', task.id, day.id) : null;
}

export function taskPrepLogs(state: AppState, dayKey: string, taskId: string): PrepLog[] {
  return [...state.prepLogs.values()].filter((l) => l.dayKey === dayKey && l.taskId === taskId);
}

// ---------------------------------------------------------------- stamps

/** The stamp an on-plan meal earns. */
export function mealStamp(day: DayRecord, task: DayTask, rating: MealRating, at: string): Stamp | null {
  if (!task.meal || rating !== 'on') return null;
  return { id: newId(), taskId: task.id, dayKey: day.id, weekKey: weekKeyOf(day.id), at };
}

export function taskStamps(state: AppState, dayKey: string, taskId: string): Stamp[] {
  return [...state.stamps.values()].filter((s) => s.dayKey === dayKey && s.taskId === taskId);
}

/** Whether a stamp counts now, and for how much. In an open week it follows the supply line; held stamps don't count yet. */
export function stampWorth(state: AppState, stamp: Stamp): { counted: boolean; value: number } {
  if (stamp.status) return { counted: stamp.status === 'counted', value: stamp.value ?? 0 };
  const supply = supplyFor(state, stamp.weekKey).status;
  if (supply === 'onTime') return { counted: true, value: PROVISIONS.onTimeMultiplier };
  if (supply === 'late') return { counted: true, value: 1 };
  return { counted: false, value: 1 };
}

export interface CardProgress {
  /** Stamp value counted, lifetime. */
  counted: number;
  /** Stamps held in open weeks (supply line down). */
  held: number;
  /** Cards the counted stamps fill. */
  cards: number;
  /** Stamps on the current card. */
  onCard: number;
}

export function cardProgress(state: AppState): CardProgress {
  let counted = 0;
  let held = 0;
  for (const s of state.stamps.values()) {
    const worth = stampWorth(state, s);
    if (worth.counted) counted += worth.value;
    else if (!s.status) held += 1;
  }
  const cards = Math.floor(counted / PROVISIONS.stampsPerCard);
  return { counted, held, cards, onCard: counted - cards * PROVISIONS.stampsPerCard };
}

function ledger(entry: Omit<LedgerEntry, 'id'>): Change {
  return put('ledger', { id: newId(), ...entry });
}

/**
 * Pays for cards the counted stamps now fill, or takes back cards a same-day change unfilled.
 * Cards wait while hibernating (they're paid on waking); take-backs never wait.
 */
function cardChanges(view: AppState, now: Date, takeBack: boolean): { changes: Change[]; cards: number } {
  const p = provisions(view);
  if (!p) return { changes: [], cards: 0 };
  const { cards } = cardProgress(view);
  const delta = cards - p.cardsFilled;
  if (delta === 0 || (delta > 0 && isHibernating(view, now)) || (delta < 0 && !takeBack)) return { changes: [], cards: 0 };
  const at = now.toISOString();
  const changes: Change[] = [];
  for (let i = 0; i < Math.abs(delta); i++) {
    const n = delta > 0 ? p.cardsFilled + i + 1 : p.cardsFilled - i;
    const sign = delta > 0 ? 1 : -1;
    const reason = delta > 0 ? ('provisions_card' as const) : ('undo' as const);
    const note = `${delta > 0 ? '' : 'Undo: '}Contingency Provisions: card ${n} filled`;
    changes.push(ledger({ at, currency: 'sparks', amount: sign * PROVISIONS.card.sparks, reason, note }));
    changes.push(ledger({ at, currency: 'shards', amount: sign * PROVISIONS.card.shards, reason, note }));
  }
  changes.push(put('provisions', { ...p, cardsFilled: cards }));
  return { changes, cards: delta };
}

/**
 * Adds the card payments (or take-backs) that `changes` cause. Refuses if a take-back
 * would need Sparks or Shards that have already been spent.
 */
export function settleProvisions(state: AppState, changes: Change[], now: Date): { changes: Change[]; cards: number } {
  const cards = cardChanges(withChanges(state, changes), now, true);
  const all = [...changes, ...cards.changes];
  if (cards.cards < 0) {
    const after = balances(withChanges(state, all));
    if (after.sparks < 0 || after.shards < 0) {
      const { sparksName, shardsName } = getMeta(state).settings;
      throw new ActionError(
        `This would unfill a card and take back ${PROVISIONS.card.sparks} ${sparksName} and ${PROVISIONS.card.shards} ${shardsName}, but they've already been spent.`,
      );
    }
  }
  return { changes: all, cards: cards.cards };
}

// ---------------------------------------------------------------- meals and the ration report

/** Meals scheduled on a day: from its snapshot when the app saw it, otherwise from the template. */
function mealsOn(state: AppState, dayKey: string): { scheduled: number; onPlan: number } {
  const day = state.days.get(dayKey);
  if (day) {
    const meals = day.tasks.filter((t) => t.meal);
    return { scheduled: meals.length, onPlan: meals.filter((t) => t.completedAt && (t.mealRating ?? 'on') === 'on').length };
  }
  const weekday = weekdayOf(dayKey);
  const type = dayTypeOf(dayKey);
  const scheduled = [...state.templateTasks.values()].filter((t) => t.meal && t.days.includes(weekday) && bucketDayType(t.bucket) === type).length;
  return { scheduled, onPlan: 0 };
}

/** A week's meals on active days (hibernated days and days before the event started don't count), up to `lastDay`. */
export function weekMeals(state: AppState, weekKey: string, now: Date, lastDay = addDays(weekKey, 6)): { scheduled: number; onPlan: number } {
  const started = provisions(state)?.startedDay ?? weekKey;
  let scheduled = 0;
  let onPlan = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekKey, i);
    if (d < started || d > lastDay || isHibernatedDay(state, d, now)) continue;
    const m = mealsOn(state, d);
    scheduled += m.scheduled;
    onPlan += m.onPlan;
  }
  return { scheduled, onPlan };
}

export function rationEarned(meals: { scheduled: number; onPlan: number }, supply: SupplyStatus): boolean {
  return supply !== 'down' && meals.scheduled > 0 && meals.onPlan / meals.scheduled >= PROVISIONS.ration.share;
}

// ---------------------------------------------------------------- weekly reset

/**
 * Starts the event if needed and closes every week that's due: settles its stamps (counted,
 * doubled or expired), pays its ration report, and pays any cards filled.
 */
export function ensureProvisions(state: AppState, now: Date): Change[] {
  const thisWeek = weekKeyOf(dayKeyOf(now));
  const existing = provisions(state);
  if (!existing) {
    return [put('provisions', { id: PROVISIONS_ID, startedDay: dayKeyOf(now), currentWeek: thisWeek, cardsFilled: 0 })];
  }
  const changes: Change[] = [];
  const at = now.toISOString();
  let week = existing.currentWeek;
  while (week < thisWeek) {
    const hibernatedDays = hibernatedDaysInWeek(state, week, now);
    const skipped = hibernatedDays >= HIBERNATION.skipWeekDays;
    const supply = supplyFor(state, week);
    let stamps = 0;
    let expired = 0;
    for (const s of state.stamps.values()) {
      if (s.weekKey !== week || s.status) continue;
      // A mostly hibernated week skips the supply check: its held stamps count instead of expiring.
      const worth = skipped ? { counted: true, value: 1 } : stampWorth(state, s);
      if (worth.counted) stamps += worth.value;
      else expired++;
      changes.push(put('stamps', { ...s, status: worth.counted ? 'counted' : 'expired', value: worth.counted ? worth.value : 0 }));
    }
    const meals = weekMeals(state, week, now);
    const ration = !skipped && rationEarned(meals, supply.status);
    const record: ProvisionsWeek = {
      id: week,
      supply: skipped ? 'skipped' : supply.status,
      upAt: supply.upAt,
      hibernatedDays,
      scheduled: meals.scheduled,
      onPlan: meals.onPlan,
      stamps,
      expired,
      rationSparks: ration ? PROVISIONS.ration.sparks : 0,
      rationShards: ration ? PROVISIONS.ration.shards : 0,
      closedAt: at,
      // Nothing to report for a skipped week or one with no meals.
      seen: skipped || meals.scheduled === 0,
    };
    changes.push(put('provisionWeeks', record));
    if (ration) {
      const note = `Contingency Provisions: ration report (week of ${week})`;
      changes.push(ledger({ at, currency: 'sparks', amount: PROVISIONS.ration.sparks, reason: 'provisions_ration', note }));
      changes.push(ledger({ at, currency: 'shards', amount: PROVISIONS.ration.shards, reason: 'provisions_ration', note }));
    }
    week = addDays(week, 7);
  }
  if (existing.currentWeek < thisWeek) changes.push(put('provisions', { ...existing, currentWeek: thisWeek }));
  // Cards filled by stamps released at a reset, or waiting for you to wake up.
  changes.push(...cardChanges(withChanges(state, changes), now, false).changes);
  return changes;
}

/** Closed weeks whose result hasn't been shown in a weekly report yet. */
export function unseenProvisionWeeks(state: AppState): ProvisionsWeek[] {
  return [...state.provisionWeeks.values()].filter((w) => !w.seen).sort((a, b) => (a.id < b.id ? -1 : 1));
}

// ---------------------------------------------------------------- logging prep by hand

/** "I shopped" / "I cooked": logs a prep step today, for whichever week today supplies. */
export function logPrep(state: AppState, kind: PrepKind, now: Date): ActionResult<{ weekKey: string; cards: number }> {
  requireAwake(state, now, 'log prep');
  const log = prepLog(kind, now, 'manual');
  const settled = settleProvisions(state, [put('prepLogs', log)], now);
  return done(settled.changes, { weekKey: log.weekKey, cards: settled.cards });
}

/** Undoes a prep step logged by hand today. Tagged tasks are undone on Today. */
export function undoPrep(state: AppState, id: string, now: Date): ActionResult {
  const log = state.prepLogs.get(id);
  if (!log) throw new ActionError('That log no longer exists.');
  if (log.source !== 'manual') throw new ActionError('Undo the task on Today instead.');
  if (log.dayKey !== dayKeyOf(now)) throw new ActionError('Only today’s logs can be undone.');
  return done(settleProvisions(state, [{ store: 'prepLogs', op: 'delete', id }], now).changes, undefined);
}

// ---------------------------------------------------------------- the screen

export interface ProvisionsAlert {
  /** This week's supply line is down (and it counts: not hibernating, not a skipped week). */
  down: boolean;
  supply: Supply;
  /** Shopping logged a while ago with no cooking since, for a week still to come or this one. */
  spoiling: PrepLog | null;
}

export function provisionsAlert(state: AppState, now: Date): ProvisionsAlert {
  const today = dayKeyOf(now);
  const thisWeek = weekKeyOf(today);
  const supply = supplyFor(state, thisWeek);
  const paused = isHibernating(state, now) || isSkippedWeek(state, thisWeek, now);
  const usesMeals = [...state.templateTasks.values()].some((t) => t.meal);
  let spoiling: PrepLog | null = null;
  for (const week of [thisWeek, addDays(thisWeek, 7)]) {
    const s = supplyFor(state, week);
    if (s.shopping && !s.cooking && activeDaysBetween(state, s.shopping.dayKey, today, now) > PROVISIONS.spoilageDays) spoiling = s.shopping;
  }
  return { down: usesMeals && !paused && supply.status === 'down', supply, spoiling: paused ? null : spoiling };
}
