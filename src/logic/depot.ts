import { DEPOT } from '../config';
import type {
  AppState,
  Change,
  DepotState,
  DepotWeek,
  FeaturedSlot,
  LedgerEntry,
  SaleItem,
  SaleRecord,
  SaleStage,
  SaleStep,
  SaleStepKind,
} from '../types';
import { balances } from './actions';
import { ActionError, done, type ActionResult } from './errors';
import { newId } from './ids';
import { getMeta, put } from './state';
import { addDays, dayKeyOf, deadlineAt, keyToDate, weekKeyOf } from './time';

// The Salvage Exchange: a backlog of things to sell, two featured lots at a time.

export const DEPOT_ID = 'depot';

export function depot(state: AppState): DepotState | undefined {
  return state.depot.get(DEPOT_ID);
}

/** Every platform on offer: the defaults, then the ones you've added. */
export function platforms(state: AppState): string[] {
  return [...DEPOT.defaultPlatforms, ...(depot(state)?.customPlatforms ?? [])];
}

// ---------------------------------------------------------------- items and stages

export function stageOf(item: SaleItem): SaleStage {
  if (item.handedOffAt) return 'handedOff';
  if (item.soldAt) return 'sold';
  if (item.listedAt) return 'listed';
  if (item.photographedAt) return 'photographed';
  return 'cataloged';
}

export const STAGE_LABELS: Record<SaleStage, string> = {
  cataloged: 'Cataloged',
  photographed: 'Photographed',
  listed: 'Listed',
  sold: 'Sold',
  handedOff: 'Handed off',
};

export const STAGES: SaleStage[] = ['cataloged', 'photographed', 'listed', 'sold', 'handedOff'];

const STEP_LABELS: Record<SaleStepKind, string> = {
  photographed: 'Photographed',
  listed: 'Listed',
  platforms: 'Platform change',
  takenDown: 'Taken down',
  sold: 'Sold',
  fellThrough: 'Sale fell through',
  handedOff: 'Handed off',
};

/** The latest stage change, if it can still be undone (same day only). */
export function undoableStep(item: SaleItem, now: Date): SaleStep | null {
  const step = item.log[item.log.length - 1];
  return step && step.dayKey === dayKeyOf(now) ? step : null;
}

export function stepLabel(step: SaleStep): string {
  return STEP_LABELS[step.kind];
}

/** The slot stint an item is in right now, if it's a featured lot. */
export function activeSlotOf(state: AppState, itemId: string): FeaturedSlot | undefined {
  return [...state.featuredSlots.values()].find((s) => s.itemId === itemId && !s.endedAt);
}

export function activeSlots(state: AppState): FeaturedSlot[] {
  return [...state.featuredSlots.values()].filter((s) => !s.endedAt).sort((a, b) => a.slot - b.slot);
}

/**
 * Items waiting to be featured, in the order they'll be picked: photographed but never listed
 * (oldest photo first), then cataloged (oldest first). Items listed before, even if taken down
 * since, are never featured again.
 */
export function featureQueue(state: AppState): SaleItem[] {
  const featured = new Set(activeSlots(state).map((s) => s.itemId));
  const waiting = [...state.saleItems.values()].filter(
    (i) => !featured.has(i.id) && !i.firstListedAt && !i.soldAt && !i.handedOffAt,
  );
  const photographed = waiting
    .filter((i) => i.photographedAt)
    .sort((a, b) => (a.photographedAt! < b.photographedAt! ? -1 : a.photographedAt! > b.photographedAt! ? 1 : 0));
  const cataloged = waiting
    .filter((i) => !i.photographedAt)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  return [...photographed, ...cataloged];
}

/** Puts queued items into open slots. `onlyNeverUsed` limits it to slots that have never held a lot. */
function fillSlots(state: AppState, at: Date, onlyNeverUsed: boolean): Change[] {
  const taken = new Set(activeSlots(state).map((s) => s.slot));
  const used = new Set([...state.featuredSlots.values()].map((s) => s.slot));
  const queue = featureQueue(state);
  const changes: Change[] = [];
  for (let slot = 0; slot < DEPOT.slots && queue.length > 0; slot++) {
    if (taken.has(slot) || (onlyNeverUsed && used.has(slot))) continue;
    const item = queue.shift()!;
    changes.push(
      put('featuredSlots', {
        id: newId(),
        slot,
        itemId: item.id,
        name: item.name,
        startedAt: at.toISOString(),
        startedDay: dayKeyOf(at),
        endedAt: null,
        endReason: null,
      }),
    );
  }
  return changes;
}

