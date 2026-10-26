import { describe, expect, it } from 'vitest';
import { balances } from '../src/logic/actions';
import {
  activeSlots,
  ageTag,
  deleteSaleItem,
  depot,
  depotView,
  ensureDepot,
  featureQueue,
  listItem,
  markHandedOff,
  markPhotographed,
  markSold,
  milestonesThrough,
  moneyRecord,
  nextMilestone,
  parseDollars,
  saleFellThrough,
  saveSaleItem,
  stageOf,
  takeDown,
  undoStep,
} from '../src/logic/depot';
import type { ActionResult } from '../src/logic/errors';
import { ensureEvent, frontier } from '../src/logic/event';
import { earnedTitles, unlockedThemes } from '../src/logic/honors';
import { applyChanges, emptyState, put, seedChanges } from '../src/logic/state';
import type { AppState } from '../src/types';

// Monday, Oct 26, 2026 is the start of a week. `at(26, 9)` is that Monday at 9 AM.
const at = (day: number, h = 12, m = 0) => new Date(2026, 9, day, h, m);

function setup(now = at(26, 9)): AppState {
  const state = emptyState();
  applyChanges(state, seedChanges(now.toISOString()));
  tick(state, now);
  return state;
}

function tick(state: AppState, now: Date) {
  applyChanges(state, ensureEvent(state, now));
  applyChanges(state, ensureDepot(state, now));
}

function run<T>(state: AppState, result: ActionResult<T>): T {
  applyChanges(state, result.changes);
  return result.result;
}

function add(state: AppState, name: string, now: Date): string {
  return run(state, saveSaleItem(state, { name, notes: '', category: '' }, now)).id;
}

const featuredNames = (state: AppState) => activeSlots(state).map((s) => state.saleItems.get(s.itemId)!.name);
const sparks = (state: AppState) => balances(state).sparks;

describe('featured slots', () => {
  it('features the first two items straight away, then waits for the reset', () => {
    const state = setup();
    add(state, 'Lamp', at(26, 10));
    expect(featuredNames(state)).toEqual(['Lamp']);
    add(state, 'Desk', at(26, 11));
    expect(featuredNames(state)).toEqual(['Lamp', 'Desk']);
    add(state, 'Chair', at(26, 12));
    expect(featuredNames(state)).toEqual(['Lamp', 'Desk']);
  });

  it('a listed lot leaves its slot, which stays open until the reset', () => {
    const state = setup();
    const lamp = add(state, 'Lamp', at(26, 10));
    add(state, 'Desk', at(26, 10));
    add(state, 'Chair', at(26, 10));
    run(state, listItem(state, lamp, ['eBay'], at(27)));
    expect(featuredNames(state)).toEqual(['Desk']);
    tick(state, at(28));
    expect(featuredNames(state)).toEqual(['Desk']);
    expect(depotView(state, at(28)).upNext.map((i) => i.name)).toEqual(['Chair']);
    tick(state, at(33, 4, 1)); // next Monday, just after 4 AM
    expect(featuredNames(state)).toEqual(['Chair', 'Desk']);
  });

  it('picks photographed-but-unlisted items first (oldest photo), then the oldest cataloged', () => {
    const state = setup();
    // Fill both slots first so the rest queue up.
    const a = add(state, 'A', at(26, 9));
    const b = add(state, 'B', at(26, 9));
    const old = add(state, 'Oldest cataloged', at(26, 10));
    add(state, 'Newer cataloged', at(26, 11));
    const p2 = add(state, 'Photo second', at(26, 12));
    const p1 = add(state, 'Photo first', at(26, 13));
    run(state, markPhotographed(state, p1, at(27, 8)));
    run(state, markPhotographed(state, p2, at(27, 9)));
    expect(featureQueue(state).map((i) => i.name)).toEqual(['Photo first', 'Photo second', 'Oldest cataloged', 'Newer cataloged']);
    run(state, listItem(state, a, ['eBay'], at(28)));
    run(state, listItem(state, b, ['eBay'], at(28)));
    tick(state, at(33, 5));
    expect(featuredNames(state)).toEqual(['Photo first', 'Photo second']);
    expect(old).toBeTruthy();
  });

  it('never features an item that was listed before and taken down', () => {
    const state = setup();
    const lamp = add(state, 'Lamp', at(26, 10));
    run(state, listItem(state, lamp, ['eBay'], at(26, 11)));
    run(state, takeDown(state, lamp, at(27)));
    expect(featureQueue(state)).toHaveLength(0);
    tick(state, at(33, 5));
    expect(activeSlots(state)).toHaveLength(0);
  });

  it('carries an unlisted lot over every reset, aging its tag', () => {
    const state = setup();
    add(state, 'Lamp', at(26, 10));
    add(state, 'Desk', at(26, 10));
    add(state, 'Chair', at(26, 10));
    const tags: string[] = [];
    for (const day of [27, 33, 40, 47, 54]) {
      const now = at(day, 9);
      tick(state, now);
      expect(featuredNames(state)).toEqual(['Lamp', 'Desk']);
      tags.push(ageTag(activeSlots(state)[0], now).label);
    }
    expect(tags).toEqual(['New', '1 week', '2 weeks', '3+ weeks', '3+ weeks']);
  });

  it('a deleted lot frees its slot, which stays open until the reset', () => {
    const state = setup();
    const lamp = add(state, 'Lamp', at(26, 10));
    add(state, 'Desk', at(26, 10));
    add(state, 'Chair', at(26, 10));
    run(state, deleteSaleItem(state, lamp, at(27)));
    expect(featuredNames(state)).toEqual(['Desk']);
    tick(state, at(33, 5));
    expect(featuredNames(state)).toEqual(['Chair', 'Desk']);
  });
});

