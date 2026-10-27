import { describe, expect, it } from 'vitest';
import { PROVISIONS } from '../src/config';
import { balances, completeTask, ensureDay, setMealRating, today, undoTask } from '../src/logic/actions';
import type { ActionResult } from '../src/logic/errors';
import { ensureEvent } from '../src/logic/event';
import { startHibernation, wakeUp } from '../src/logic/hibernation';
import { earnedTitles, unlockedThemes } from '../src/logic/honors';
import { frontier } from '../src/logic/event';
import { migrate } from '../src/logic/migrate';
import {
  cardProgress,
  ensureProvisions,
  logPrep,
  milestonesThrough,
  nextMilestone,
  provisions,
  provisionsAlert,
  supplyFor,
  supplyWeekOf,
  weekMeals,
} from '../src/logic/provisions';
import { applyChanges, emptyState, getMeta, put, seedChanges } from '../src/logic/state';
import type { AppState } from '../src/types';

// Oct 30 2026 is a Friday; Monday Nov 2 starts a week, and Nov 9 the next one.
const at = (month: 9 | 10, day: number, h = 12, m = 0) => new Date(2026, month, day, h, m);
const oct = (day: number, h = 12, m = 0) => at(9, day, h, m);
const nov = (day: number, h = 12, m = 0) => at(10, day, h, m);

function tick(state: AppState, now: Date) {
  applyChanges(state, ensureDay(state, now));
  applyChanges(state, ensureEvent(state, now));
  applyChanges(state, ensureProvisions(state, now));
}

function setup(now = oct(30, 9)): AppState {
  const state = emptyState();
  applyChanges(state, seedChanges(now.toISOString()));
  tick(state, now);
  return state;
}

function run<T>(state: AppState, result: ActionResult<T>): T {
  applyChanges(state, result.changes);
  return result.result;
}

/** Opens a day and eats its first `n` meals (all of them by default), on plan unless told otherwise. */
function eat(state: AppState, now: Date, n = Infinity, rating: 'on' | 'off' = 'on') {
  tick(state, now);
  const meals = today(state, now)!.tasks.filter((t) => t.meal && !t.completedAt).slice(0, n);
  for (const m of meals) run(state, completeTask(state, m.id, now, rating));
  return meals.length;
}

/** Shopping Saturday and cooking Sunday: next week's supply line goes up on time. */
function prepWeekend(state: AppState, sat: Date, sun: Date) {
  tick(state, sat);
  run(state, logPrep(state, 'shopping', sat));
  tick(state, sun);
  run(state, logPrep(state, 'cooking', sun));
}

describe('prep logs and the supply line', () => {
  it('Friday–Sunday logs supply the next week; Monday–Thursday the current one', () => {
    expect(supplyWeekOf('2026-10-30')).toBe('2026-11-02'); // Fri
    expect(supplyWeekOf('2026-10-31')).toBe('2026-11-02'); // Sat
    expect(supplyWeekOf('2026-11-01')).toBe('2026-11-02'); // Sun
    expect(supplyWeekOf('2026-11-02')).toBe('2026-11-02'); // Mon
    expect(supplyWeekOf('2026-11-05')).toBe('2026-11-02'); // Thu
    expect(supplyWeekOf('2026-11-06')).toBe('2026-11-09'); // Fri
  });

  it('is up on time with both logged before the reset, late during the week, and down otherwise', () => {
    const onTime = setup();
    prepWeekend(onTime, oct(31), nov(1));
    expect(supplyFor(onTime, '2026-11-02').status).toBe('onTime');

    const late = setup();
    tick(late, oct(31));
    run(late, logPrep(late, 'shopping', oct(31)));
    expect(supplyFor(late, '2026-11-02').status).toBe('down'); // shopping alone isn't enough
    tick(late, nov(3));
    run(late, logPrep(late, 'cooking', nov(3)));
    expect(supplyFor(late, '2026-11-02').status).toBe('late');

    const down = setup();
    expect(supplyFor(down, '2026-11-02').status).toBe('down');
  });

  it('logs prep from tagged tasks (Meijer run is shopping, meal prep is cooking)', () => {
    const state = setup();
    tick(state, oct(31, 9));
    const meijer = today(state, oct(31, 9))!.tasks.find((t) => t.name === 'Meijer run')!;
    expect(run(state, completeTask(state, meijer.id, oct(31, 10))).prep).toBe('shopping');
    tick(state, nov(1, 9));
    const prep = today(state, nov(1, 9))!.tasks.find((t) => t.name.startsWith('Meal prep'))!;
    run(state, completeTask(state, prep.id, nov(1, 15)));
    expect(supplyFor(state, '2026-11-02').status).toBe('onTime');
    // Undoing the task takes the log back.
    run(state, undoTask(state, prep.id, nov(1, 16)));
    expect(supplyFor(state, '2026-11-02').status).toBe('down');
  });
});

