import { ECONOMY } from '../config';
import type { TemplateTask } from '../types';

type Weighted = Pick<TemplateTask, 'weight' | 'days'>;

/** Total weight of every task occurrence in one week of the template. */
export function weeklyWeight(tasks: Weighted[]): number {
  return tasks.reduce((sum, t) => sum + t.weight * t.days.length, 0);
}

/** Sparks per unit of weight, before rounding. */
export interface Rates {
  /** A task's base value (its on-time bonus comes on top). */
  task: number;
  /** A bucket's total bonus (clear + perfect), per unit of weight inside the bucket. */
  bucket: number;
}

/**
 * Splits a perfect week between tasks and buckets:
 * tasks get (1 - bucketShare) including their on-time bonus, buckets get the rest.
 */
export function rates(tasks: Weighted[]): Rates {
  const total = weeklyWeight(tasks);
  if (total === 0) return { task: 0, bucket: 0 };
  const perUnit = ECONOMY.perfectWeekTarget / total;
  return {
    task: (perUnit * (1 - ECONOMY.bucketShare)) / (1 + ECONOMY.taskOnTimeRatio),
    bucket: perUnit * ECONOMY.bucketShare,
  };
}

export function roundValue(value: number): number {
  return Math.round(value / ECONOMY.roundTo) * ECONOMY.roundTo;
}

export function taskValues(
  weight: number,
  taskRate: number,
  onTimeRatio: number = ECONOMY.taskOnTimeRatio,
): { base: number; bonus: number } {
  const base = Math.max(ECONOMY.minBase, roundValue(taskRate * weight));
  return { base, bonus: Math.round(base * onTimeRatio) };
}

/** A bucket's two bonuses: one for clearing it, one more if every task was on time. */
export function bucketValues(bucketWeight: number, bucketRate: number): { bonus: number; perfectBonus: number } {
  const total = bucketRate * bucketWeight;
  return {
    bonus: roundValue(total * (1 - ECONOMY.bucketPerfectShare)),
    perfectBonus: roundValue(total * ECONOMY.bucketPerfectShare),
  };
}
