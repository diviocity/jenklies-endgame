import { ECONOMY, PULLS, SHARDS } from '../config';
import type {
  Affirmation,
  AppState,
  BucketId,
  Change,
  DayBucket,
  DayRecord,
  DayTask,
  Indulgence,
  LedgerEntry,
  Minutes,
  PullRecord,
  Rarity,
  Settings,
  TemplateTask,
} from '../types';
import { ActionError, done, type ActionResult } from './errors';
import { taskFitnessEntries, taskFitnessEntry, wouldCount } from './event';
import { pickIndex, rollRarity, type Rng } from './gacha';
import { newId } from './ids';
import { targetPoints } from './rank';
import { bucketValues, rates, taskValues } from './rewards';
import { getMeta, put, sortByOrder } from './state';
import {
  BUCKET_LABELS,
  bucketDayType,
  bucketsFor,
  dayKeyOf,
  dayTypeOf,
  isOnTime,
  weekdayOf,
} from './time';

export { ActionError, type ActionResult } from './errors';

function ledger(entry: Omit<LedgerEntry, 'id'>): Change {
  return put('ledger', { id: newId(), ...entry });
}

// ---------------------------------------------------------------- derived data

export function balances(state: AppState): { sparks: number; shards: number } {
  let sparks = 0;
  let shards = 0;
  for (const e of state.ledger.values()) {
    if (e.currency === 'sparks') sparks += e.amount;
    else shards += e.amount;
  }
  return { sparks, shards };
}

/** How many of each indulgence I hold: won + bought − redeemed. */
export function inventory(state: AppState): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (id: string, n: number) => counts.set(id, (counts.get(id) ?? 0) + n);
  for (const p of state.pulls.values()) if (p.kind === 'indulgence') add(p.itemId, 1);
  for (const p of state.purchases.values()) add(p.indulgenceId, 1);
  for (const r of state.redemptions.values()) add(r.indulgenceId, -1);
  return counts;
}

/** How many times each affirmation has been pulled. */
export function affirmationCounts(state: AppState): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of state.pulls.values()) {
    if (p.kind === 'affirmation') counts.set(p.itemId, (counts.get(p.itemId) ?? 0) + 1);
  }
  return counts;
}

export function activeAffirmations(state: AppState): Affirmation[] {
  return sortByOrder([...state.affirmations.values()].filter((a) => !a.removed));
}

export function activeIndulgences(state: AppState, rarity?: 4 | 5): Indulgence[] {
  return sortByOrder(
    [...state.indulgences.values()].filter((i) => i.active && (rarity === undefined || i.rarity === rarity)),
  );
}

export function today(state: AppState, now: Date): DayRecord | undefined {
  return state.days.get(dayKeyOf(now));
}

// ---------------------------------------------------------------- days

/** Days snapshotted before bucket bonuses paid 50% of a task's base for being on time. */
const LEGACY_ON_TIME_RATIO = 0.5;

/** Builds a day's snapshot from the current template, settings and reward values. */
export function buildDay(state: AppState, key: string, now: Date): DayRecord {
  const { settings } = getMeta(state);
  const template = [...state.templateTasks.values()];
  const rate = rates(template);
  const weekday = weekdayOf(key);
  const dayType = dayTypeOf(key);
  const todays = sortByOrder(template).filter(
    (t) => t.days.includes(weekday) && bucketDayType(t.bucket) === dayType,
  );
  const tasks: DayTask[] = todays.map((t, i) => ({
    id: newId(),
    templateTaskId: t.id,
    name: t.name,
    bucket: t.bucket,
    deadline: t.deadlineOverride ?? settings.deadlines[t.bucket],
    weight: t.weight,
    ...taskValues(t.weight, rate.task),
    oneOff: false,
    order: i,
    completedAt: null,
    onTime: null,
    fitness: t.fitness ?? null,
  }));
  const buckets: DayBucket[] = bucketsFor(dayType).map((id) => {
    const weight = todays.filter((t) => t.bucket === id).reduce((sum, t) => sum + t.weight, 0);
    const values = weight > 0 ? bucketValues(weight, rate.bucket) : { bonus: 0, perfectBonus: 0 };
    return { id, deadline: settings.deadlines[id], ...values };
  });
  return {
    id: key,
    dayType,
    baseRate: rate.task,
    onTimeRatio: ECONOMY.taskOnTimeRatio,
    buckets,
    tasks,
    createdAt: now.toISOString(),
  };
}