describe('stamps', () => {
  it('count double in a week whose supply line went up on time', () => {
    const state = setup();
    prepWeekend(state, oct(31), nov(1));
    eat(state, nov(2, 8), 1);
    expect(cardProgress(state)).toMatchObject({ counted: 2, held: 0 });
  });

  it('are held while the supply line is down, then released at single value when it goes up late', () => {
    const state = setup();
    const result = (() => {
      tick(state, nov(2, 8));
      const meal = today(state, nov(2, 8))!.tasks.find((t) => t.meal)!;
      return run(state, completeTask(state, meal.id, nov(2, 8)));
    })();
    expect(result.stamp).toEqual({ value: 1, held: true });
    eat(state, nov(2, 20));
    expect(cardProgress(state)).toMatchObject({ counted: 0, held: 3 });
    tick(state, nov(3));
    run(state, logPrep(state, 'shopping', nov(3)));
    run(state, logPrep(state, 'cooking', nov(3)));
    expect(cardProgress(state)).toMatchObject({ counted: 3, held: 0 });
    eat(state, nov(3, 20));
    expect(cardProgress(state).counted).toBe(6);
  });

  it('held stamps expire at the reset if the supply line is still down', () => {
    const state = setup();
    eat(state, nov(2, 20));
    tick(state, nov(9, 5));
    const week = state.provisionWeeks.get('2026-11-02')!;
    expect(week).toMatchObject({ supply: 'down', expired: 3, stamps: 0, rationSparks: 0 });
    expect([...state.stamps.values()].every((s) => s.status === 'expired')).toBe(true);
    expect(cardProgress(state)).toMatchObject({ counted: 0, held: 0 });
  });

  it('skipped meals earn nothing, and off-plan meals earn no stamp', () => {
    const state = setup();
    prepWeekend(state, oct(31), nov(1));
    eat(state, nov(2, 8), 1);
    eat(state, nov(2, 20), 1, 'off');
    // The third meal of the day is never checked off.
    expect(cardProgress(state).counted).toBe(2);
    expect(weekMeals(state, '2026-11-02', nov(2, 22), '2026-11-02')).toEqual({ scheduled: 3, onPlan: 1 });
  });

  it('a meal’s rating can be changed the same day', () => {
    const state = setup();
    prepWeekend(state, oct(31), nov(1));
    eat(state, nov(2, 8), 1);
    const meal = today(state, nov(2, 9))!.tasks.find((t) => t.meal && t.completedAt)!;
    run(state, setMealRating(state, meal.id, 'off', nov(2, 9)));
    expect(cardProgress(state).counted).toBe(0);
    run(state, setMealRating(state, meal.id, 'on', nov(2, 10)));
    expect(cardProgress(state).counted).toBe(2);
  });
});

describe('cards', () => {
  it('fill at 21 stamps, pay 1,000 + 3 Shards, and carry the extra over', () => {
    const state = setup();
    prepWeekend(state, oct(31), nov(1));
    const before = balances(state);
    eat(state, nov(2, 20)); // 3 meals × 2 = 6
    eat(state, nov(3, 20));
    eat(state, nov(4, 20));
    eat(state, nov(5, 20), 2); // 22
    expect(cardProgress(state)).toMatchObject({ counted: 22, cards: 1, onCard: 1 });
    expect(provisions(state)!.cardsFilled).toBe(1);
    const card = [...state.ledger.values()].filter((e) => e.reason === 'provisions_card');
    expect(card.map((e) => [e.currency, e.amount])).toEqual([
      ['sparks', 1_000],
      ['shards', 3],
    ]);
    expect(balances(state).shards - before.shards).toBe(3);
  });

  it('a same-day undo that unfills a card takes it back, unless it’s been spent', () => {
    const state = setup();
    prepWeekend(state, oct(31), nov(1));
    for (const d of [2, 3, 4]) eat(state, nov(d, 20));
    eat(state, nov(5, 20), 2);
    const last = today(state, nov(5, 21))!.tasks.filter((t) => t.meal && t.completedAt).pop()!;
    run(state, undoTask(state, last.id, nov(5, 21)));
    expect(provisions(state)!.cardsFilled).toBe(0);
    expect(cardProgress(state).counted).toBe(20);

    // Same again, but the Shards are gone.
    const other = setup();
    prepWeekend(other, oct(31), nov(1));
    for (const d of [2, 3, 4]) eat(other, nov(d, 20));
    eat(other, nov(5, 20), 2);
    const shards = balances(other).shards;
    applyChanges(other, [put('ledger', { id: 'spent', at: nov(5, 21).toISOString(), currency: 'shards', amount: -shards, reason: 'shop', note: 'shop' })]);
    const meal = today(other, nov(5, 21))!.tasks.filter((t) => t.meal && t.completedAt).pop()!;
    expect(() => undoTask(other, meal.id, nov(5, 22))).toThrow('already been spent');
  });
});

