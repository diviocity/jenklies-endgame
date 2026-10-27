import { eventShards, eventSparks, MONUMENTAL } from '../config';
import type { AppState, BossFight, BossWeek, Change, FocusWindow, LedgerEntry, MonumentalState } from '../types';
import { ActionError, done, type ActionResult } from './errors';
import { activeHibernation, isHibernatedDay, requireAwake } from './hibernation';
import { newId } from './ids';
import { put, withChanges } from './state';
import { addDays, dayKeyOf, weekdayOf, weekKeyOf } from './time';

// Monumental Works: focused work as a weekly boss fight. Long, unbroken stretches hit harder,
// and the boss gets tougher as you win.

export const MONUMENTAL_ID = 'monumental';
const MINUTE = 60_000;

export function monumental(state: AppState): MonumentalState | undefined {
  return state.monumental.get(MONUMENTAL_ID);
}

export function bossOf(index: number) {
  return MONUMENTAL.tiers[index];
}

// ---------------------------------------------------------------- windows and damage

export function runningWindow(state: AppState): FocusWindow | null {
  return [...state.focusWindows.values()].find((w) => w.endAt === null) ?? null;
}

/** When a window ends: its end, or now while running; never more than the cap after it started. */
function windowEnd(w: FocusWindow, now: Date): number {
  const end = w.endAt ? Date.parse(w.endAt) : now.getTime();
  return Math.min(end, Date.parse(w.startAt) + MONUMENTAL.maxWindowMinutes * MINUTE);
}

/** Whole focused minutes, capped at 3 hours. */
export function windowMinutes(w: FocusWindow, now: Date): number {
  return Math.max(0, Math.floor((windowEnd(w, now) - Date.parse(w.startAt)) / MINUTE));
}

export interface WindowDamage {
  window: FocusWindow;
  minutes: number;
  /** Position in its chain (0 = the first window). */
  chain: number;
  short: boolean;
  crit: boolean;
  multiplier: number;
  damage: number;
  /** When it ended (or now, while running). */
  endsAt: number;
}

/**
 * Damage for a week's windows, in order. Short windows deal half; windows that start within
 * 15 minutes of the previous one's end continue a chain (1×, 1.25×, then 1.5×); a window of
 * 90 minutes or more is a deep-focus crit (+25%). The multipliers combine.
 */
export function windowDamage(windows: FocusWindow[], now: Date): WindowDamage[] {
  const sorted = [...windows].sort((a, b) => (a.startAt < b.startAt ? -1 : 1));
  const out: WindowDamage[] = [];
  for (const w of sorted) {
    const prev = out[out.length - 1];
    const gap = prev ? (Date.parse(w.startAt) - prev.endsAt) / MINUTE : Infinity;
    const chain = prev && gap >= 0 && gap <= MONUMENTAL.chainGapMinutes ? prev.chain + 1 : 0;
    const minutes = windowMinutes(w, now);
    const short = minutes < MONUMENTAL.shortMinutes;
    const crit = minutes >= MONUMENTAL.critMinutes;
    const chainMult = MONUMENTAL.chainMultipliers[Math.min(chain, MONUMENTAL.chainMultipliers.length - 1)];
    const multiplier = chainMult * (short ? MONUMENTAL.shortMultiplier : 1) * (crit ? 1 + MONUMENTAL.critBonus : 1);
    out.push({ window: w, minutes, chain, short, crit, multiplier, damage: Math.round(minutes * multiplier), endsAt: windowEnd(w, now) });
  }
  return out;
}

export function weekWindows(state: AppState, weekKey: string): FocusWindow[] {
  return [...state.focusWindows.values()].filter((w) => w.weekKey === weekKey);
}

// ---------------------------------------------------------------- the boss

const WORKDAYS = (weekKey: string) => [0, 1, 2, 3, 4].map((i) => addDays(weekKey, i));

export function isDayOff(state: AppState, dayKey: string): boolean {
  return state.daysOff.has(dayKey);
}

export interface BossHp {
  /** Full HP for the tier. */
  max: number;
  /** HP after prorating by active workdays. */
  hp: number;
  activeWorkdays: number;
  hibernatedWorkdays: number;
  daysOff: number;
  /** Mostly hibernated (or no active workdays left): no result, no ladder change. */
  skipped: boolean;
}