describe('stages and rewards', () => {
  it('pays photo 100, then listing 500 + 250 featured + 250 fresh', () => {
    const state = setup();
    const lamp = add(state, 'Lamp', at(26, 10));
    expect(run(state, markPhotographed(state, lamp, at(26, 11))).sparks).toBe(100);
    expect(run(state, listItem(state, lamp, ['eBay', 'Discord'], at(27))).sparks).toBe(1_000);
    expect(sparks(state)).toBe(1_100);
    expect(state.saleItems.get(lamp)!.platforms).toEqual(['eBay', 'Discord']);
  });

  it('pays listing rewards once per item: taking down and relisting pays nothing', () => {
    const state = setup();
    const lamp = add(state, 'Lamp', at(26, 10));
    run(state, listItem(state, lamp, ['eBay'], at(26, 11)));
    const after = sparks(state);
    run(state, takeDown(state, lamp, at(28)));
    expect(stageOf(state.saleItems.get(lamp)!)).toBe('photographed');
    expect(run(state, listItem(state, lamp, ['Facebook Marketplace'], at(29))).sparks).toBe(0);
    expect(sparks(state)).toBe(after);
    expect(depot(state)!.listedCount).toBe(1);
  });

  it('listing an item never photographed marks it photographed and pays both', () => {
    const state = setup();
    const lamp = add(state, 'Lamp', at(26, 10));
    // Featured + fresh (both marked at once counts as fresh).
    expect(run(state, listItem(state, lamp, ['eBay'], at(26, 11))).sparks).toBe(100 + 500 + 250 + 250);
    const item = state.saleItems.get(lamp)!;
    expect(item.photographedAt).not.toBeNull();
    expect(stageOf(item)).toBe('listed');
  });

  it('a non-featured item lists for its base rewards', () => {
    const state = setup();
    add(state, 'A', at(26, 9));
    add(state, 'B', at(26, 9));
    const c = add(state, 'C', at(26, 9));
    run(state, markPhotographed(state, c, at(26, 10)));
    expect(run(state, listItem(state, c, ['eBay'], at(26, 11))).sparks).toBe(500 + 250);
    expect(featureQueue(state).map((i) => i.name)).toEqual([]);
  });

  describe('the fresh window (3 calendar days, 4 AM days)', () => {
    const listedAfterPhoto = (listDay: number, listHour = 12) => {
      const state = setup();
      add(state, 'A', at(26, 9));
      add(state, 'B', at(26, 9));
      const c = add(state, 'C', at(26, 9)); // not featured, so only fresh matters
      run(state, markPhotographed(state, c, at(26, 23)));
      return run(state, listItem(state, c, ['eBay'], at(listDay, listHour))).sparks;
    };
    it('counts on day 3', () => expect(listedAfterPhoto(29, 23)).toBe(750));
    it('counts before 4 AM on day 4 (still day 3)', () => expect(listedAfterPhoto(30, 3)).toBe(750));
    it('ends on day 4', () => expect(listedAfterPhoto(30, 5)).toBe(500));
  });

  it('marking sold on an unlisted item lists it too; the hand-off pays 500 + 2 Shards once', () => {
    const state = setup();
    const lamp = add(state, 'Lamp', at(26, 10));
    const sold = run(state, markSold(state, lamp, { price: '45.50', platform: 'Discord', fees: '' }, at(27)));
    expect(sold.sparks).toBe(1_100);
    const item = state.saleItems.get(lamp)!;
    expect(item.sale).toEqual({ price: 4550, platform: 'Discord', fees: 0 });
    expect(item.platforms).toEqual(['Discord']);
    const handed = run(state, markHandedOff(state, lamp, at(28)));
    expect(handed).toMatchObject({ sparks: 500, shards: 2 });
    expect(depot(state)).toMatchObject({ listedCount: 1, handedOffCount: 1 });
    expect(() => markHandedOff(state, lamp, at(28))).toThrow('Already handed off');
  });

  it('a sale that falls through goes back on the market', () => {
    const state = setup();
    const lamp = add(state, 'Lamp', at(26, 10));
    run(state, listItem(state, lamp, ['eBay', 'Discord'], at(26, 11)));
    run(state, markSold(state, lamp, { price: '20', platform: 'eBay', fees: '2.5' }, at(27)));
    run(state, saleFellThrough(state, lamp, at(29)));
    const item = state.saleItems.get(lamp)!;
    expect(stageOf(item)).toBe('listed');
    expect(item.sale).toBeNull();
    expect(item.platforms).toEqual(['eBay', 'Discord']);
  });

  it('deleting keeps rewards already earned and never lowers the counts', () => {
    const state = setup();
    const lamp = add(state, 'Lamp', at(26, 10));
    run(state, listItem(state, lamp, ['eBay'], at(26, 11)));
    const before = sparks(state);
    run(state, deleteSaleItem(state, lamp, at(27)));
    expect(sparks(state)).toBe(before);
    expect(depot(state)!.listedCount).toBe(1);
  });

  it('parses dollar amounts', () => {
    expect(parseDollars('$1,250.5')).toBe(125_050);
    expect(parseDollars(' ')).toBeNull();
    expect(() => parseDollars('ten')).toThrow();
  });
});

