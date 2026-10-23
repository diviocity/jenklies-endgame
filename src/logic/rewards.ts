import { ECONOMY } from '../config';
import type { TemplateTask } from '../types';

/** Total weight of every task occurrence in one week of the template. */
export function weeklyWeight(tasks: Pick<TemplateTask, 'weight' | 'days'>[]): number {
  return tasks.reduce((sum, t) => sum + t.weight * t.days.length, 0);
}

/** Base Sparks per unit of weight, before rounding. */
export function baseRate(tasks: Pick<TemplateTask, 'weight' | 'days'>[]): number {
  const total = weeklyWeight(tasks);
  return total > 0 ? ECONOMY.weeklyBaseTarget / total : 0;
}

export function roundValue(value: number): number {
  return Math.round(value / ECONOMY.roundTo) * ECONOMY.roundTo;
}

export function taskValues(weight: number, rate: number): { base: number; bonus: number } {
  const base = Math.max(ECONOMY.minBase, roundValue(rate * weight));
  return { base, bonus: Math.round(base * ECONOMY.bonusRatio) };
}
