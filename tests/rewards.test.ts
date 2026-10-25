import { describe, expect, it } from 'vitest';
import { ECONOMY } from '../src/config';
import { bucketValues, rates, taskValues, weeklyWeight } from '../src/logic/rewards';
import { startingTemplate } from '../src/logic/seed';
import { bucketsFor } from '../src/logic/time';
import type { TemplateTask } from '../src/types';

const template = startingTemplate();
const rate = rates(template);

/** Everything one weekday (0–6) of the template pays: per-task values and per-bucket bonuses. */
function dayValues(tasks: TemplateTask[], weekday: number) {
  const type = weekday === 0 || weekday === 6 ? 'weekend' : 'weekday';
  const r = rates(tasks);
  return bucketsFor(type).map((bucket) => {
    const inBucket = tasks.filter((t) => t.bucket === bucket && t.days.includes(weekday));
    const weight = inBucket.reduce((s, t) => s + t.weight, 0);
    return {
      bucket,
      tasks: inBucket.map((t) => taskValues(t.weight, r.task)),
      ...bucketValues(weight, r.bucket),
    };
  });
}

function weekTotals(tasks: TemplateTask[]) {
  let perfect = 0;
  let allLate = 0;
  for (let d = 0; d < 7; d++) {
    for (const b of dayValues(tasks, d)) {
      const base = b.tasks.reduce((s, t) => s + t.base, 0);
      const onTime = b.tasks.reduce((s, t) => s + t.bonus, 0);
      perfect += base + onTime + b.bonus + b.perfectBonus;
      // Saturday buckets pay the perfect bonus for finishing, on time or not.
      allLate += base + b.bonus + (ECONOMY.perfectAnyTimeDays.includes(d) ? b.perfectBonus : 0);
    }
  }
  return { perfect, allLate };
}

describe('reward math', () => {
  it('the starting template has 83 task occurrences a week', () => {
    expect(weeklyWeight(template)).toBe(83);
  });

  it('values each weight-1 task at 100 base + 20 on time', () => {
    expect(taskValues(1, rate.task)).toEqual({ base: 100, bonus: 20 });
  });

  it('pays the agreed bucket bonuses (clear + the same again if perfect)', () => {
    const weekday = Object.fromEntries(dayValues(template, 1).map((b) => [b.bucket, [b.bonus, b.perfectBonus]]));
    expect(weekday).toEqual({ morning: [900, 900], afternoon: [720, 720], evening: [540, 540] });
    const sat = Object.fromEntries(dayValues(template, 6).map((b) => [b.bucket, [b.bonus, b.perfectBonus]]));
    expect(sat).toEqual({ half1: [1450, 1450], half2: [540, 540] });
    const sun = Object.fromEntries(dayValues(template, 0).map((b) => [b.bucket, [b.bonus, b.perfectBonus]]));
    expect(sun).toEqual({ half1: [1080, 1080], half2: [1080, 1080] });
  });

  it('a perfect week is about 40,000 (80 pulls) and buckets are 75% of it', () => {
    const { perfect } = weekTotals(template);
    expect(perfect).toBe(39_860);
    let buckets = 0;
    for (let d = 0; d < 7; d++) for (const b of dayValues(template, d)) buckets += b.bonus + b.perfectBonus;
    expect(buckets / perfect).toBeCloseTo(0.75, 2);
  });

  it('a week with everything done but nothing on time is about 25,240', () => {
    expect(weekTotals(template).allLate).toBe(25_240);
  });

  it('buckets are the majority of a day whether perfect or not', () => {
    const day = dayValues(template, 1);
    const tasks = day.flatMap((b) => b.tasks);
    const perfectTasks = tasks.reduce((s, t) => s + t.base + t.bonus, 0);
    const perfectBuckets = day.reduce((s, b) => s + b.bonus + b.perfectBonus, 0);
    expect(perfectTasks + perfectBuckets).toBe(5_760);
    const lateTasks = tasks.reduce((s, t) => s + t.base, 0);
    const lateBuckets = day.reduce((s, b) => s + b.bonus, 0);
    expect(lateTasks + lateBuckets).toBe(3_360);
    expect(lateBuckets / (lateTasks + lateBuckets)).toBeGreaterThan(0.6);
  });

  it('scales with weight and rounds to the nearest 10', () => {
    expect(taskValues(2, rate.task)).toEqual({ base: 200, bonus: 40 });
    expect(taskValues(0.5, rate.task)).toEqual({ base: 50, bonus: 10 });
  });

  it('recalculates when the template changes', () => {
    const smaller = template.slice(0, 1); // "Up at 5:30" on 5 weekdays
    const r = rates(smaller);
    expect(taskValues(1, r.task)).toEqual({ base: 1670, bonus: 334 });
    expect(bucketValues(1, r.bucket)).toEqual({ bonus: 3000, perfectBonus: 3000 });
  });

  it('never values a task below the minimum, even with no template', () => {
    expect(rates([])).toEqual({ task: 0, bucket: 0 });
    expect(taskValues(1, 0)).toEqual({ base: 10, bonus: 2 });
  });
});