describe('undo', () => {
  it('undoes the latest stage the same day, reversing rewards and reopening the slot', () => {
    const state = setup();
    const lamp = add(state, 'Lamp', at(26, 10));
    run(state, listItem(state, lamp, ['eBay'], at(26, 11)));
    expect(featuredNames(state)).toEqual([]);
    run(state, undoStep(state, lamp, at(26, 15)));
    expect(sparks(state)).toBe(0);
    expect(featuredNames(state)).toEqual(['Lamp']);
    expect(depot(state)!.listedCount).toBe(0);
    const item = state.saleItems.get(lamp)!;
    expect(stageOf(item)).toBe('cataloged');
    // Listing again pays again, since the first payment was taken back.
    expect(run(state, listItem(state, lamp, ['eBay'], at(26, 16))).sparks).toBe(1_100);
  });

  it('only works the same day', () => {
    const state = setup();
    const lamp = add(state, 'Lamp', at(26, 10));
    run(state, markPhotographed(state, lamp, at(26, 11)));
    expect(() => undoStep(state, lamp, at(27, 5))).toThrow('Only today');
  });

  it('is blocked when the rewards are already spent', () => {
    const state = setup();
    const lamp = add(state, 'Lamp', at(26, 10));
    run(state, markPhotographed(state, lamp, at(26, 11)));
    applyChanges(state, [put('ledger', { id: 'spent', at: at(26, 12).toISOString(), currency: 'sparks', amount: -100, reason: 'pull', note: 'pull' })]);
    expect(() => undoStep(state, lamp, at(26, 13))).toThrow('already been spent');
  });
});