/** The age tag of a featured lot: New, 1 week, 2 weeks, 3+ weeks. */
export function ageTag(slot: FeaturedSlot, now: Date): { label: string; level: number } {
  const days = Math.round((keyToDate(dayKeyOf(now)).getTime() - keyToDate(slot.startedDay).getTime()) / 86_400_000);
  const level = Math.min(DEPOT.ageTags.length - 1, Math.max(0, Math.floor(days / 7)));
  return { label: DEPOT.ageTags[level], level };
}

// ---------------------------------------------------------------- weekly reset

/** The start of a week (its Monday at 4 AM). */
function weekStart(weekKey: string): Date {
  return deadlineAt(weekKey, 4 * 60);
}

/** The featured lots that count for a week's mission: every lot featured during it, except deleted ones. */
export function missionLots(slots: Iterable<FeaturedSlot>, weekKey: string): FeaturedSlot[] {
  const start = weekStart(weekKey).toISOString();
  const end = weekStart(addDays(weekKey, 7)).toISOString();
  return [...slots].filter(
    (s) => s.endReason !== 'deleted' && s.startedAt < end && (s.endedAt === null || s.endedAt >= start),
  );
}

export interface MissionStatus {
  lots: FeaturedSlot[];
  listed: number;
  total: number;
  completed: boolean;
}

export function missionStatus(slots: Iterable<FeaturedSlot>, weekKey: string): MissionStatus {
  const end = weekStart(addDays(weekKey, 7)).toISOString();
  const lots = missionLots(slots, weekKey);
  const listed = lots.filter((s) => s.endReason === 'listed' && s.endedAt! < end).length;
  return { lots, listed, total: lots.length, completed: lots.length > 0 && listed === lots.length };
}

function ledger(entry: Omit<LedgerEntry, 'id'>): LedgerEntry {
  return { id: newId(), ...entry };
}

/**
 * Starts the event if needed and runs every weekly reset that's due: pays each closed week's
 * mission, then fills open slots. Also fills any slot that has never held a lot, so the first
 * items you add are featured straight away.
 */
export function ensureDepot(state: AppState, now: Date): Change[] {
  const thisWeek = weekKeyOf(dayKeyOf(now));
  const existing = depot(state);
  if (!existing) {
    const fresh: DepotState = {
      id: DEPOT_ID,
      startedWeek: thisWeek,
      currentWeek: thisWeek,
      customPlatforms: [],
      listedCount: 0,
      handedOffCount: 0,
    };
    return [put('depot', fresh), ...fillSlots(state, now, true)];
  }
  if (existing.currentWeek >= thisWeek) return fillSlots(state, now, true);

  // Work on a copy of the slots so each reset sees the fills of the one before.
  const slots = new Map(state.featuredSlots);
  const view = { ...state, featuredSlots: slots } as AppState;
  const changes: Change[] = [];
  const at = now.toISOString();
  let week = existing.currentWeek;
  while (week < thisWeek) {
    const mission = missionStatus(slots.values(), week);
    const reward = mission.completed ? DEPOT.mission : { sparks: 0, shards: 0 };
    const record: DepotWeek = {
      id: week,
      lots: mission.lots.map((s) => s.name),
      listed: mission.listed,
      total: mission.total,
      completed: mission.completed,
      rewardSparks: reward.sparks,
      rewardShards: reward.shards,
      closedAt: at,
      // A week without featured lots has nothing to report.
      seen: mission.total === 0,
    };
    changes.push(put('depotWeeks', record));
    const note = `Salvage Exchange: weekly mission (week of ${week})`;
    if (reward.sparks) changes.push(put('ledger', ledger({ at, currency: 'sparks', amount: reward.sparks, reason: 'depot_mission', note })));
    if (reward.shards) changes.push(put('ledger', ledger({ at, currency: 'shards', amount: reward.shards, reason: 'depot_mission', note })));
    week = addDays(week, 7);
    const fills = fillSlots(view, weekStart(week), false);
    for (const c of fills) if (c.store === 'featuredSlots' && c.op === 'put') slots.set(c.value.id, c.value);
    changes.push(...fills);
  }
  changes.push(put('depot', { ...existing, currentWeek: thisWeek }));
  return changes;
}

// ---------------------------------------------------------------- rewards

interface Reward {
  sparks: number;
  shards: number;
  /** What each part was for, e.g. "featured", "fresh". */
  parts: string[];
}