/** A week's boss HP: tier hours × 60, prorated by active workdays (Mon–Fri, not off, not hibernated) ÷ 5. */
export function bossHp(state: AppState, fight: BossFight, now: Date): BossHp {
  const max = MONUMENTAL.tiers[fight.boss].hours * 60;
  let hibernated = 0;
  let off = 0;
  for (const d of WORKDAYS(fight.weekKey)) {
    if (isHibernatedDay(state, d, now)) hibernated++;
    else if (isDayOff(state, d)) off++;
  }
  const active = 5 - hibernated - off;
  const skipped = hibernated >= MONUMENTAL.skipHibernatedWorkdays || active <= 0;
  return { max, hp: skipped ? 0 : Math.round((max * active) / 5), activeWorkdays: active, hibernatedWorkdays: hibernated, daysOff: off, skipped };
}

export interface FightStatus {
  fight: BossFight;
  name: string;
  flavor: string;
  hp: BossHp;
  /** Damage from ended windows, and the running window's pending damage. */
  damage: number;
  pending: number;
  /** When the boss fell (null if it hasn't). */
  defeatedAt: string | null;
  /** Today's assault marker: a fifth of HP. Display only. */
  todayTarget: number;
  todayDamage: number;
  windows: WindowDamage[];
}

export function fightStatus(state: AppState, fight: BossFight, now: Date): FightStatus {
  const hp = bossHp(state, fight, now);
  const windows = windowDamage(weekWindows(state, fight.weekKey), now);
  const today = dayKeyOf(now);
  let damage = 0;
  let pending = 0;
  let todayDamage = 0;
  let defeatedAt: string | null = null;
  for (const w of [...windows].sort((a, b) => a.endsAt - b.endsAt)) {
    if (w.window.endAt === null) {
      pending += w.damage;
      if (w.window.dayKey === today) todayDamage += w.damage;
      continue;
    }
    damage += w.damage;
    if (w.window.dayKey === today) todayDamage += w.damage;
    if (!defeatedAt && hp.hp > 0 && damage >= hp.hp) defeatedAt = new Date(w.endsAt).toISOString();
  }
  const boss = bossOf(fight.boss);
  return { fight, name: boss.name, flavor: boss.flavor, hp, damage, pending, defeatedAt, todayTarget: Math.round(hp.hp / 5), todayDamage, windows };
}

/** This week's fight, if there's a boss yet. */
export function currentFight(state: AppState, now: Date): FightStatus | null {
  const m = monumental(state);
  if (!m?.fight || m.fight.weekKey !== weekKeyOf(dayKeyOf(now))) return null;
  return fightStatus(state, m.fight, now);
}

// ---------------------------------------------------------------- rewards and the ladder

/** The full reward for defeating a tier (unscaled). */
export function defeatReward(tier: number): { sparks: number; shards: number } {
  const d = MONUMENTAL.defeat;
  return { sparks: d.sparks + d.sparksPerTier * (tier - 1), shards: d.shards + Math.floor((tier - 1) / d.shardsEveryTiers) };
}

/** What a week pays: the defeat reward (+ overkill), part of it for a close escape, or nothing. Scaled by the event multiplier. */
export function weekReward(tier: number, hp: number, damage: number): { sparks: number; shards: number; result: 'defeated' | 'escaped' } {
  const full = defeatReward(tier);
  const share = hp > 0 ? damage / hp : 0;
  if (hp > 0 && damage >= hp) {
    const over = share >= MONUMENTAL.overkill.share;
    return {
      sparks: eventSparks(full.sparks) + (over ? eventSparks(MONUMENTAL.overkill.sparks) : 0),
      shards: eventShards(full.shards) + (over ? eventShards(MONUMENTAL.overkill.shards) : 0),
      result: 'defeated',
    };
  }
  const part = MONUMENTAL.partial.find((p) => share >= p.share);
  return {
    sparks: part ? eventSparks(full.sparks * part.fraction) : 0,
    shards: part ? eventShards(full.shards * part.fraction) : 0,
    result: 'escaped',
  };
}

/** The ladder after a week: a defeat climbs a tier, two escapes in a row drop one, a skipped week changes nothing. */
export function climb(tier: number, escapes: number, result: BossWeek['result']): { tier: number; escapes: number } {
  if (result === 'skipped') return { tier, escapes };
  if (result === 'defeated') return { tier: Math.min(MONUMENTAL.tiers.length, tier + 1), escapes: 0 };
  if (escapes + 1 >= 2) return { tier: Math.max(1, tier - 1), escapes: 0 };
  return { tier, escapes: escapes + 1 };
}

function spawn(tier: number, weekKey: string): BossFight {
  return { weekKey, tier, boss: tier - 1 };
}

/**
 * Starts the event if needed, ends a window left running into hibernation, and runs every
 * weekly reset that's due: settles the week's boss, pays its reward, moves the ladder and
 * brings in the next boss. The first boss arrives at the first reset after the event starts.
 */