/** Takes today's snapshot if it hasn't been taken yet. */
export function ensureDay(state: AppState, now: Date): Change[] {
  const key = dayKeyOf(now);
  if (state.days.has(key)) return [];
  return [put('days', buildDay(state, key, now))];
}

export interface BucketStatus {
  bucket: DayBucket;
  /** The template tasks that decide the bucket bonus (one-off tasks don't count). */
  counted: DayTask[];
  cleared: boolean;
  perfect: boolean;
  bonus: number;
  perfectBonus: number;
}

export function bucketStatus(day: DayRecord, bucketId: BucketId): BucketStatus {
  const bucket = day.buckets.find((b) => b.id === bucketId)!;
  const counted = day.tasks.filter((t) => t.bucket === bucketId && !t.oneOff);
  const cleared = counted.length > 0 && counted.every((t) => t.completedAt);
  return {
    bucket,
    counted,
    cleared,
    perfect: cleared && counted.every((t) => t.onTime),
    bonus: bucket.bonus ?? 0,
    perfectBonus: bucket.perfectBonus ?? 0,
  };
}

/** What a day has earned so far, and the most it could earn. */
export function dayTotals(day: DayRecord): { earned: number; max: number } {
  let earned = 0;
  let max = 0;
  for (const t of day.tasks) {
    max += t.base + t.bonus;
    if (t.completedAt) earned += t.base + (t.onTime ? t.bonus : 0);
  }
  for (const b of day.buckets) {
    const s = bucketStatus(day, b.id);
    if (s.counted.length > 0) max += s.bonus + s.perfectBonus;
    if (s.cleared) earned += s.bonus + (s.perfect ? s.perfectBonus : 0);
  }
  return { earned, max };
}

function requireToday(state: AppState, now: Date): DayRecord {
  const day = today(state, now);
  if (!day) throw new ActionError('Today has not started yet. Try again.');
  return day;
}

function findTask(day: DayRecord, taskId: string): DayTask {
  const task = day.tasks.find((t) => t.id === taskId);
  if (!task) throw new ActionError('That task is from a day that has ended, so it can no longer change.');
  return task;
}

function withTask(day: DayRecord, task: DayTask): DayRecord {
  return { ...day, tasks: day.tasks.map((t) => (t.id === task.id ? task : t)) };
}

export interface CompleteResult {
  /** Sparks from the task itself (base, plus its on-time bonus). */
  earned: number;
  onTime: boolean;
  /** Bucket bonuses this completion unlocked (0 if it didn't clear the bucket). */
  cleared: number;
  perfect: number;
  /** Fitness points the task logged (0 if untagged, or an activity past the weekly cap). */
  fitness: number;
}