function isFresh(item: SaleItem, listedDay: string): boolean {
  return item.photographedDay !== null && listedDay <= addDays(item.photographedDay, DEPOT.freshDays);
}

/** What listing an item now would pay (photo reward included when that gets marked too). */
export function listingReward(state: AppState, item: SaleItem, now: Date): Reward {
  const reward: Reward = { sparks: 0, shards: 0, parts: [] };
  const add = (r: { sparks: number; shards: number }, part: string) => {
    reward.sparks += r.sparks;
    reward.shards += r.shards;
    reward.parts.push(part);
  };
  const day = dayKeyOf(now);
  if (!item.paid.photographed) add(DEPOT.photographed, 'photographed');
  if (!item.paid.listed) add(DEPOT.listed, 'listed');
  if (!item.paid.featured && !item.firstListedAt && activeSlotOf(state, item.id)) add(DEPOT.featuredBonus, 'featured');
  const photoDay = item.photographedDay ?? day;
  if (!item.paid.fresh && !item.firstListedAt && isFresh({ ...item, photographedDay: photoDay }, day)) add(DEPOT.freshBonus, 'fresh');
  return reward;
}

export interface StageResult {
  sparks: number;
  shards: number;
  parts: string[];
}

function requireItem(state: AppState, id: string): SaleItem {
  const item = state.saleItems.get(id);
  if (!item) throw new ActionError('That item no longer exists.');
  return item;
}

/** Builds the changes for a stage step: the updated item (with the step logged) and its rewards. */
function step(
  item: SaleItem,
  updated: Omit<SaleItem, 'log'>,
  kind: SaleStepKind,
  now: Date,
  payments: { reward: { sparks: number; shards: number }; note: string }[],
  extra: Change[] = [],
  endedSlotId?: string,
): ActionResult<StageResult> {
  const at = now.toISOString();
  const entries: LedgerEntry[] = [];
  for (const { reward, note } of payments) {
    const base = { at, reason: 'depot_item' as const, note: `Salvage: ${item.name} ${note}`, itemId: item.id };
    if (reward.sparks) entries.push(ledger({ ...base, currency: 'sparks', amount: reward.sparks }));
    if (reward.shards) entries.push(ledger({ ...base, currency: 'shards', amount: reward.shards }));
  }
  const { log, ...before } = item;
  const logged: SaleStep = { kind, at, dayKey: dayKeyOf(now), before, ledgerIds: entries.map((e) => e.id) };
  if (endedSlotId) logged.endedSlotId = endedSlotId;
  // Only the latest step can be undone, and only the same day, so older ones needn't be kept.
  const recent = log.filter((s) => s.dayKey === logged.dayKey);
  const changes: Change[] = [put('saleItems', { ...updated, log: [...recent, logged] }), ...entries.map((e) => put('ledger', e)), ...extra];
  return done(changes, {
    sparks: entries.filter((e) => e.currency === 'sparks').reduce((s, e) => s + e.amount, 0),
    shards: entries.filter((e) => e.currency === 'shards').reduce((s, e) => s + e.amount, 0),
    parts: payments.map((p) => p.note),
  });
}

function bumpCounts(state: AppState, listed: number, handedOff: number): Change[] {
  const d = depot(state);
  if (!d || (listed === 0 && handedOff === 0)) return [];
  return [put('depot', { ...d, listedCount: d.listedCount + listed, handedOffCount: d.handedOffCount + handedOff })];
}

export interface SaleItemInput {
  id?: string;
  name: string;
  notes: string;
  category: string;
}

export function saveSaleItem(state: AppState, input: SaleItemInput, now: Date): ActionResult<{ id: string }> {
  const name = input.name.trim();
  if (!name) throw new ActionError('Give the item a name.');
  const fields = { name, notes: input.notes.trim(), category: input.category.trim() };
  if (input.id) {
    const item = requireItem(state, input.id);
    return done([put('saleItems', { ...item, ...fields })], { id: item.id });
  }
  const item: SaleItem = {
    id: newId(),
    ...fields,
    createdAt: now.toISOString(),
    photographedAt: null,
    photographedDay: null,
    firstListedAt: null,
    listedAt: null,
    platforms: [],
    takenDownAt: null,
    soldAt: null,
    sale: null,
    handedOffAt: null,
    paid: {},
    log: [],
  };
  const changes: Change[] = [put('saleItems', item)];
  // A slot that has never held a lot takes the first items straight away.
  const view = { ...state, saleItems: new Map(state.saleItems).set(item.id, item) } as AppState;
  changes.push(...fillSlots(view, now, true));
  return done(changes, { id: item.id });
}

