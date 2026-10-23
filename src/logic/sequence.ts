import type { PullRecord, Rarity } from '../types';

/** Steps of the pull animation. The rarity is only hinted at in 'flash', right before the reveal. */
export type Stage = 'uplink' | 'drop' | 'flash' | 'reveal';

export interface Step {
  stage: Exclude<Stage, 'reveal'>;
  ms: number;
}

export const SEQUENCE = {
  uplinkMs: 1100,
  dropMs: 900,
  /** The colored flash lasts longer the rarer the best result is. */
  flashMs: { 3: 650, 4: 950, 5: 1500 } as Record<Rarity, number>,
  /** Delay before the first card flips, then between flips in a 10-pull. */
  firstFlipMs: 180,
  flipGapMs: 120,
} as const;

export const RARITY_COLOR_NAMES: Record<Rarity, string> = { 3: 'blue', 4: 'purple', 5: 'gold' };

export function bestRarity(results: Pick<PullRecord, 'rarity'>[]): Rarity {
  return results.reduce<Rarity>((best, r) => (r.rarity > best ? r.rarity : best), 3);
}

export function timeline(best: Rarity): Step[] {
  return [
    { stage: 'uplink', ms: SEQUENCE.uplinkMs },
    { stage: 'drop', ms: SEQUENCE.dropMs },
    { stage: 'flash', ms: SEQUENCE.flashMs[best] },
  ];
}

/** The stage after this one ('reveal' is the end). */
export function nextStage(steps: Step[], stage: Stage): Stage {
  const i = steps.findIndex((s) => s.stage === stage);
  return i >= 0 && i + 1 < steps.length ? steps[i + 1].stage : 'reveal';
}

export function rarityCounts(results: Pick<PullRecord, 'rarity'>[]): Record<Rarity, number> {
  const counts: Record<Rarity, number> = { 3: 0, 4: 0, 5: 0 };
  for (const r of results) counts[r.rarity]++;
  return counts;
}
