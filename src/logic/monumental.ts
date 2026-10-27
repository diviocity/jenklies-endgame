import { eventShards, eventSparks, MONUMENTAL } from '../config';
import type { AgonyModifier, AppState, BossFight, BossWeek, Change, FocusWindow, LedgerEntry, MonumentalState } from '../types';
import { ActionError, done, type ActionResult } from './errors';
import { frontier } from './event';
import { activeHibernation, isHibernatedDay, requireAwake } from './hibernation';
import { newId } from './ids';
import { put, withChanges } from './state';
import { addDays, dayKeyOf, deadlineAt, weekdayOf, weekKeyOf } from './time';

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

export function modifierOf(id: string | null | undefined): AgonyModifier | null {
  return MONUMENTAL.modifiers.find((m) => m.id === id) ?? null;
}

/** The chain multiplier for a window's position in its chain (capped by a modifier, if any). */
export function chainMultiplier(chain: number, mod: AgonyModifier | null = null): number {
  const m = MONUMENTAL.chainMultipliers[Math.min(chain, MONUMENTAL.chainMultipliers.length - 1)];
  return mod?.chainCap !== undefined ? Math.min(m, mod.chainCap) : m;
}

/**
 * Damage for a week's windows, in order. Short windows deal half; windows that start within
 * 15 minutes of the previous one's end continue a chain (1×, 1.25×, then 1.5×); a window of
 * 90 minutes or more is a deep-focus crit (+25%). The multipliers combine. An Agony modifier
 * can change these rules.
 */