describe('weekly mission', () => {
  const weekWith = (listCount: number, items = 2) => {
    const state = setup();
    const ids = Array.from({ length: items }, (_, i) => add(state, `Item ${i}`, at(26, 10)));
    ids.slice(0, listCount).forEach((id) => run(state, listItem(state, id, ['eBay'], at(28))));
    const before = balances(state);
    tick(state, at(33, 5));
    const after = balances(state);
    return { state, sparks: after.sparks - before.sparks, shards: after.shards - before.shards, week: state.depotWeeks.get('2026-10-26')! };
  };

  it('pays 500 + 5 Shards at the reset when every featured lot was listed', () => {
    const { sparks: s, shards, week } = weekWith(2);
    expect([s, shards]).toEqual([500, 5]);
    expect(week).toMatchObject({ completed: true, listed: 2, total: 2, seen: false });
  });

  it('with only one slot filled, listing that one completes it', () => {
    const { sparks: s, week } = weekWith(1, 1);
    expect(s).toBe(500);
    expect(week).toMatchObject({ completed: true, total: 1 });
  });

  it('pays nothing when a featured lot is still unlisted', () => {
    const { sparks: s, week } = weekWith(1);
    expect(s).toBe(0);
    expect(week).toMatchObject({ completed: false, listed: 1, total: 2 });
  });

  it('has no mission without featured lots', () => {
    const { sparks: s, week } = weekWith(0, 0);
    expect(s).toBe(0);
    expect(week).toMatchObject({ total: 0, completed: false, seen: true });
  });

  it('a carried-over lot counts in the next week too', () => {
    const { state } = weekWith(1);
    const [left] = activeSlots(state);
    run(state, listItem(state, left.itemId, ['eBay'], at(34)));
    tick(state, at(40, 5));
    expect(state.depotWeeks.get('2026-11-02')).toMatchObject({ completed: true, total: 1 });
  });

  it('a deleted lot doesn’t count against the mission', () => {
    const state = setup();
    const a = add(state, 'A', at(26, 10));
    const b = add(state, 'B', at(26, 10));
    run(state, listItem(state, a, ['eBay'], at(27)));
    run(state, deleteSaleItem(state, b, at(27)));
    tick(state, at(33, 5));
    expect(state.depotWeeks.get('2026-10-26')).toMatchObject({ completed: true, total: 1 });
  });

  it('closes missed weeks one by one when the app wasn’t opened', () => {
    const state = setup();
    add(state, 'A', at(26, 10));
    tick(state, at(54, 9)); // four resets later
    expect([...state.depotWeeks.keys()].sort()).toEqual(['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16']);
    expect(depot(state)!.currentWeek).toBe('2026-11-23');
    expect(featuredNames(state)).toEqual(['A']);
  });
});