export function markPhotographed(state: AppState, id: string, now: Date): ActionResult<StageResult> {
  const item = requireItem(state, id);
  if (item.photographedAt) throw new ActionError('Already photographed.');
  const updated = { ...item, photographedAt: now.toISOString(), photographedDay: dayKeyOf(now), paid: { ...item.paid, photographed: true } };
  const payments = item.paid.photographed ? [] : [{ reward: DEPOT.photographed, note: 'photographed' }];
  return step(item, updated, 'photographed', now, payments);
}

function cleanPlatforms(list: string[]): string[] {
  return [...new Set(list.map((p) => p.trim()).filter(Boolean))];
}

/** Puts an item on the market (marking it photographed too if it wasn't). Rewards are paid once per item, ever. */
export function listItem(state: AppState, id: string, platformList: string[], now: Date): ActionResult<StageResult> {
  const item = requireItem(state, id);
  if (item.soldAt) throw new ActionError('That item is already sold.');
  if (item.listedAt) throw new ActionError('That item is already on the market.');
  const chosen = cleanPlatforms(platformList);
  if (chosen.length === 0) throw new ActionError('Pick at least one platform.');
  return listChanges(state, item, chosen, now, 'listed');
}

function listChanges(
  state: AppState,
  item: SaleItem,
  chosen: string[],
  now: Date,
  kind: SaleStepKind,
  overrides: Partial<SaleItem> = {},
): ActionResult<StageResult> {
  const at = now.toISOString();
  const day = dayKeyOf(now);
  const reward = listingReward(state, item, now);
  const payments: { reward: { sparks: number; shards: number }; note: string }[] = [];
  if (reward.parts.includes('photographed')) payments.push({ reward: DEPOT.photographed, note: 'photographed' });
  if (reward.parts.includes('listed')) payments.push({ reward: DEPOT.listed, note: 'listed' });
  if (reward.parts.includes('featured')) payments.push({ reward: DEPOT.featuredBonus, note: 'listed as a featured lot' });
  if (reward.parts.includes('fresh')) payments.push({ reward: DEPOT.freshBonus, note: 'listed while fresh' });
  const firstListing = !item.firstListedAt;
  const updated: Omit<SaleItem, 'log'> = {
    ...item,
    photographedAt: item.photographedAt ?? at,
    photographedDay: item.photographedDay ?? day,
    firstListedAt: item.firstListedAt ?? at,
    listedAt: at,
    platforms: chosen,
    paid: {
      ...item.paid,
      photographed: true,
      listed: true,
      ...(reward.parts.includes('featured') ? { featured: true } : {}),
      ...(reward.parts.includes('fresh') ? { fresh: true } : {}),
    },
    ...overrides,
  };
  // A featured lot leaves its slot once it's listed; the slot stays open until the reset.
  const slot = activeSlotOf(state, item.id);
  const extra: Change[] = [...bumpCounts(state, firstListing ? 1 : 0, 0)];
  if (slot) extra.push(put('featuredSlots', { ...slot, endedAt: at, endReason: 'listed' }));
  return step(item, updated, kind, now, payments, extra, slot?.id);
}

/** Changes which platforms a listed item is on. Pays nothing. */
export function setPlatforms(state: AppState, id: string, platformList: string[], now: Date): ActionResult<StageResult> {
  const item = requireItem(state, id);
  if (!item.listedAt) throw new ActionError('That item is not on the market.');
  const chosen = cleanPlatforms(platformList);
  if (chosen.length === 0) throw new ActionError('Keep at least one platform, or take the item down.');
  return step(item, { ...item, platforms: chosen }, 'platforms', now, []);
}

/** Takes an item off the market without selling it. Relisting later pays nothing. */
export function takeDown(state: AppState, id: string, now: Date): ActionResult<StageResult> {
  const item = requireItem(state, id);
  if (!item.listedAt) throw new ActionError('That item is not on the market.');
  return step(item, { ...item, listedAt: null, platforms: [], takenDownAt: now.toISOString() }, 'takenDown', now, []);
}

export interface SaleInput {
  /** Dollars and cents as typed, e.g. "45" or "45.50". */
  price: string;
  platform: string;
  fees: string;
}

/** Parses a dollar amount into cents. Returns null for blank input. */
export function parseDollars(text: string): number | null {
  const clean = text.replace(/[$,\s]/g, '');
  if (clean === '') return null;
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) throw new ActionError(`"${text}" isn't a dollar amount.`);
  return Math.round(parseFloat(clean) * 100);
}