export function windowDamage(windows: FocusWindow[], now: Date, mod: AgonyModifier | null = null): WindowDamage[] {
  const gapLimit = mod?.chainGapMinutes ?? MONUMENTAL.chainGapMinutes;
  const critBonus = mod?.critBonus ?? MONUMENTAL.critBonus;
  const sorted = [...windows].sort((a, b) => (a.startAt < b.startAt ? -1 : 1));
  const out: WindowDamage[] = [];
  for (const w of sorted) {
    const prev = out[out.length - 1];
    const gap = prev ? (Date.parse(w.startAt) - prev.endsAt) / MINUTE : Infinity;
    const chain = prev && gap >= 0 && gap <= gapLimit ? prev.chain + 1 : 0;
    const minutes = windowMinutes(w, now);
    const short = minutes < MONUMENTAL.shortMinutes;
    const crit = minutes >= MONUMENTAL.critMinutes;
    const blocked = mod?.minWindowMinutes !== undefined && minutes < mod.minWindowMinutes;
    const multiplier = blocked ? 0 : chainMultiplier(chain, mod) * (short ? MONUMENTAL.shortMultiplier : 1) * (crit ? 1 + critBonus : 1);
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

/** A boss's name: "Agony Lethargos" for an Agony variant. */
export function bossName(boss: number, agony = false): string {
  return `${agony ? 'Agony ' : ''}${MONUMENTAL.tiers[boss].name}`;
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

/** A week's boss HP: tier hours × 60 (25 hours in Agony), prorated by active workdays (Mon–Fri, not off, not hibernated) ÷ 5. */
export function bossHp(state: AppState, fight: BossFight, now: Date): BossHp {
  const hours = fight.agony ? MONUMENTAL.agony.hours : MONUMENTAL.tiers[fight.boss].hours;
  const max = Math.round(hours * 60 * (modifierOf(fight.modifier)?.hpMultiplier ?? 1));
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
  modifier: AgonyModifier | null;
  hp: BossHp;
  /** Damage that counts against HP (after any healing), and the running window's pending damage. */
  damage: number;
  pending: number;
  /** HP a Regenerating boss has healed. */
  healed: number;
  /** When the boss fell (null if it hasn't). */
  defeatedAt: string | null;
  /** Today's assault marker: a fifth of HP. Display only. */
  todayTarget: number;
  todayDamage: number;
  windows: WindowDamage[];
}

export function fightStatus(state: AppState, fight: BossFight, now: Date): FightStatus {
  const hp = bossHp(state, fight, now);
  const mod = modifierOf(fight.modifier);
  const windows = windowDamage(weekWindows(state, fight.weekKey), now, mod);
  const today = dayKeyOf(now);
  // A timeline of hits (windows ending) and heals (a Regenerating boss at each quiet workday's rollover).
  type Event = { at: number; damage: number; heal: number };
  const events: Event[] = [];
  let pending = 0;
  let todayDamage = 0;
  for (const w of windows) {
    if (w.window.dayKey === today) todayDamage += w.damage;
    if (w.window.endAt === null) pending += w.damage;
    else events.push({ at: w.endsAt, damage: w.damage, heal: 0 });
  }
  if (mod?.regen) {
    for (const d of WORKDAYS(fight.weekKey)) {
      const rollover = deadlineAt(addDays(d, 1), 4 * 60).getTime();
      if (rollover > now.getTime() || isDayOff(state, d) || isHibernatedDay(state, d, now)) continue;
      const dealt = windows.filter((w) => w.window.dayKey === d && w.window.endAt !== null).reduce((sum, w) => sum + w.damage, 0);
      if (dealt < mod.regen.minDamage) events.push({ at: rollover, damage: 0, heal: Math.round(hp.max * mod.regen.healShare) });
    }
  }
  let damage = 0;
  let healed = 0;
  let defeatedAt: string | null = null;
  for (const e of events.sort((a, b) => a.at - b.at)) {
    if (e.heal) {
      // A defeated boss stays down.
      if (defeatedAt) continue;
      const heal = Math.min(e.heal, damage);
      damage -= heal;
      healed += heal;
      continue;
    }
    damage += e.damage;
    if (!defeatedAt && hp.hp > 0 && damage >= hp.hp) defeatedAt = new Date(e.at).toISOString();
  }
  const boss = bossOf(fight.boss);
  return {
    fight,
    name: bossName(fight.boss, fight.agony),
    flavor: boss.flavor,
    modifier: mod,
    hp,
    damage,
    pending,
    healed,
    defeatedAt,
    todayTarget: Math.round(hp.hp / 5),
    todayDamage,
    windows,
  };
}

/** This week's fight, if there's a boss yet. */
export function currentFight(state: AppState, now: Date): FightStatus | null {
  const m = monumental(state);
  if (!m?.fight || m.fight.weekKey !== weekKeyOf(dayKeyOf(now))) return null;
  return fightStatus(state, m.fight, now);
}

// ---------------------------------------------------------------- rewards and the ladder

/** The full reward for defeating a tier (unscaled). Agony (Tier 12) pays its own. */
export function defeatReward(tier: number): { sparks: number; shards: number } {
  if (tier >= MONUMENTAL.agonyTier) return { sparks: MONUMENTAL.agony.sparks, shards: MONUMENTAL.agony.shards };
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

/**
 * The ladder after a week: a defeat climbs a tier (defeating Akrasia opens Agony Mode, Tier 12,
 * which a defeat keeps), two escapes in a row drop one, a skipped week changes nothing.
 */
export function climb(tier: number, escapes: number, result: BossWeek['result']): { tier: number; escapes: number } {
  if (result === 'skipped') return { tier, escapes };
  if (result === 'defeated') return { tier: Math.min(MONUMENTAL.agonyTier, tier + 1), escapes: 0 };
  if (escapes + 1 >= 2) return { tier: Math.max(1, tier - 1), escapes: 0 };
  return { tier, escapes: escapes + 1 };
}

/** A random pick from 0..n−1, other than `not`. */
function pickOther(n: number, not: number, rng: () => number): number {
  const options = Array.from({ length: n }, (_, i) => i).filter((i) => i !== not);
  return options[Math.floor(rng() * options.length) % options.length];
}

/**
 * The boss for a week. On Tiers 1–11 it's that tier's boss. In Agony Mode it's a random boss
 * from Tiers 1–11 with a random modifier, neither the same as the week before.
 */
export function spawn(tier: number, weekKey: string, previous: BossFight | null, rng: () => number = Math.random): BossFight {
  if (tier < MONUMENTAL.agonyTier) return { weekKey, tier, boss: tier - 1 };
  const prevBoss = previous?.agony ? previous.boss : -1;
  const prevMod = MONUMENTAL.modifiers.findIndex((m) => m.id === (previous?.agony ? previous.modifier : null));
  const boss = pickOther(MONUMENTAL.tiers.length, prevBoss, rng);
  const modifier = MONUMENTAL.modifiers[pickOther(MONUMENTAL.modifiers.length, prevMod, rng)].id;
  return { weekKey, tier, boss, agony: true, modifier };
}

/**
 * Starts the event if needed, ends a window left running into hibernation, and runs every
 * weekly reset that's due: settles the week's boss, pays its reward, moves the ladder, claims
 * any one-time rewards and brings in the next boss. The first boss (Tier 1) starts straight
 * away, at full HP.
 */
export function ensureMonumental(state: AppState, now: Date, rng: () => number = Math.random): Change[] {
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
    // The first boss is there straight away, at full HP however late in the week it is.
    changes.push(put('monumental', { id: MONUMENTAL_ID, startedWeek: thisWeek, currentWeek: thisWeek, tier: 1, escapes: 0, fight: spawn(1, thisWeek, null) }));
    return changes;
  }
  if (existing.currentWeek >= thisWeek) {
    // One-time rewards for results already recorded but not yet claimed.
    const late = claimMilestones(state, existing, [...state.bossWeeks.values()], now);
    if (late.changes.length || late.patch.milestones) changes.push(...late.changes, put('monumental', { ...existing, ...late.patch }));
    return changes;
  }

  const view = withChanges(state, changes);
  const at = now.toISOString();
  const closed: BossWeek[] = [];
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
        ...(fight.agony ? { agony: true, modifier: fight.modifier ?? null } : {}),
        ...(status.healed ? { healed: status.healed } : {}),
      };
      closed.push(record);
      changes.push(put('bossWeeks', record));
      const note = `Monumental Works: ${status.name} ${result === 'defeated' ? 'defeated' : 'escaped'} (week of ${week})`;
      const base = { at, reason: 'monumental_weekly' as const, note };
      if (reward.sparks) changes.push(put('ledger', { id: newId(), ...base, currency: 'sparks', amount: reward.sparks } as LedgerEntry));
      if (reward.shards) changes.push(put('ledger', { id: newId(), ...base, currency: 'shards', amount: reward.shards } as LedgerEntry));
      tier = next.tier;
      escapes = next.escapes;
    }
    week = addDays(week, 7);
    fight = spawn(tier, week, fight, rng);
  }
  const claimed = claimMilestones(view, existing, [...state.bossWeeks.values(), ...closed], now);
  changes.push(...claimed.changes, put('monumental', { ...existing, ...claimed.patch, currentWeek: thisWeek, tier, escapes, fight }));
  return changes;
}