export function completeTask(state: AppState, taskId: string, now: Date): ActionResult<CompleteResult> {
  const day = requireToday(state, now);
  const task = findTask(day, taskId);
  if (task.completedAt) throw new ActionError('Already done.');
  const onTime = isOnTime(now, day.id, task.deadline);
  const at = now.toISOString();
  const updated = withTask(day, { ...task, completedAt: at, onTime });
  const label = BUCKET_LABELS[task.bucket];
  const base = { at, currency: 'sparks' as const, dayKey: day.id };
  const changes: Change[] = [
    put('days', updated),
    ledger({ ...base, amount: task.base, reason: 'task', note: task.name, taskId }),
  ];
  if (onTime && task.bonus > 0) {
    changes.push(ledger({ ...base, amount: task.bonus, reason: 'bonus', note: `On time: ${task.name}`, taskId }));
  }

  const result: CompleteResult = {
    earned: task.base + (onTime ? task.bonus : 0),
    onTime,
    cleared: 0,
    perfect: 0,
    fitness: 0,
  };
  const fitness = taskFitnessEntry(day, task, at);
  if (fitness) {
    if (wouldCount(state, fitness.weekKey, fitness.type)) result.fitness = fitness.points;
    changes.push(put('fitness', fitness));
  }
  const before = bucketStatus(day, task.bucket);
  const after = bucketStatus(updated, task.bucket);
  if (after.cleared && !before.cleared) {
    if (after.bonus > 0) {
      result.cleared = after.bonus;
      changes.push(
        ledger({ ...base, amount: after.bonus, reason: 'bucket', note: `${label} cleared`, bucketId: task.bucket }),
      );
    }
    if (after.perfect && after.perfectBonus > 0) {
      result.perfect = after.perfectBonus;
      changes.push(
        ledger({
          ...base,
          amount: after.perfectBonus,
          reason: 'bucket_perfect',
          note: `${label} perfect`,
          bucketId: task.bucket,
        }),
      );
    }
  }
  return done(changes, result);
}

export function undoTask(state: AppState, taskId: string, now: Date): ActionResult<{ refunded: number }> {
  const day = requireToday(state, now);
  const task = findTask(day, taskId);
  if (!task.completedAt) throw new ActionError('That task is not done.');
  const taskAmount = task.base + (task.onTime ? task.bonus : 0);
  // Undoing a task in a cleared bucket also takes back the bucket's bonuses.
  const status = task.oneOff ? null : bucketStatus(day, task.bucket);
  const bucketAmount = status?.cleared ? status.bonus + (status.perfect ? status.perfectBonus : 0) : 0;
  const amount = taskAmount + bucketAmount;
  const { sparks } = balances(state);
  if (sparks < amount) {
    throw new ActionError(
      `Undoing this takes back ${amount} ${getMeta(state).settings.sparksName}, but you only have ${sparks}. They've already been spent.`,
    );
  }
  const at = now.toISOString();
  const base = { at, currency: 'sparks' as const, reason: 'undo' as const, dayKey: day.id };
  const changes: Change[] = [
    put('days', withTask(day, { ...task, completedAt: null, onTime: null })),
    ledger({ ...base, amount: -taskAmount, note: `Undo: ${task.name}`, taskId }),
  ];
  if (bucketAmount > 0) {
    changes.push(
      ledger({
        ...base,
        amount: -bucketAmount,
        note: `Undo: ${BUCKET_LABELS[task.bucket]} bonus`,
        bucketId: task.bucket,
      }),
    );
  }
  for (const entry of taskFitnessEntries(state, day.id, task.id)) {
    changes.push({ store: 'fitness', op: 'delete', id: entry.id });
  }
  return done(changes, { refunded: amount });
}

/** What a one-off task is worth on a given day (a weight-1 task at that day's rate). */
export function oneOffValues(day: DayRecord): { base: number; bonus: number } {
  return taskValues(1, day.baseRate, day.onTimeRatio ?? LEGACY_ON_TIME_RATIO);
}

export function addOneOff(
  state: AppState,
  input: { name: string; bucket: BucketId; deadline: Minutes | null },
  now: Date,
): ActionResult {
  const day = requireToday(state, now);
  const name = input.name.trim();
  if (!name) throw new ActionError('Give the task a name.');
  if (!day.buckets.some((b) => b.id === input.bucket)) {
    throw new ActionError(`${BUCKET_LABELS[input.bucket]} isn't one of today's buckets.`);
  }
  const bucketDeadline = day.buckets.find((b) => b.id === input.bucket)!.deadline;
  const task: DayTask = {
    id: newId(),
    templateTaskId: null,
    name,
    bucket: input.bucket,
    deadline: input.deadline ?? bucketDeadline,
    weight: 1,
    ...oneOffValues(day),
    oneOff: true,
    order: Math.max(-1, ...day.tasks.map((t) => t.order)) + 1,
    completedAt: null,
    onTime: null,
  };
  return done([put('days', { ...day, tasks: [...day.tasks, task] })], undefined);
}