describe('weekly ration report', () => {
  const week = (onPlanMeals: number) => {
    const state = setup(nov(1, 9)); // starts Sunday, so the week of Nov 2 is fully tracked
    run(state, logPrep(state, 'shopping', nov(1, 9)));
    run(state, logPrep(state, 'cooking', nov(1, 10)));
    let left = onPlanMeals;
    for (let d = 2; d <= 8; d++) {
      const day = nov(d, 20);
      tick(state, day);
      const meals = today(state, day)!.tasks.filter((t) => t.meal);
      for (const m of meals) run(state, completeTask(state, m.id, day, left-- > 0 ? 'on' : 'off'));
    }
    const before = balances(state);
    tick(state, nov(9, 5));
    return { state, week: state.provisionWeeks.get('2026-11-02')!, paid: balances(state).sparks - before.sparks };
  };

  it('pays 500 + 5 Shards at 85% on plan with the supply line up', () => {
    const { week: w } = week(18); // 18/21 = 85.7%
    expect(w).toMatchObject({ scheduled: 21, onPlan: 18, supply: 'onTime', rationSparks: 500, rationShards: 5 });
  });

  it('pays nothing below 85%', () => {
    const { week: w } = week(17); // 81%
    expect(w).toMatchObject({ onPlan: 17, rationSparks: 0 });
  });

  it('forfeits the ration when the supply line is down at the reset', () => {
    const state = setup(nov(1, 9));
    for (let d = 2; d <= 8; d++) eat(state, nov(d, 20));
    tick(state, nov(9, 5));
    expect(state.provisionWeeks.get('2026-11-02')).toMatchObject({ onPlan: 21, supply: 'down', rationSparks: 0, expired: 21 });
  });

  it('counts the meals of days the app wasn’t opened as missed', () => {
    const state = setup(nov(1, 9));
    eat(state, nov(2, 20));
    tick(state, nov(9, 5));
    expect(state.provisionWeeks.get('2026-11-02')).toMatchObject({ scheduled: 21, onPlan: 3 });
  });
});

describe('hibernation', () => {
  it('hibernated days have no meals due, so the 85% is over active days only', () => {
    const state = setup(nov(1, 9));
    run(state, logPrep(state, 'shopping', nov(1, 9)));
    run(state, logPrep(state, 'cooking', nov(1, 10)));
    for (let d = 2; d <= 5; d++) eat(state, nov(d, 20)); // Mon–Thu: 12 meals
    run(state, startHibernation(state, '2026-11-08', nov(6, 5))); // Fri–Sun
    tick(state, nov(9, 5));
    expect(state.provisionWeeks.get('2026-11-02')).toMatchObject({ hibernatedDays: 3, scheduled: 12, onPlan: 12, rationSparks: 500 });
  });

  it('a mostly hibernated week skips the supply check: held stamps count instead of expiring', () => {
    const state = setup(nov(1, 9));
    eat(state, nov(2, 20));
    eat(state, nov(3, 8), 1);
    run(state, startHibernation(state, null, nov(3, 9)));
    tick(state, nov(9, 5));
    expect(state.provisionWeeks.get('2026-11-02')).toMatchObject({ supply: 'skipped', stamps: 4, expired: 0, rationSparks: 0 });
    expect(cardProgress(state).counted).toBe(4);
  });

  it('blocks prep logging and pays cards only after waking', () => {
    const state = setup();
    prepWeekend(state, oct(31), nov(1));
    for (const d of [2, 3, 4]) eat(state, nov(d, 20));
    eat(state, nov(5, 8), 1); // 20 stamps
    run(state, startHibernation(state, null, nov(5, 9)));
    expect(() => logPrep(state, 'shopping', nov(5, 10))).toThrow('hibernating');
    // A held-over stamp released while hibernating doesn't pay a card until waking.
    const p = provisions(state)!;
    applyChanges(state, [put('stamps', { id: 'x', taskId: 'x', dayKey: '2026-11-05', weekKey: '2026-11-02', at: nov(5, 8).toISOString(), status: 'counted', value: 1 })]);
    tick(state, nov(5, 11));
    expect(provisions(state)!.cardsFilled).toBe(p.cardsFilled);
    run(state, wakeUp(state, nov(6, 9)));
    tick(state, nov(6, 9, 1));
    expect(provisions(state)!.cardsFilled).toBe(1);
  });

  it('shows no alert while hibernating', () => {
    const state = setup(nov(2, 9));
    expect(provisionsAlert(state, nov(2, 10)).down).toBe(true);
    run(state, startHibernation(state, null, nov(2, 11)));
    expect(provisionsAlert(state, nov(2, 12)).down).toBe(false);
  });
});

