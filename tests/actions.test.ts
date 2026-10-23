import { describe, expect, it } from 'vitest';
import {
  ActionError,
  addOneOff,
  affirmationCounts,
  balances,
  buy,
  completeTask,
  ensureDay,
  inventory,
  pull,
  pullBlockReason,
  redeem,
  saveIndulgence,
  saveTemplateTask,
  setAffirmationRemoved,
  today,
  undoTask,
  type ActionResult,
} from '../src/logic/actions';
import { seededRng } from '../src/logic/gacha';
import { put, applyChanges, emptyState, getMeta, seedChanges } from '../src/logic/state';
import type { AppState } from '../src/types';

// Tuesday, Oct 20, 2026.
const at = (h: number, m = 0, day = 20) => new Date(2026, 9, day, h, m);

function setup(now = at(7)): AppState {
  const state = emptyState();
  applyChanges(state, seedChanges(now.toISOString()));
  applyChanges(state, ensureDay(state, now));
  return state;
}

function run<T>(state: AppState, result: ActionResult<T>): T {
  applyChanges(state, result.changes);
  return result.result;
}

function grant(state: AppState, sparks: number, shards = 0) {
  const at = new Date().toISOString();
  applyChanges(state, [
    put('ledger', { id: `g${Math.random()}`, at, currency: 'sparks', amount: sparks, reason: 'task', note: 'test' }),
    put('ledger', { id: `h${Math.random()}`, at, currency: 'shards', amount: shards, reason: 'task', note: 'test' }),
  ]);
}

const taskNamed = (state: AppState, name: string, now = at(7)) => today(state, now)!.tasks.find((t) => t.name === name)!;

describe('days', () => {
  it("builds today's tasks from the template", () => {
    const state = setup();
    const day = today(state, at(7))!;
    expect(day.dayType).toBe('weekday');
    expect(day.tasks.map((t) => t.name)).toContain('CrossFit');
    expect(day.tasks.map((t) => t.name)).not.toContain('Shoulder PT');
    expect(day.tasks).toHaveLength(12);
    expect(day.tasks.every((t) => t.base === 240 && t.bonus === 120)).toBe(true);
    expect(taskNamed(state, 'Brush teeth + wind down').deadline).toBe(22 * 60);
  });

  it('builds weekend days with weekend buckets', () => {
    const state = setup(at(10, 0, 25)); // Sunday
    const day = today(state, at(10, 0, 25))!;
    expect(day.buckets.map((b) => b.id)).toEqual(['half1', 'half2']);
    expect(day.tasks).toHaveLength(12);
  });

  it("does not change today's values when the template changes", () => {
    const state = setup();
    run(state, saveTemplateTask(state, { name: 'New', days: [1, 2, 3, 4, 5], bucket: 'morning', deadlineOverride: null, weight: 10 }));
    applyChanges(state, ensureDay(state, at(12)));
    expect(today(state, at(12))!.tasks).toHaveLength(12);
    expect(taskNamed(state, 'Shower').base).toBe(240);
    // Tomorrow picks up the new template.
    applyChanges(state, ensureDay(state, at(5, 0, 21)));
    const tomorrow = today(state, at(5, 0, 21))!;
    expect(tomorrow.tasks).toHaveLength(13);
    expect(tomorrow.tasks.find((t) => t.name === 'Shower')!.base).toBe(150); // 20000 / 133
  });
});

describe('completing tasks', () => {
  it('earns base + bonus on time', () => {
    const state = setup();
    const result = run(state, completeTask(state, taskNamed(state, 'Shower').id, at(8, 30)));
    expect(result).toEqual({ earned: 360, onTime: true });
    expect(balances(state).sparks).toBe(360);
  });

  it('earns base only after the deadline', () => {
    const state = setup();
    const result = run(state, completeTask(state, taskNamed(state, 'Shower').id, at(9, 1)));
    expect(result).toEqual({ earned: 240, onTime: false });
  });

  it('uses the task deadline override', () => {
    const state = setup();
    const id = taskNamed(state, 'Brush teeth + wind down').id;
    expect(run(state, completeTask(state, id, at(21, 45))).onTime).toBe(true);
  });

  it('counts work done before 4 AM toward the previous day', () => {
    const state = setup();
    const id = taskNamed(state, 'Feed the dog').id;
    expect(run(state, completeTask(state, id, at(2, 0, 21))).onTime).toBe(false);
    expect(balances(state).sparks).toBe(240);
  });

  it('locks a day once 4 AM passes', () => {
    const state = setup();
    const id = taskNamed(state, 'Feed the dog').id;
    applyChanges(state, ensureDay(state, at(4, 0, 21)));
    expect(() => completeTask(state, id, at(4, 0, 21))).toThrow(ActionError);
  });

  it('undo reverses the currency the same day', () => {
    const state = setup();
    const id = taskNamed(state, 'Shower').id;
    run(state, completeTask(state, id, at(8)));
    run(state, undoTask(state, id, at(10)));
    expect(balances(state).sparks).toBe(0);
    expect(taskNamed(state, 'Shower').completedAt).toBeNull();
    // Re-completing now is late.
    expect(run(state, completeTask(state, id, at(10))).earned).toBe(240);
  });

  it('blocks undo when the Sparks are already spent', () => {
    const state = setup();
    const id = taskNamed(state, 'Shower').id;
    run(state, completeTask(state, id, at(8)));
    grant(state, -200);
    expect(() => undoTask(state, id, at(10))).toThrow(/already been spent/);
  });

  it('adds one-off tasks at today’s rate', () => {
    const state = setup();
    run(state, addOneOff(state, { name: 'Call the vet', bucket: 'afternoon', deadline: null }, at(11)));
    const task = taskNamed(state, 'Call the vet');
    expect(task).toMatchObject({ oneOff: true, base: 240, bonus: 120, deadline: 17 * 60 });
    expect(() => addOneOff(state, { name: 'x', bucket: 'half1', deadline: null }, at(11))).toThrow(ActionError);
  });
});

