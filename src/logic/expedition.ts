import { EXPEDITION } from '../config';
import type { AppState, Change, EventWeek, ExpeditionRecord, FitnessEntry, FrontierState, LedgerEntry } from '../types';
import { ActionError, done, type ActionResult } from './errors';
import { frontier, fitnessTarget } from './event';
import { newId } from './ids';
import { countedEntryIds, rankOf, rpMax, targetPoints } from './rank';
import { put } from './state';
import { dayKeyOf, weekKeyOf } from './time';

// ---------------------------------------------------------------- the route

export type NodeKind = 'node' | 'cache' | 'regionEnd' | 'final';

export interface MapNode {
  /** 1-based position along the whole route. */
  index: number;
  /** 0-based region. */
  region: number;
  /** Where on the route it sits, in points from the start. */
  at: number;
  kind: NodeKind;
  sparks: number;
  shards: number;
  selector: 4 | 5 | null;
  title: string | null;
  theme: string | null;
}

export interface Region {
  index: number;
  name: string;
  minRank: number;
  start: number;
  end: number;
  title: string | null;
}

export const REGIONS: Region[] = (() => {
  let start = 0;
  return EXPEDITION.regions.map((r, index) => {
    const region = { index, name: r.name, minRank: r.minRank, start, end: start + r.length, title: r.title };
    start += r.length;
    return region;
  });
})();

export const MAP_LENGTH = REGIONS[REGIONS.length - 1].end;

/** Every node on the route, spaced evenly inside each region; the last node of a region is its end. */
export const MAP_NODES: MapNode[] = (() => {
  const nodes: MapNode[] = [];
  for (const region of REGIONS) {
    const length = region.end - region.start;
    const count = Math.max(1, Math.round(length / EXPEDITION.nodeSpacing));
    for (let k = 1; k <= count; k++) {
      const index = nodes.length + 1;
      const at = Math.round(region.start + (length * k) / count);
      const last = k === count;
      const final = last && region.index === REGIONS.length - 1;
      const cache = !last && index % EXPEDITION.cacheEvery === 0;
      const reward = last ? { sparks: 0, shards: 0 } : cache ? EXPEDITION.cacheReward : EXPEDITION.nodeReward;
      nodes.push({
        index,
        region: region.index,
        at,
        kind: final ? 'final' : last ? 'regionEnd' : cache ? 'cache' : 'node',
        sparks: reward.sparks,
        shards: reward.shards,
        selector: last ? EXPEDITION.regionEndSelector[region.index] : null,
        title: last ? region.title : null,
        theme: final ? EXPEDITION.finalTheme : null,
      });
    }
  }
  return nodes;
})();

/** Where the route is blocked for a rank: the start of the first region whose gate it doesn't meet. */
export function gateCap(rank: number): number {
  const blocked = REGIONS.find((r) => rank < r.minRank);
  return blocked ? blocked.start : MAP_LENGTH;
}

export function regionAt(position: number): Region {
  return REGIONS.find((r) => position < r.end) ?? REGIONS[REGIONS.length - 1];
}

export function describeReward(node: MapNode): string {
  const parts: string[] = [];
  if (node.selector) parts.push(`${node.selector}★ selector`);
  if (node.title) parts.push(`title “${node.title}”`);
  if (node.theme) parts.push('Endgame theme');
  if (node.kind === 'final') parts.push('completion record');
  if (node.sparks) parts.push(`${node.sparks.toLocaleString('en-US')} Sparks`);
  if (node.shards) parts.push(`${node.shards} Shards`);
  return parts.join(' + ');
}

// ---------------------------------------------------------------- progress

/** All fitness points that counted, across every week (the activity cap applies per week). */
export function lifetimePoints(state: AppState): { points: number; sessions: number } {
  const byWeek = new Map<string, FitnessEntry[]>();
  for (const e of state.fitness.values()) byWeek.set(e.weekKey, [...(byWeek.get(e.weekKey) ?? []), e]);
  let points = 0;
  let sessions = 0;
  for (const week of byWeek.values()) {
    const counted = countedEntryIds(week);
    for (const e of week) {
      if (!counted.has(e.id)) continue;
      points += e.points;
      sessions++;
    }
  }
  return { points, sessions };
}

/** The rank that gates the map: the current rank, rescaled to the current target. */
export function gateRank(state: AppState, event: FrontierState): number {
  return rankOf(event.rp, rpMax(targetPoints(fitnessTarget(state))));
}

export interface ExpeditionStatus {
  position: number;
  lifetime: number;
  /** Points earned but waiting at a closed gate. */
  banked: number;
  /** The region you're in (or have reached the start of). */
  region: Region;
  /** The gate holding you back, if any. */
  gate: Region | null;
  nextNode: MapNode | null;
  rank: number;
  complete: boolean;
}

export function expeditionStatus(state: AppState): ExpeditionStatus | null {
  const event = frontier(state);
  if (!event) return null;
  const position = event.mapProgress ?? 0;
  const { points } = lifetimePoints(state);
  const rank = gateRank(state, event);
  const cap = gateCap(rank);
  const gateRegion = position >= cap && cap < MAP_LENGTH ? regionAt(cap) : null;
  return {
    position,
    lifetime: points,
    banked: Math.max(0, points - position),
    region: regionAt(Math.min(position, MAP_LENGTH - 1)),
    gate: gateRegion,
    nextNode: MAP_NODES.find((n) => n.at > position) ?? null,
    rank,
    complete: position >= MAP_LENGTH,
  };
}