/** Lists (and optionally sells and hands off) `n` new items, one per hour on the Monday. */
function clear(state: AppState, n: number, handOff = true) {
  for (let i = 0; i < n; i++) {
    const now = at(26, 5, i); // minutes apart, same day
    const id = add(state, `Thing ${i}`, now);
    run(state, listItem(state, id, ['eBay'], now));
    if (handOff) {
      run(state, markSold(state, id, { price: '10', platform: 'eBay', fees: '1' }, now));
      run(state, markHandedOff(state, id, now));
    }
  }
}

const selectors = (state: AppState) => [...state.selectors.values()].map((s) => `${s.rarity}★ ${s.source}`);

describe('milestones', () => {
  it('has the agreed thresholds, with a 5★ selector every 10 sales after the 20th', () => {
    expect(milestonesThrough('listed', 50).map((m) => m.id)).toEqual(['listed-1', 'listed-10']);
    expect(milestonesThrough('sold', 50).map((m) => [m.id, m.selector, m.title, m.theme])).toEqual([
      ['sold-1', null, 'Open for Business', null],
      ['sold-5', 4, null, null],
      ['sold-15', 5, null, null],
      ['sold-20', null, 'Quartermaster', 'market'],
      ['sold-30', 5, null, null],
      ['sold-40', 5, null, null],
      ['sold-50', 5, null, null],
    ]);
    expect(milestonesThrough('sold', 1)[0].sparks).toBe(1_000);
    expect(nextMilestone('listed', 9)?.id).toBe('listed-10');
    expect(nextMilestone('listed', 10)).toBeNull();
    expect(nextMilestone('sold', 20)?.id).toBe('sold-30');
    expect(nextMilestone('sold', 34)?.id).toBe('sold-40');
  });

  it('the 1st and 10th listings give a 4★ and a 5★ selector', () => {
    const state = setup();
    clear(state, 1, false);
    expect(selectors(state)).toEqual(['4★ Salvage Exchange: 1st listing milestone']);
    clear(state, 9, false);
    expect(selectors(state)).toContain('5★ Salvage Exchange: 10th listing milestone');
    expect(depot(state)!.milestones).toEqual(['listed-1', 'listed-10']);
  });

  it('the 1st sale pays 1,000 and the title, shown straight away', () => {
    const state = setup();
    const before = sparks(state);
    const id = add(state, 'Lamp', at(26, 10));
    run(state, listItem(state, id, ['eBay'], at(26, 10)));
    run(state, markSold(state, id, { price: '10', platform: 'eBay', fees: '' }, at(26, 11)));
    const result = run(state, markHandedOff(state, id, at(26, 12)));
    expect(result.milestones.map((m) => m.id)).toEqual(['sold-1']);
    expect(sparks(state) - before).toBe(1_100 + 500 + 1_000);
    expect(earnedTitles(state)).toEqual(['Open for Business']);
    expect(frontier(state)!.activeTitle).toBe('Open for Business');
  });

  it('the 20th sale gives Quartermaster and the Market theme; then a 5★ every 10', () => {
    const state = setup();
    clear(state, 20);
    expect(earnedTitles(state)).toEqual(['Open for Business', 'Quartermaster']);
    expect(unlockedThemes(state)).toEqual(['market']);
    expect(frontier(state)!.activeTitle).toBe('Quartermaster');
    clear(state, 10);
    expect(depot(state)!.milestones).toContain('sold-30');
    expect(selectors(state).filter((s) => s.startsWith('5★')).length).toBe(3); // 10th listing, 15th sale, 30th sale
  });

  it('claims each milestone once, even after deleting items', () => {
    const state = setup();
    clear(state, 1);
    for (const id of [...state.saleItems.keys()]) run(state, deleteSaleItem(state, id, at(27)));
    clear(state, 1);
    expect(selectors(state)).toEqual(['4★ Salvage Exchange: 1st listing milestone']);
    expect(depot(state)).toMatchObject({ listedCount: 2, handedOffCount: 2 });
  });

  it('undo takes the milestone back: selector, Sparks, title', () => {
    const state = setup();
    const id = add(state, 'Lamp', at(26, 10));
    run(state, listItem(state, id, ['eBay'], at(26, 10)));
    run(state, undoStep(state, id, at(26, 11)));
    expect(state.selectors.size).toBe(0);
    expect(depot(state)!.milestones).toEqual([]);
    run(state, listItem(state, id, ['eBay'], at(26, 12)));
    run(state, markSold(state, id, { price: '10', platform: 'eBay', fees: '' }, at(26, 13)));
    run(state, markHandedOff(state, id, at(26, 14)));
    const before = sparks(state);
    run(state, undoStep(state, id, at(26, 15)));
    expect(before - sparks(state)).toBe(500 + 1_000);
    expect(earnedTitles(state)).toEqual([]);
    expect(frontier(state)!.activeTitle).toBeNull();
  });

  it('undo is blocked once the milestone’s selector has been opened', () => {
    const state = setup();
    const id = add(state, 'Lamp', at(26, 10));
    run(state, listItem(state, id, ['eBay'], at(26, 10)));
    const [sel] = state.selectors.values();
    applyChanges(state, [put('selectors', { ...sel, usedAt: at(26, 11).toISOString(), indulgenceId: 'x', name: 'x' })]);
    expect(() => undoStep(state, id, at(26, 12))).toThrow('already been opened');
  });

  it('undoing the 20th sale switches the Market theme back off', () => {
    const state = setup();
    clear(state, 20);
    const meta = state.meta.get('meta')!;
    applyChanges(state, [put('meta', { ...meta, settings: { ...meta.settings, theme: 'market' } })]);
    const last = [...state.saleItems.values()].find((i) => i.name === 'Thing 19')!;
    run(state, undoStep(state, last.id, at(26, 9)));
    expect(unlockedThemes(state)).toEqual([]);
    expect(state.meta.get('meta')!.settings.theme).toBe('default');
    expect(frontier(state)!.activeTitle).toBe('Open for Business');
  });

  it('catches up on milestones reached before they existed', () => {
    const state = setup();
    const d = depot(state)!;
    applyChanges(state, [put('depot', { ...d, listedCount: 3, handedOffCount: 1, milestones: undefined })]);
    tick(state, at(26, 13));
    expect(depot(state)!.milestones).toEqual(['listed-1', 'sold-1']);
    expect(state.selectors.size).toBe(1);
    expect(earnedTitles(state)).toEqual(['Open for Business']);
  });
});