/** Closed weeks whose result hasn't been shown in a weekly report yet. */
export function unseenBossWeeks(state: AppState): BossWeek[] {
  return [...state.bossWeeks.values()].filter((w) => !w.seen).sort((a, b) => (a.id < b.id ? -1 : 1));
}

// ---------------------------------------------------------------- one-time rewards and the Bestiary

export interface WorksMilestone {
  id: string;
  name: string;
  selector: 4 | 5 | null;
  title: string | null;
  theme: string | null;
}

/** The one-time rewards a history of results has earned. */
export function milestonesEarned(weeks: BossWeek[]): WorksMilestone[] {
  const wins = weeks.filter((w) => w.result === 'defeated');
  const out: WorksMilestone[] = [];
  for (const t of MONUMENTAL.firstDefeatSelectors) {
    if (wins.some((w) => !w.agony && w.tier === t)) {
      out.push({ id: `first-${t}`, name: `First Tier ${t} defeat`, selector: 4, title: null, theme: null });
    }
  }
  if (wins.some((w) => !w.agony && w.tier === MONUMENTAL.tiers.length)) {
    const a = MONUMENTAL.akrasia;
    out.push({ id: 'akrasia', name: `First defeat of ${MONUMENTAL.tiers[MONUMENTAL.tiers.length - 1].name}`, selector: a.selector, title: a.title, theme: a.theme });
  }
  const agony = wins.filter((w) => w.agony);
  if (new Set(agony.map((w) => w.boss)).size >= MONUMENTAL.tiers.length) {
    const a = MONUMENTAL.allAgony;
    out.push({ id: 'agony-all', name: 'Every Agony variant defeated', selector: a.selector, title: a.title, theme: null });
  }
  for (let n = MONUMENTAL.agonyVictoriesEvery; n <= agony.length; n += MONUMENTAL.agonyVictoriesEvery) {
    out.push({ id: `agony-${n}`, name: `${n} Agony victories`, selector: 5, title: null, theme: null });
  }
  return out;
}