export function removeOneOff(state: AppState, taskId: string, now: Date): ActionResult {
  const day = requireToday(state, now);
  const task = findTask(day, taskId);
  if (!task.oneOff) throw new ActionError('Only one-off tasks can be removed from today.');
  if (task.completedAt) throw new ActionError('Undo it first, then remove it.');
  return done([put('days', { ...day, tasks: day.tasks.filter((t) => t.id !== taskId) })], undefined);
}

// ---------------------------------------------------------------- pulls

export function pullCost(count: 1 | 10): number {
  return count === 10 ? PULLS.tenCost : PULLS.singleCost;
}

/** Why pulling is blocked right now, or null if it isn't. */
export function pullBlockReason(state: AppState, count: 1 | 10): string | null {
  if (activeAffirmations(state).length === 0) return 'Add at least one affirmation before pulling (More → Affirmations).';
  if (activeIndulgences(state, 4).length === 0) return 'Add an active 4★ indulgence before pulling (More → Indulgences).';
  if (activeIndulgences(state, 5).length === 0) return 'Add an active 5★ indulgence before pulling (More → Indulgences).';
  const { sparks } = balances(state);
  const cost = pullCost(count);
  if (sparks < cost) {
    return `Need ${cost - sparks} more ${getMeta(state).settings.sparksName}.`;
  }
  return null;
}

export function pull(state: AppState, count: 1 | 10, now: Date, rng: Rng): ActionResult<PullRecord[]> {
  const blocked = pullBlockReason(state, count);
  if (blocked) throw new ActionError(blocked);

  const meta = getMeta(state);
  const affirmations = activeAffirmations(state);
  const pools = { 4: activeIndulgences(state, 4), 5: activeIndulgences(state, 5) };
  const collected = new Set(affirmationCounts(state).keys());
  const at = now.toISOString();
  const batchId = newId();
  const cost = pullCost(count);

  const changes: Change[] = [
    ledger({ at, currency: 'sparks', amount: -cost, reason: 'pull', note: count === 10 ? 'Pull ×10' : 'Pull ×1' }),
  ];
  const results: PullRecord[] = [];
  let pity = { pity5: meta.pity5, pity4: meta.pity4 };

  for (let index = 0; index < count; index++) {
    const roll = rollRarity(pity, rng);
    pity = roll.next;
    const rarity: Rarity = roll.rarity;
    let record: PullRecord;
    const base = {
      id: newId(),
      at,
      batchId,
      batchSize: count,
      index,
      rarity,
      pity5: roll.pity5,
      pity4: roll.pity4,
      shards: SHARDS.perPull[rarity],
    };
    if (rarity === 3) {
      const a = affirmations[pickIndex(affirmations.length, rng)];
      record = { ...base, kind: 'affirmation', itemId: a.id, itemName: a.text, isNew: !collected.has(a.id) };
      collected.add(a.id);
    } else {
      const pool = pools[rarity];
      const item = pool[pickIndex(pool.length, rng)];
      record = { ...base, kind: 'indulgence', itemId: item.id, itemName: item.name, isNew: false };
    }
    results.push(record);
    changes.push(put('pulls', record));
    changes.push(
      ledger({
        at,
        currency: 'shards',
        amount: record.shards,
        reason: 'pull_shards',
        note: `${rarity}★ pull`,
        pullId: record.id,
      }),
    );
  }

  changes.push(put('meta', { ...meta, ...pity }));
  return done(changes, results);
}