describe('money record', () => {
  it('totals sales, fees and net, by platform and month, with days to sell', () => {
    const state = setup();
    const a = add(state, 'A', at(26, 10));
    run(state, listItem(state, a, ['eBay'], at(26, 10)));
    run(state, markSold(state, a, { price: '40', platform: 'eBay', fees: '5.20' }, at(30, 10))); // 4 days
    const b = add(state, 'B', at(26, 10));
    run(state, listItem(state, b, ['Discord'], at(26, 10)));
    run(state, markSold(state, b, { price: '25.50', platform: 'Discord', fees: '' }, at(33, 10))); // Nov 2, 7 days
    const c = add(state, 'C', at(26, 10));
    run(state, markSold(state, c, { price: '10', platform: 'eBay', fees: '' }, at(28, 10))); // never listed first
    const money = moneyRecord(state);
    expect(money.total).toMatchObject({ count: 3, gross: 7_550, fees: 520, net: 7_030 });
    expect(money.byPlatform.map((l) => [l.key, l.count, l.net])).toEqual([
      ['eBay', 2, 4_480],
      ['Discord', 1, 2_550],
    ]);
    expect(money.byMonth.map((l) => [l.key, l.count])).toEqual([
      ['2026-11', 1],
      ['2026-10', 2],
    ]);
    expect(money.avgDaysToSell).toBeCloseTo(5.5, 5);
  });
});