function ledger(entry: Omit<LedgerEntry, 'id'>): Change {
  return put('ledger', { id: newId(), ...entry });
}

/**
 * Moves the map forward as far as points and rank gates allow, and claims every node passed.
 * Progress only ever moves forward, so a rank drop or a same-day undo never takes anything back,
 * and points that come back after an undo never pay twice.
 */
export function settleExpedition(state: AppState, now: Date): { changes: Change[]; claimed: MapNode[] } {
  const event = frontier(state);
  if (!event) return { changes: [], claimed: [] };
  const from = event.mapProgress ?? 0;
  const { points, sessions } = lifetimePoints(state);
  const to = Math.min(points, gateCap(gateRank(state, event)), MAP_LENGTH);
  if (to <= from) return { changes: [], claimed: [] };

  const at = now.toISOString();
  const claimed = MAP_NODES.filter((n) => n.at > from && n.at <= to);
  const changes: Change[] = [];
  const titles = [...(event.titles ?? [])];
  const themes = [...(event.themes ?? [])];
  let completion = event.completion ?? null;
  for (const node of claimed) {
    const region = REGIONS[node.region];
    const note =
      node.kind === 'cache' ? `Expedition cache (node ${node.index})` : node.selector ? `${region.name} cleared` : `Expedition node ${node.index}`;
    if (node.sparks) changes.push(ledger({ at, currency: 'sparks', amount: node.sparks, reason: 'event_node', note }));
    if (node.shards) changes.push(ledger({ at, currency: 'shards', amount: node.shards, reason: 'event_node', note }));
    if (node.selector) {
      changes.push(
        put('selectors', {
          id: newId(),
          rarity: node.selector,
          source: note,
          createdAt: at,
          usedAt: null,
          indulgenceId: null,
          name: null,
        }),
      );
    }
    if (node.title && !titles.includes(node.title)) titles.push(node.title);
    if (node.theme && !themes.includes(node.theme)) themes.push(node.theme);
    if (node.kind === 'final' && !completion) {
      const weeks = Math.round((Date.parse(weekKeyOf(dayKeyOf(now))) - Date.parse(event.startedWeek)) / (7 * 86_400_000)) + 1;
      const record: ExpeditionRecord = { at, peakRank: event.peakRank, sessions, weeks };
      completion = record;
    }
  }
  const newestTitle = [...claimed].reverse().find((n) => n.title)?.title;
  changes.push(
    put('events', {
      ...event,
      mapProgress: to,
      titles,
      themes,
      completion,
      // A newly earned title is shown straight away.
      activeTitle: newestTitle ?? event.activeTitle ?? null,
    }),
  );
  return { changes, claimed };
}

// ---------------------------------------------------------------- weekly report

export interface WeekReport {
  week: EventWeek;
  /** Nodes reached during that week (empty for weeks closed before the map existed). */
  nodes: MapNode[];
  mapFrom: number | null;
  mapTo: number | null;
}

/** Closed weeks whose report hasn't been shown yet, oldest first. */
export function unseenReports(state: AppState): WeekReport[] {
  const weeks = [...state.eventWeeks.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  return weeks
    .map((week, i) => {
      const prev = weeks[i - 1];
      const mapTo = week.mapAtClose ?? null;
      const mapFrom = mapTo === null ? null : (prev?.mapAtClose ?? 0);
      const nodes = mapTo === null ? [] : MAP_NODES.filter((n) => n.at > mapFrom! && n.at <= mapTo);
      return { week, nodes, mapFrom, mapTo };
    })
    .filter((r) => !r.week.seen);
}

export function markReportsSeen(state: AppState): ActionResult {
  const changes = [...state.eventWeeks.values()]
    .filter((w) => !w.seen)
    .map((w) => put('eventWeeks', { ...w, seen: true }));
  return done(changes, undefined);
}

// ---------------------------------------------------------------- selectors, titles, theme

/** Opens a selector: the chosen active indulgence of its rarity goes into the Bag. */
export function useSelector(state: AppState, selectorId: string, indulgenceId: string, now: Date): ActionResult<{ name: string }> {
  const selector = state.selectors.get(selectorId);
  if (!selector) throw new ActionError('That selector no longer exists.');
  if (selector.usedAt) throw new ActionError('That selector has already been used.');
  const item = state.indulgences.get(indulgenceId);
  if (!item || !item.active) throw new ActionError('Pick an active indulgence.');
  if (item.rarity !== selector.rarity) throw new ActionError(`This selector is for a ${selector.rarity}★ indulgence.`);
  return done(
    [put('selectors', { ...selector, usedAt: now.toISOString(), indulgenceId: item.id, name: item.name })],
    { name: item.name },
  );
}

export function setActiveTitle(state: AppState, title: string | null): ActionResult {
  const event = frontier(state);
  if (!event) throw new ActionError('The expedition has not started yet.');
  if (title !== null && !(event.titles ?? []).includes(title)) throw new ActionError('You have not earned that title yet.');
  return done([put('events', { ...event, activeTitle: title })], undefined);
}