/** Records a sale (listing the item first if it wasn't, which pays the listing rewards). */
export function markSold(state: AppState, id: string, input: SaleInput, now: Date): ActionResult<StageResult> {
  const item = requireItem(state, id);
  if (item.soldAt) throw new ActionError('That item is already sold.');
  const price = parseDollars(input.price);
  if (price === null) throw new ActionError('Enter the sale price.');
  const fees = parseDollars(input.fees) ?? 0;
  const platform = input.platform.trim();
  if (!platform) throw new ActionError('Pick the platform it sold on.');
  const sale: SaleRecord = { price, platform, fees };
  const at = now.toISOString();
  if (!item.listedAt) {
    // Selling an unlisted item lists it at the same moment, on the platform it sold on.
    return listChanges(state, item, [platform], now, 'sold', { soldAt: at, sale });
  }
  return step(item, { ...item, soldAt: at, sale }, 'sold', now, []);
}

/** The buyer backed out before the hand-off: back on the market, as it was. */
export function saleFellThrough(state: AppState, id: string, now: Date): ActionResult<StageResult> {
  const item = requireItem(state, id);
  if (!item.soldAt || item.handedOffAt) throw new ActionError('Only a sold item that hasn’t been handed off can go back on the market.');
  const platformsNow = item.platforms.length ? item.platforms : item.sale ? [item.sale.platform] : [];
  return step(item, { ...item, soldAt: null, sale: null, listedAt: item.listedAt ?? now.toISOString(), platforms: platformsNow }, 'fellThrough', now, []);
}

export function markHandedOff(state: AppState, id: string, now: Date): ActionResult<StageResult> {
  const item = requireItem(state, id);
  if (!item.soldAt) throw new ActionError('Mark it sold first, with the price.');
  if (item.handedOffAt) throw new ActionError('Already handed off.');
  const first = !item.paid.handedOff;
  const updated = { ...item, handedOffAt: now.toISOString(), paid: { ...item.paid, handedOff: true } };
  const payments = first ? [{ reward: DEPOT.handedOff, note: 'handed off' }] : [];
  return step(item, updated, 'handedOff', now, payments, bumpCounts(state, 0, first ? 1 : 0));
}

/** Undoes an item's latest stage change, the same day only, and takes back what it paid. */
export function undoStep(state: AppState, id: string, now: Date): ActionResult<{ kind: SaleStepKind }> {
  const item = requireItem(state, id);
  const last = undoableStep(item, now);
  if (!last) throw new ActionError('Only today’s changes can be undone.');
  const entries = last.ledgerIds.map((lid) => state.ledger.get(lid)).filter((e): e is LedgerEntry => !!e);
  const sparks = entries.filter((e) => e.currency === 'sparks').reduce((s, e) => s + e.amount, 0);
  const shards = entries.filter((e) => e.currency === 'shards').reduce((s, e) => s + e.amount, 0);
  const have = balances(state);
  const { sparksName, shardsName } = getMeta(state).settings;
  if (have.sparks < sparks || have.shards < shards) {
    throw new ActionError(
      `Undoing this takes back ${sparks ? `${sparks} ${sparksName}` : ''}${sparks && shards ? ' and ' : ''}${shards ? `${shards} ${shardsName}` : ''}, but they've already been spent.`,
    );
  }
  const at = now.toISOString();
  const changes: Change[] = [put('saleItems', { ...last.before, log: item.log.slice(0, -1) })];
  for (const e of entries) {
    changes.push(put('ledger', ledger({ at, currency: e.currency, amount: -e.amount, reason: 'undo', note: `Undo: ${e.note}`, itemId: item.id })));
  }
  if (last.endedSlotId) {
    const slot = state.featuredSlots.get(last.endedSlotId);
    if (slot) changes.push(put('featuredSlots', { ...slot, endedAt: null, endReason: null }));
  }
  const listed = !last.before.firstListedAt && item.firstListedAt ? -1 : 0;
  const handedOff = !last.before.paid.handedOff && item.paid.handedOff ? -1 : 0;
  changes.push(...bumpCounts(state, listed, handedOff));
  return done(changes, { kind: last.kind });
}

/**
 * Removes an item (added by mistake, or sold outside the app). Pays nothing and doesn't count
 * as cleared; rewards already earned are kept. A featured lot's slot stays open until the reset.
 */