describe('the spoilage reminder', () => {
  it('appears when shopping was more than 2 days ago and cooking hasn’t followed', () => {
    const state = setup(nov(2, 9));
    run(state, logPrep(state, 'shopping', nov(2, 9)));
    expect(provisionsAlert(state, nov(4, 9)).spoiling).toBeNull();
    expect(provisionsAlert(state, nov(5, 9)).spoiling?.dayKey).toBe('2026-11-02');
    run(state, logPrep(state, 'cooking', nov(5, 10)));
    expect(provisionsAlert(state, nov(5, 11)).spoiling).toBeNull();
  });
});

describe('upgrading to version 6', () => {
  it('tags meals and prep in the template and today, and stamps meals already eaten today', () => {
    const state = setup(nov(2, 9));
    // Strip the tags to look like version-5 data with breakfast already done.
    for (const t of state.templateTasks.values()) applyChanges(state, [put('templateTasks', { ...t, meal: undefined, prep: undefined })]);
    const day = today(state, nov(2, 9))!;
    const breakfast = day.tasks.find((t) => t.name.startsWith('Breakfast'))!;
    const tasks = day.tasks.map((t) => ({ ...t, meal: undefined, prep: undefined, ...(t.id === breakfast.id ? { completedAt: nov(2, 8).toISOString(), onTime: true } : {}) }));
    applyChanges(state, [put('days', { ...day, tasks }), put('meta', { ...getMeta(state), schemaVersion: 5 })]);
    applyChanges(state, migrate(state, nov(2, 9)));
    const template = [...state.templateTasks.values()];
    expect(template.filter((t) => t.meal).map((t) => t.name).sort()).toEqual([
      'Breakfast + BP meds',
      'Breakfast + BP meds',
      'Dinner (order out)',
      'Dinner (prepped meal)',
      'Dinner (prepped meal)',
      'Lunch smoothie',
      'Lunch smoothie',
    ]);
    expect(template.find((t) => t.name === 'Meijer run')!.prep).toBe('shopping');
    expect(template.find((t) => t.name.startsWith('Meal prep'))!.prep).toBe('cooking');
    expect(template.find((t) => t.name === 'Prep chicken')!.prep).toBeNull();
    expect(today(state, nov(2, 9))!.tasks.find((t) => t.id === breakfast.id)).toMatchObject({ meal: true, mealRating: 'on' });
    expect(state.stamps.size).toBe(1);
    expect(PROVISIONS.stampsPerCard).toBe(21);
  });
});