export function ensureMonumental(state: AppState, now: Date): Change[] {
  const thisWeek = weekKeyOf(dayKeyOf(now));
  const changes: Change[] = [];
  // A window can't run through hibernation: it ends when hibernation started.
  const running = runningWindow(state);
  const asleep = activeHibernation(state, now);
  if (running && asleep) {
    const end = Math.max(Date.parse(running.startAt), Math.min(Date.parse(asleep.startAt), Date.parse(running.startAt) + MONUMENTAL.maxWindowMinutes * MINUTE));
    changes.push(put('focusWindows', { ...running, endAt: new Date(end).toISOString() }));
  }
  const existing = monumental(state);
  if (!existing) {
    changes.push(put('monumental', { id: MONUMENTAL_ID, startedWeek: thisWeek, currentWeek: thisWeek, tier: 1, escapes: 0, fight: null }));
    return changes;
  }
  if (existing.currentWeek >= thisWeek) return changes;

  const view = withChanges(state, changes);
  const at = now.toISOString();
  let { tier, escapes, fight } = existing;
  let week = existing.currentWeek;
  while (week < thisWeek) {
    if (fight && fight.weekKey === week) {
      // Windows still running at the reset count up to now (capped), like any other.
      const status = fightStatus(view, fight, now);
      const skipped = status.hp.skipped;
      const reward = skipped ? { sparks: 0, shards: 0, result: 'skipped' as const } : weekReward(fight.tier, status.hp.hp, status.damage + status.pending);
      const result = skipped ? 'skipped' : reward.result;
      const next = climb(tier, escapes, result);
      const record: BossWeek = {
        id: week,
        tier: fight.tier,
        boss: fight.boss,
        hp: status.hp.hp,
        damage: status.damage + status.pending,
        result,
        defeatedAt: status.defeatedAt ?? (result === 'defeated' ? at : null),
        nextTier: next.tier,
        rewardSparks: reward.sparks,
        rewardShards: reward.shards,
        closedAt: at,
        seen: skipped,
      };
      changes.push(put('bossWeeks', record));
      const note = `Monumental Works: ${bossOf(fight.boss).name} ${result === 'defeated' ? 'defeated' : 'escaped'} (week of ${week})`;
      const base = { at, reason: 'monumental_weekly' as const, note };
      if (reward.sparks) changes.push(put('ledger', { id: newId(), ...base, currency: 'sparks', amount: reward.sparks } as LedgerEntry));
      if (reward.shards) changes.push(put('ledger', { id: newId(), ...base, currency: 'shards', amount: reward.shards } as LedgerEntry));
      tier = next.tier;
      escapes = next.escapes;
    }
    week = addDays(week, 7);
    fight = spawn(tier, week);
  }
  changes.push(put('monumental', { ...existing, currentWeek: thisWeek, tier, escapes, fight }));
  return changes;
}

/** Closed weeks whose result hasn't been shown in a weekly report yet. */
export function unseenBossWeeks(state: AppState): BossWeek[] {
  return [...state.bossWeeks.values()].filter((w) => !w.seen).sort((a, b) => (a.id < b.id ? -1 : 1));
}

// ---------------------------------------------------------------- logging focus

function requireNotOff(state: AppState, dayKey: string): void {
  if (isDayOff(state, dayKey)) throw new ActionError('That’s marked as a day off. Cancel it first to log focus.');
}

export function startFocus(state: AppState, planned: number | null, now: Date): ActionResult<{ id: string }> {
  requireAwake(state, now, 'log focus');
  if (runningWindow(state)) throw new ActionError('A focus window is already running.');
  const dayKey = dayKeyOf(now);
  requireNotOff(state, dayKey);
  if (planned !== null && !(planned > 0)) throw new ActionError('Pick a planned length, or none.');
  const w: FocusWindow = { id: newId(), startAt: now.toISOString(), endAt: null, dayKey, weekKey: weekKeyOf(dayKey), planned, source: 'live' };
  return done([put('focusWindows', w)], { id: w.id });
}

/** Whether the running window is past the cap, so ending it needs to know when you stopped. */
export function needsStopTime(w: FocusWindow, now: Date): boolean {
  return now.getTime() - Date.parse(w.startAt) > MONUMENTAL.maxWindowMinutes * MINUTE;
}

/**
 * Ends the running window, now or at `stoppedAt` (for a forgotten End). Past the 3-hour cap a
 * stop time is required, and it's clamped to the window's start and cap.
 */
