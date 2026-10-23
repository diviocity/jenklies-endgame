import { describe, expect, it } from 'vitest';
import { baseRate, taskValues, weeklyWeight } from '../src/logic/rewards';
import { startingTemplate } from '../src/logic/seed';

describe('reward math', () => {
  const template = startingTemplate();

  it('the starting template has 83 task occurrences a week', () => {
    expect(weeklyWeight(template)).toBe(83);
  });

  it('values each weight-1 task at 240 base + 120 bonus', () => {
    expect(taskValues(1, baseRate(template))).toEqual({ base: 240, bonus: 120 });
  });

  it('a full week lands near 20,000 base and 30,000 with every bonus', () => {
    const { base, bonus } = taskValues(1, baseRate(template));
    expect(Math.abs(83 * base - 20_000)).toBeLessThan(83 * 5 + 1);
    expect(Math.abs(83 * (base + bonus) - 30_000)).toBeLessThan(83 * 10 + 1);
  });

  it('scales with weight and rounds to the nearest 10', () => {
    const rate = 20_000 / 83;
    expect(taskValues(2, rate)).toEqual({ base: 480, bonus: 240 });
    expect(taskValues(0.5, rate)).toEqual({ base: 120, bonus: 60 });
    expect(taskValues(1, 20_000 / 7)).toEqual({ base: 2860, bonus: 1430 });
  });

  it('recalculates when the template changes', () => {
    const smaller = template.slice(0, 1); // "Up at 5:30" on 5 weekdays
    expect(taskValues(1, baseRate(smaller))).toEqual({ base: 4000, bonus: 2000 });
  });

  it('never values a task below the minimum, even with no template', () => {
    expect(baseRate([])).toBe(0);
    expect(taskValues(1, 0)).toEqual({ base: 10, bonus: 5 });
  });
});