describe('pulls', () => {
  it('blocks pulling without enough Sparks', () => {
    const state = setup();
    expect(pullBlockReason(state, 1)).toMatch(/Need 500 more/);
  });

  it('blocks pulling when a pool is empty', () => {
    const state = setup();
    grant(state, 10_000);
    for (const i of state.indulgences.values()) {
      if (i.rarity === 5) run(state, saveIndulgence(state, { ...i, active: false }, at(7)));
    }
    expect(pullBlockReason(state, 1)).toMatch(/5★ indulgence/);
    for (const a of [...state.affirmations.values()]) run(state, setAffirmationRemoved(state, a.id, true));
    expect(pullBlockReason(state, 1)).toMatch(/affirmation/);
  });

  it('charges 500 / 5,000 and grants Shards per pull', () => {
    const state = setup();
    grant(state, 5_500);
    const single = run(state, pull(state, 1, at(12), seededRng(1)));
    const ten = run(state, pull(state, 10, at(12), seededRng(2)));
    expect(single).toHaveLength(1);
    expect(ten).toHaveLength(10);
    expect(ten.every((p) => p.batchSize === 10 && p.batchId === ten[0].batchId)).toBe(true);
    const all = [...single, ...ten];
    const shards = all.reduce((s, p) => s + ({ 3: 1, 4: 2, 5: 10 } as const)[p.rarity], 0);
    expect(balances(state)).toEqual({ sparks: 0, shards });
    expect(ten.some((p) => p.rarity >= 4)).toBe(true);
  });

  it('carries pity across single and 10-pulls', () => {
    const state = setup();
    grant(state, 100_000);
    const results = [];
    for (let i = 0; i < 5; i++) results.push(...run(state, pull(state, 1, at(12), seededRng(i))));
    for (let i = 0; i < 3; i++) results.push(...run(state, pull(state, 10, at(12), seededRng(10 + i))));
    // Each record's pity counter continues from the previous one.
    let expected5 = 1;
    for (const r of results) {
      expect(r.pity5).toBe(expected5);
      expected5 = r.rarity === 5 ? 1 : expected5 + 1;
    }
    expect(getMeta(state).pity5).toBe(expected5 - 1);
  });

  it('marks an affirmation NEW only the first time', () => {
    const state = setup();
    for (const a of [...state.affirmations.values()].slice(1)) run(state, setAffirmationRemoved(state, a.id, true));
    grant(state, 50_000);
    const results = run(state, pull(state, 10, at(12), seededRng(3))).filter((p) => p.kind === 'affirmation');
    expect(results.length).toBeGreaterThan(1);
    expect(results.map((r) => r.isNew)).toEqual([true, ...results.slice(1).map(() => false)]);
    expect(affirmationCounts(state).get(results[0].itemId)).toBe(results.length);
  });

  it('only pulls active indulgences', () => {
    const state = setup();
    const retired = [...state.indulgences.values()].find((i) => i.rarity === 4)!;
    run(state, saveIndulgence(state, { ...retired, active: false }, at(7)));
    grant(state, 500_000);
    for (let i = 0; i < 50; i++) {
      for (const r of run(state, pull(state, 10, at(12), seededRng(100 + i)))) {
        expect(r.itemId).not.toBe(retired.id);
      }
    }
  });
});

describe('shop and inventory', () => {
  it('buys with Shards without touching pity', () => {
    const state = setup();
    grant(state, 0, 120);
    const four = [...state.indulgences.values()].find((i) => i.rarity === 4)!;
    const five = [...state.indulgences.values()].find((i) => i.rarity === 5)!;
    run(state, buy(state, four.id, at(12)));
    run(state, buy(state, five.id, at(12)));
    expect(balances(state).shards).toBe(0);
    expect(() => buy(state, four.id, at(12))).toThrow(/Need 20 more/);
    expect(inventory(state).get(four.id)).toBe(1);
    expect(getMeta(state)).toMatchObject({ pity5: 0, pity4: 0 });
  });

  it('redeeming uses one up', () => {
    const state = setup();
    grant(state, 0, 40);
    const four = [...state.indulgences.values()].find((i) => i.rarity === 4)!;
    run(state, buy(state, four.id, at(12)));
    run(state, buy(state, four.id, at(12)));
    run(state, redeem(state, four.id, at(13)));
    expect(inventory(state).get(four.id)).toBe(1);
    expect(state.redemptions.size).toBe(1);
    run(state, redeem(state, four.id, at(13)));
    expect(() => redeem(state, four.id, at(13))).toThrow(/none of those/);
  });
});

describe('template editor', () => {
  it('rejects weekday buckets on weekend days', () => {
    const state = setup();
    expect(() =>
      saveTemplateTask(state, { name: 'x', days: [0], bucket: 'morning', deadlineOverride: null, weight: 1 }),
    ).toThrow(/Mon–Fri/);
  });
});