describe('milestones', () => {
  /** Adds counted stamp value directly, as if from closed weeks. */
  const bank = (state: AppState, value: number, id = `bank${value}`) =>
    applyChanges(state, [put('stamps', { id, taskId: id, dayKey: '2026-10-26', weekKey: '2026-10-26', at: oct(26).toISOString(), status: 'counted', value })]);
  const selectors = (state: AppState) => [...state.selectors.values()].map((s) => `${s.rarity}★ ${s.source}`);

  it('has the agreed thresholds, with a 5★ selector every 25 cards after the 25th', () => {
    expect(milestonesThrough(100).map((m) => [m.cards, m.sparks, m.selector, m.title, m.theme])).toEqual([
      [1, 1_000, null, 'Well Supplied', null],
      [5, 0, 4, null, null],
      [10, 0, 5, null, null],
      [25, 0, null, 'Provisioner', 'field'],
      [50, 0, 5, null, null],
      [75, 0, 5, null, null],
      [100, 0, 5, null, null],
    ]);
    expect(nextMilestone(0).cards).toBe(1);
    expect(nextMilestone(25).cards).toBe(50);
    expect(nextMilestone(60).cards).toBe(75);
  });

  it('the 1st card pays 1,000 Sparks and “Well Supplied”, shown straight away', () => {
    const state = setup();
    const before = balances(state).sparks;
    bank(state, 21);
    tick(state, oct(30, 10));
    expect(provisions(state)!.cardsFilled).toBe(1);
    expect(balances(state).sparks - before).toBe(PROVISIONS.card.sparks + 1_000);
    expect(earnedTitles(state)).toEqual(['Well Supplied']);
    expect(frontier(state)!.activeTitle).toBe('Well Supplied');
  });

  it('the 5th and 10th cards give 4★ and 5★ selectors; the 25th Provisioner and the Field Kitchen theme', () => {
    const state = setup();
    bank(state, 21 * 25);
    tick(state, oct(30, 10));
    expect(selectors(state)).toEqual([
      '4★ Contingency Provisions: 5th card milestone',
      '5★ Contingency Provisions: 10th card milestone',
    ]);
    expect(earnedTitles(state)).toEqual(['Well Supplied', 'Provisioner']);
    expect(unlockedThemes(state)).toEqual(['field']);
    expect(frontier(state)!.activeTitle).toBe('Provisioner');
    bank(state, 21 * 25, 'more');
    tick(state, oct(30, 11));
    expect(selectors(state)).toContain('5★ Contingency Provisions: 50th card milestone');
  });

  it('a same-day undo that unfills a milestone card takes the milestone back too', () => {
    const state = setup();
    prepWeekend(state, oct(31), nov(1));
    for (const d of [2, 3, 4]) eat(state, nov(d, 20));
    const result = (() => {
      tick(state, nov(5, 20));
      const meals = today(state, nov(5, 20))!.tasks.filter((t) => t.meal).slice(0, 2);
      run(state, completeTask(state, meals[0].id, nov(5, 20)));
      return run(state, completeTask(state, meals[1].id, nov(5, 20)));
    })();
    expect(result.milestones.map((m) => m.id)).toEqual(['cards-1']);
    const last = today(state, nov(5, 21))!.tasks.filter((t) => t.meal && t.completedAt).pop()!;
    const before = balances(state).sparks;
    run(state, undoTask(state, last.id, nov(5, 21)));
    expect(earnedTitles(state)).toEqual([]);
    expect(frontier(state)!.activeTitle).toBeNull();
    expect(provisions(state)!.milestones).toEqual([]);
    expect(before - balances(state).sparks).toBe(100 + PROVISIONS.card.sparks + 1_000); // the meal was late: 100
  });

  it('refuses the undo once the milestone’s selector has been opened', () => {
    const state = setup();
    bank(state, 21 * 4 + 20); // 4 cards and 20 stamps
    prepWeekend(state, oct(31), nov(1));
    tick(state, nov(2, 8));
    const meal = today(state, nov(2, 8))!.tasks.find((t) => t.meal)!;
    run(state, completeTask(state, meal.id, nov(2, 8))); // +2: the 5th card
    const [sel] = [...state.selectors.values()].filter((s) => s.source.includes('5th card'));
    applyChanges(state, [put('selectors', { ...sel, usedAt: nov(2, 9).toISOString(), indulgenceId: 'x', name: 'x' })]);
    expect(() => undoTask(state, meal.id, nov(2, 10))).toThrow('already been opened');
  });

  it('catches up on milestones for cards filled before milestones existed', () => {
    const state = setup();
    bank(state, 21);
    applyChanges(state, [put('provisions', { ...provisions(state)!, cardsFilled: 1, milestones: undefined })]);
    tick(state, oct(30, 10));
    expect(provisions(state)!.milestones!.map((c) => c.id)).toEqual(['cards-1']);
    expect(earnedTitles(state)).toEqual(['Well Supplied']);
  });

  it('waits while hibernating', () => {
    const state = setup();
    run(state, startHibernation(state, null, oct(30, 10)));
    bank(state, 21);
    tick(state, oct(30, 11));
    expect(provisions(state)!.cardsFilled).toBe(0);
    expect(earnedTitles(state)).toEqual([]);
    run(state, wakeUp(state, oct(31, 9)));
    tick(state, oct(31, 9, 1));
    expect(earnedTitles(state)).toEqual(['Well Supplied']);
  });
});