export function deleteSaleItem(state: AppState, id: string, now: Date): ActionResult {
  const item = requireItem(state, id);
  const changes: Change[] = [{ store: 'saleItems', op: 'delete', id: item.id }];
  const slot = activeSlotOf(state, item.id);
  if (slot) changes.push(put('featuredSlots', { ...slot, endedAt: now.toISOString(), endReason: 'deleted' }));
  return done(changes, undefined);
}

export function addPlatform(state: AppState, name: string): ActionResult<{ name: string }> {
  const d = depot(state);
  if (!d) throw new ActionError('The Salvage Exchange has not started yet.');
  const clean = name.trim();
  if (!clean) throw new ActionError('Name the platform.');
  const existing = platforms(state).find((p) => p.toLowerCase() === clean.toLowerCase());
  if (existing) return done([], { name: existing });
  return done([put('depot', { ...d, customPlatforms: [...d.customPlatforms, clean] })], { name: clean });
}

export function removePlatform(state: AppState, name: string): ActionResult {
  const d = depot(state);
  if (!d) throw new ActionError('The Salvage Exchange has not started yet.');
  return done([put('depot', { ...d, customPlatforms: d.customPlatforms.filter((p) => p !== name) })], undefined);
}

// ---------------------------------------------------------------- the screen

export interface DepotView {
  featured: { slot: FeaturedSlot; item: SaleItem }[];
  openSlots: number;
  /** Items that will fill the open slots at the next reset. */
  upNext: SaleItem[];
  /** The next item in line once a slot opens (when none is open now). */
  nextInLine: SaleItem | null;
  /** Listed, plus sold and waiting to be handed off. */
  onMarket: SaleItem[];
  /** Not on the market and not sold: the queue order first, then items taken down. */
  catalog: SaleItem[];
  cleared: SaleItem[];
  mission: MissionStatus;
  weekKey: string;
  categories: string[];
}

export function depotView(state: AppState, now: Date): DepotView {
  const slots = activeSlots(state);
  const featured = slots
    .map((slot) => ({ slot, item: state.saleItems.get(slot.itemId)! }))
    .filter((f) => f.item);
  const openSlots = DEPOT.slots - featured.length;
  const queue = featureQueue(state);
  const items = [...state.saleItems.values()];
  const byTime = (key: 'listedAt' | 'handedOffAt') => (a: SaleItem, b: SaleItem) => ((a[key] ?? '') < (b[key] ?? '') ? 1 : -1);
  const featuredIds = new Set(featured.map((f) => f.item.id));
  const takenDown = items
    .filter((i) => !i.listedAt && !i.soldAt && i.firstListedAt)
    .sort((a, b) => ((a.takenDownAt ?? '') < (b.takenDownAt ?? '') ? 1 : -1));
  const weekKey = weekKeyOf(dayKeyOf(now));
  return {
    featured,
    openSlots,
    upNext: queue.slice(0, openSlots),
    nextInLine: openSlots === 0 ? (queue[0] ?? null) : null,
    onMarket: items.filter((i) => (i.listedAt || i.soldAt) && !i.handedOffAt).sort(byTime('listedAt')),
    catalog: [...queue, ...takenDown].filter((i) => !featuredIds.has(i.id)),
    cleared: items.filter((i) => i.handedOffAt).sort(byTime('handedOffAt')),
    mission: missionStatus(state.featuredSlots.values(), weekKey),
    weekKey,
    categories: [...new Set(items.map((i) => i.category).filter(Boolean))].sort(),
  };
}

/** Closed weeks whose mission hasn't been shown in a weekly report yet. */
export function unseenDepotWeeks(state: AppState): DepotWeek[] {
  return [...state.depotWeeks.values()].filter((w) => !w.seen).sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** A ready-to-paste prompt asking an AI assistant to write the listing from attached photos. */
export function listingPrompt(item: SaleItem): string {
  return [
    'I’m selling this item secondhand and have attached photos of it. Please help me write the listing.',
    '',
    `Item: ${item.name}`,
    item.category ? `Category: ${item.category}` : null,
    item.notes ? `My notes: ${item.notes}` : null,
    '',
    'Please give me:',
    '1. A listing title (under 80 characters, with the words buyers would search for)',
    '2. A description',
    '3. Condition notes, based on what you can see in the photos',
    '4. A suggested price range for the used market, with a short reason',
    '',
    'Keep it platform-neutral so I can post it on eBay, Facebook Marketplace or selling groups.',
  ]
    .filter((line) => line !== null)
    .join('\n');
}