export function endFocus(state: AppState, now: Date, stoppedAt?: Date): ActionResult<{ minutes: number }> {
  const w = runningWindow(state);
  if (!w) throw new ActionError('No focus window is running.');
  if (!stoppedAt && needsStopTime(w, now)) throw new ActionError('This window ran past 3 hours. When did you stop?');
  const start = Date.parse(w.startAt);
  const latest = Math.min(now.getTime(), start + MONUMENTAL.maxWindowMinutes * MINUTE);
  const end = Math.max(start, Math.min(stoppedAt ? stoppedAt.getTime() : now.getTime(), latest));
  const ended = { ...w, endAt: new Date(end).toISOString() };
  return done([put('focusWindows', ended)], { minutes: windowMinutes(ended, now) });
}

/** Checks a window added or adjusted by hand: today only, finished, at most 3 hours, not overlapping another. */
function checkManual(state: AppState, start: Date, end: Date, now: Date, ignoreId?: string): string {
  const dayKey = dayKeyOf(start);
  if (dayKey !== dayKeyOf(now)) throw new ActionError('Windows can only be added or adjusted for today.');
  if (end.getTime() <= start.getTime()) throw new ActionError('The end has to be after the start.');
  if (end.getTime() > now.getTime()) throw new ActionError('The end can’t be in the future.');
  if (end.getTime() - start.getTime() > MONUMENTAL.maxWindowMinutes * MINUTE) throw new ActionError('A window can be at most 3 hours.');
  requireNotOff(state, dayKey);
  for (const other of state.focusWindows.values()) {
    if (other.id === ignoreId) continue;
    const s = Date.parse(other.startAt);
    const e = other.endAt ? Date.parse(other.endAt) : now.getTime();
    if (start.getTime() < e && end.getTime() > s) throw new ActionError('That overlaps another focus window.');
  }
  return dayKey;
}

/** Adds a window you forgot to start (today only). */
export function addWindow(state: AppState, start: Date, end: Date, now: Date): ActionResult {
  requireAwake(state, now, 'log focus');
  const dayKey = checkManual(state, start, end, now);
  const w: FocusWindow = { id: newId(), startAt: start.toISOString(), endAt: end.toISOString(), dayKey, weekKey: weekKeyOf(dayKey), planned: null, source: 'manual' };
  return done([put('focusWindows', w)], undefined);
}

/** Adjusts one of today's finished windows. */
export function editWindow(state: AppState, id: string, start: Date, end: Date, now: Date): ActionResult {
  const w = state.focusWindows.get(id);
  if (!w) throw new ActionError('That window no longer exists.');
  if (w.endAt === null) throw new ActionError('End the window first.');
  if (w.dayKey !== dayKeyOf(now)) throw new ActionError('Only today’s windows can be adjusted.');
  requireAwake(state, now, 'log focus');
  const dayKey = checkManual(state, start, end, now, id);
  return done([put('focusWindows', { ...w, startAt: start.toISOString(), endAt: end.toISOString(), dayKey, weekKey: weekKeyOf(dayKey) })], undefined);
}

export function deleteWindow(state: AppState, id: string, now: Date): ActionResult {
  const w = state.focusWindows.get(id);
  if (!w) throw new ActionError('That window no longer exists.');
  if (w.dayKey !== dayKeyOf(now)) throw new ActionError('Only today’s windows can be deleted.');
  return done([{ store: 'focusWindows', op: 'delete', id }], undefined);
}

// ---------------------------------------------------------------- days off

/** Marks a workday off, today or ahead. Not on a day with focus already logged. */
export function setDayOff(state: AppState, dayKey: string, now: Date): ActionResult {
  const weekday = weekdayOf(dayKey);
  if (weekday === 0 || weekday === 6) throw new ActionError('Days off are for workdays (Monday to Friday).');
  if (dayKey < dayKeyOf(now)) throw new ActionError('Days off can be marked for today or later.');
  if (isDayOff(state, dayKey)) throw new ActionError('That day is already off.');
  if ([...state.focusWindows.values()].some((w) => w.dayKey === dayKey)) {
    throw new ActionError('You’ve already logged focus that day, so it can’t be a day off.');
  }
  return done([put('daysOff', { id: dayKey, createdAt: now.toISOString() })], undefined);
}

/** Cancels a day off that hasn't passed. */
export function cancelDayOff(state: AppState, dayKey: string, now: Date): ActionResult {
  if (!isDayOff(state, dayKey)) throw new ActionError('That day isn’t off.');
  if (dayKey < dayKeyOf(now)) throw new ActionError('Past days off stay in the log.');
  return done([{ store: 'daysOff', op: 'delete', id: dayKey }], undefined);
}