/** Claims one-time rewards earned and not yet claimed: selectors into the Bag, titles (shown straight away) and the theme. */
function claimMilestones(
  state: AppState,
  m: MonumentalState,
  weeks: BossWeek[],
  now: Date,
): { changes: Change[]; patch: Partial<MonumentalState> } {
  const have = new Set(m.milestones ?? []);
  const due = milestonesEarned(weeks).filter((x) => !have.has(x.id));
  if (due.length === 0) return { changes: [], patch: {} };
  const at = now.toISOString();
  const titles = [...(m.titles ?? [])];
  const themes = [...(m.themes ?? [])];
  const changes: Change[] = [];
  let newest: string | null = null;
  for (const x of due) {
    const source = `Monumental Works: ${x.name}`;
    if (x.selector) changes.push(put('selectors', { id: newId(), rarity: x.selector, source, createdAt: at, usedAt: null, indulgenceId: null, name: null }));
    if (x.title && !titles.includes(x.title)) {
      titles.push(x.title);
      newest = x.title;
    }
    if (x.theme && !themes.includes(x.theme)) themes.push(x.theme);
  }
  const event = frontier(state);
  if (newest && event) changes.push(put('events', { ...event, activeTitle: newest }));
  return { changes, patch: { milestones: [...have, ...due.map((x) => x.id)], titles, themes } };
}

export interface BestiaryEntry {
  boss: number;
  agony: boolean;
  name: string;
  flavor: string;
  defeats: number;
  firstDefeat: string | null;
}

/** Every boss and Agony variant, with when it was first defeated and how often. */
export function bestiary(state: AppState): BestiaryEntry[] {
  const wins = [...state.bossWeeks.values()].filter((w) => w.result === 'defeated').sort((a, b) => (a.id < b.id ? -1 : 1));
  const entry = (boss: number, agony: boolean): BestiaryEntry => {
    const mine = wins.filter((w) => w.boss === boss && !!w.agony === agony);
    return { boss, agony, name: bossName(boss, agony), flavor: MONUMENTAL.tiers[boss].flavor, defeats: mine.length, firstDefeat: mine[0]?.defeatedAt ?? null };
  };
  const all = MONUMENTAL.tiers.map((_, i) => i);
  return [...all.map((i) => entry(i, false)), ...all.map((i) => entry(i, true))];
}

// ---------------------------------------------------------------- stats

export interface FocusStats {
  /** Focused hours per week (oldest first), the current week last. */
  weeks: { weekKey: string; hours: number }[];
  longestWindow: number;
  /** The longest chain, in windows and in focused minutes. */
  longestChain: { windows: number; minutes: number };
  averageWindow: number;
}

export function focusStats(state: AppState, now: Date, count = 12): FocusStats {
  const ended = [...state.focusWindows.values()].filter((w) => w.endAt !== null);
  const thisWeek = weekKeyOf(dayKeyOf(now));
  const weeks = Array.from({ length: count }, (_, i) => addDays(thisWeek, -7 * (count - 1 - i))).map((weekKey) => ({
    weekKey,
    hours: ended.filter((w) => w.weekKey === weekKey).reduce((sum, w) => sum + windowMinutes(w, now), 0) / 60,
  }));
  let longestChain = { windows: 0, minutes: 0 };
  for (const weekKey of new Set(ended.map((w) => w.weekKey))) {
    let run = { windows: 0, minutes: 0 };
    for (const d of windowDamage(ended.filter((w) => w.weekKey === weekKey), now)) {
      run = d.chain === 0 ? { windows: 1, minutes: d.minutes } : { windows: run.windows + 1, minutes: run.minutes + d.minutes };
      if (run.windows > longestChain.windows || (run.windows === longestChain.windows && run.minutes > longestChain.minutes)) longestChain = run;
    }
  }
  const minutes = ended.map((w) => windowMinutes(w, now));
  return {
    weeks,
    longestWindow: Math.max(0, ...minutes),
    longestChain,
    averageWindow: minutes.length ? minutes.reduce((a, b) => a + b, 0) / minutes.length : 0,
  };
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