// ---------------------------------------------------------------- shop and redeem

export function buy(state: AppState, indulgenceId: string, now: Date): ActionResult {
  const item = state.indulgences.get(indulgenceId);
  if (!item || !item.active) throw new ActionError('That indulgence is not in the shop.');
  const cost = SHARDS.shopPrice[item.rarity];
  const { shards } = balances(state);
  const { shardsName } = getMeta(state).settings;
  if (shards < cost) throw new ActionError(`Need ${cost - shards} more ${shardsName}.`);
  const at = now.toISOString();
  const purchaseId = newId();
  return done(
    [
      put('purchases', { id: purchaseId, at, indulgenceId, name: item.name, cost }),
      ledger({ at, currency: 'shards', amount: -cost, reason: 'shop', note: `Bought: ${item.name}`, purchaseId }),
    ],
    undefined,
  );
}

export function redeem(state: AppState, indulgenceId: string, now: Date): ActionResult {
  const item = state.indulgences.get(indulgenceId);
  if (!item) throw new ActionError('Unknown indulgence.');
  if ((inventory(state).get(indulgenceId) ?? 0) <= 0) throw new ActionError('You have none of those left.');
  return done(
    [put('redemptions', { id: newId(), at: now.toISOString(), indulgenceId, name: item.name })],
    undefined,
  );
}

// ---------------------------------------------------------------- editors

export type TemplateTaskInput = Omit<TemplateTask, 'id' | 'order'> & { id?: string };

export function validateTemplateTask(input: TemplateTaskInput): string | null {
  if (!input.name.trim()) return 'Give the task a name.';
  if (input.days.length === 0) return 'Pick at least one day.';
  const type = bucketDayType(input.bucket);
  const wrong = input.days.filter((d) => (d === 0 || d === 6 ? 'weekend' : 'weekday') !== type);
  if (wrong.length) {
    return type === 'weekday'
      ? 'Weekday buckets can only be used on Mon–Fri.'
      : 'Weekend buckets can only be used on Sat–Sun.';
  }
  if (!Number.isFinite(input.weight) || input.weight <= 0 || input.weight > 100) {
    return 'Weight must be a number above 0 (and at most 100).';
  }
  if (input.deadlineOverride !== null && (input.deadlineOverride < 240 || input.deadlineOverride >= 1680)) {
    return 'That deadline is outside the day.';
  }
  return null;
}

export function saveTemplateTask(state: AppState, input: TemplateTaskInput): ActionResult {
  const error = validateTemplateTask(input);
  if (error) throw new ActionError(error);
  const existing = input.id ? state.templateTasks.get(input.id) : undefined;
  const order = existing?.order ?? Math.max(-1, ...[...state.templateTasks.values()].map((t) => t.order)) + 1;
  const task: TemplateTask = {
    id: existing?.id ?? newId(),
    name: input.name.trim(),
    days: [...new Set(input.days)].sort(),
    bucket: input.bucket,
    deadlineOverride: input.deadlineOverride,
    weight: input.weight,
    order,
    fitness: input.fitness ?? null,
  };
  return done([put('templateTasks', task)], undefined);
}

export function deleteTemplateTask(state: AppState, id: string): ActionResult {
  if (!state.templateTasks.has(id)) throw new ActionError('That task no longer exists.');
  return done([{ store: 'templateTasks', op: 'delete', id }], undefined);
}

/** Swaps a task with its neighbor within the same bucket. */
export function moveTemplateTask(state: AppState, id: string, direction: -1 | 1): ActionResult {
  const task = state.templateTasks.get(id);
  if (!task) throw new ActionError('That task no longer exists.');
  const siblings = sortByOrder([...state.templateTasks.values()].filter((t) => t.bucket === task.bucket));
  const i = siblings.findIndex((t) => t.id === id);
  const other = siblings[i + direction];
  if (!other) return done([], undefined);
  return done(
    [put('templateTasks', { ...task, order: other.order }), put('templateTasks', { ...other, order: task.order })],
    undefined,
  );
}

