import { describe, expect, it } from 'vitest';
import { bestRarity, nextStage, rarityCounts, timeline } from '../src/logic/sequence';

const pulls = (...rarities: (3 | 4 | 5)[]) => rarities.map((rarity) => ({ rarity }));

describe('pull sequence', () => {
  it('finds the best rarity in a batch', () => {
    expect(bestRarity(pulls(3, 3, 3))).toBe(3);
    expect(bestRarity(pulls(3, 4, 3))).toBe(4);
    expect(bestRarity(pulls(4, 5, 3))).toBe(5);
  });

  it('runs uplink → drop → flash → reveal, with the rarity flash last', () => {
    const steps = timeline(4);
    expect(steps.map((s) => s.stage)).toEqual(['uplink', 'drop', 'flash']);
    expect(nextStage(steps, 'uplink')).toBe('drop');
    expect(nextStage(steps, 'drop')).toBe('flash');
    expect(nextStage(steps, 'flash')).toBe('reveal');
    expect(nextStage(steps, 'reveal')).toBe('reveal');
  });

  it('gives rarer results a longer flash, and only the flash differs', () => {
    const [t3, t4, t5] = ([3, 4, 5] as const).map(timeline);
    const flash = (t: ReturnType<typeof timeline>) => t.find((s) => s.stage === 'flash')!.ms;
    expect(flash(t3)).toBeLessThan(flash(t4));
    expect(flash(t4)).toBeLessThan(flash(t5));
    expect(t3.slice(0, 2)).toEqual(t5.slice(0, 2));
  });

  it('keeps the whole sequence short', () => {
    const total = timeline(5).reduce((s, step) => s + step.ms, 0);
    expect(total).toBeLessThanOrEqual(4000);
  });

  it('counts results by rarity', () => {
    expect(rarityCounts(pulls(3, 3, 4, 5, 3))).toEqual({ 3: 3, 4: 1, 5: 1 });
  });
});