export type IndulgenceInput = Omit<Indulgence, 'id' | 'order' | 'createdAt'> & { id?: string };

export function saveIndulgence(state: AppState, input: IndulgenceInput, now: Date): ActionResult {
  const name = input.name.trim();
  if (!name) throw new ActionError('Give the indulgence a name.');
  if (input.rarity !== 4 && input.rarity !== 5) throw new ActionError('Rarity must be 4★ or 5★.');
  const existing = input.id ? state.indulgences.get(input.id) : undefined;
  const item: Indulgence = {
    id: existing?.id ?? newId(),
    name,
    rarity: input.rarity,
    emoji: input.emoji.trim(),
    note: input.note.trim(),
    active: input.active,
    order: existing?.order ?? Math.max(-1, ...[...state.indulgences.values()].map((i) => i.order)) + 1,
    createdAt: existing?.createdAt ?? now.toISOString(),
  };
  return done([put('indulgences', item)], undefined);
}

/** Whether an indulgence appears anywhere in history (then it can only be retired). */
export function indulgenceUsed(state: AppState, id: string): boolean {
  return (
    [...state.pulls.values()].some((p) => p.itemId === id) ||
    [...state.purchases.values()].some((p) => p.indulgenceId === id) ||
    [...state.redemptions.values()].some((r) => r.indulgenceId === id)
  );
}

export function deleteIndulgence(state: AppState, id: string): ActionResult {
  if (indulgenceUsed(state, id)) throw new ActionError('It appears in your history, so retire it instead.');
  return done([{ store: 'indulgences', op: 'delete', id }], undefined);
}

export function saveAffirmation(state: AppState, input: { id?: string; text: string }, now: Date): ActionResult {
  const text = input.text.trim();
  if (!text) throw new ActionError('An affirmation needs some words.');
  const existing = input.id ? state.affirmations.get(input.id) : undefined;
  const item: Affirmation = {
    id: existing?.id ?? newId(),
    text,
    removed: existing?.removed ?? false,
    order: existing?.order ?? Math.max(-1, ...[...state.affirmations.values()].map((a) => a.order)) + 1,
    createdAt: existing?.createdAt ?? now.toISOString(),
  };
  return done([put('affirmations', item)], undefined);
}

/** Removing keeps the affirmation for pull history; it leaves the pool and the Collection. */
export function setAffirmationRemoved(state: AppState, id: string, removed: boolean): ActionResult {
  const item = state.affirmations.get(id);
  if (!item) throw new ActionError('That affirmation no longer exists.');
  return done([put('affirmations', { ...item, removed })], undefined);
}

export function saveSettings(state: AppState, settings: Settings): ActionResult {
  const meta = getMeta(state);
  for (const [bucket, m] of Object.entries(settings.deadlines)) {
    if (!Number.isFinite(m) || m < 240 || m >= 1680) {
      throw new ActionError(`The ${BUCKET_LABELS[bucket as BucketId]} deadline is outside the day.`);
    }
  }
  if (settings.fitnessTarget) {
    const counts = Object.values(settings.fitnessTarget);
    if (counts.some((n) => !Number.isInteger(n) || n < 0 || n > 21)) {
      throw new ActionError('Target week counts must be whole numbers from 0 to 21.');
    }
    if (targetPoints(settings.fitnessTarget) <= 0) throw new ActionError('The target week needs at least one activity.');
  }
  const sparksName = settings.sparksName.trim() || 'Sparks';
  const shardsName = settings.shardsName.trim() || 'Shards';
  return done([put('meta', { ...meta, settings: { ...settings, sparksName, shardsName } })], undefined);
}

export function markBackedUp(state: AppState, now: Date): ActionResult {
  return done([put('meta', { ...getMeta(state), lastBackupAt: now.toISOString() })], undefined);
}
