import { describe, expect, it } from 'vitest';
import { GACHA, SHARDS } from '../src/config';
import { fiveStarChance, rollRarity, seededRng, type PityState } from '../src/logic/gacha';

const always = (x: number) => () => x;

describe('5★ odds', () => {
  it('is 0.6% before soft pity', () => {
    for (let n = 1; n <= 65; n++) expect(fiveStarChance(n)).toBe(0.006);
  });

  it('rises 6 points per pull from pull 66', () => {
    expect(fiveStarChance(66)).toBeCloseTo(0.066, 10);
    expect(fiveStarChance(67)).toBeCloseTo(0.126, 10);
    expect(fiveStarChance(79)).toBeCloseTo(0.846, 10);
  });

  it('is guaranteed by pull 80', () => {
    expect(fiveStarChance(80)).toBe(1);
  });
});

describe('pity', () => {
  it('a 5★ always lands by pull 80, even with the worst luck', () => {
    let state: PityState = { pity5: 0, pity4: 0 };
    const rng = always(0.9999);
    for (let n = 1; n < 80; n++) {
      const r = rollRarity(state, rng);
      expect(r.rarity).not.toBe(5);
      state = r.next;
    }
    const last = rollRarity(state, rng);
    expect(last.rarity).toBe(5);
    expect(last.pity5).toBe(80);
    expect(last.next.pity5).toBe(0);
  });

  it('guarantees a 4★ or higher every 10 pulls', () => {
    let state: PityState = { pity5: 0, pity4: 0 };
    const rng = always(0.9999);
    const rarities: number[] = [];
    for (let n = 0; n < 30; n++) {
      const r = rollRarity(state, rng);
      rarities.push(r.rarity);
      state = r.next;
    }
    expect(rarities.map((r, i) => (r === 4 ? i + 1 : 0)).filter(Boolean)).toEqual([10, 20, 30]);
  });

  it('rolls 5★ below the 5★ chance and 4★ in the next 5.1%', () => {
    const fresh = { pity5: 0, pity4: 0 };
    expect(rollRarity(fresh, always(0.005)).rarity).toBe(5);
    expect(rollRarity(fresh, always(0.006)).rarity).toBe(4);
    expect(rollRarity(fresh, always(0.0569)).rarity).toBe(4);
    expect(rollRarity(fresh, always(0.057)).rarity).toBe(3);
  });

  it('a 5★ does not reset the 4★ counter', () => {
    const r = rollRarity({ pity5: 79, pity4: 9 }, always(0.5));
    expect(r.rarity).toBe(5);
    expect(r.next).toEqual({ pity5: 0, pity4: 10 });
    // The 4★ guarantee carries to the very next pull.
    expect(rollRarity(r.next, always(0.9999)).rarity).toBe(4);
  });

  it('a 4★ resets only the 4★ counter', () => {
    const r = rollRarity({ pity5: 30, pity4: 3 }, always(0.03));
    expect(r.rarity).toBe(4);
    expect(r.next).toEqual({ pity5: 31, pity4: 0 });
  });
});

describe('simulated averages', () => {
  it('matches the brief and never breaks a guarantee: 5★ ~every 57, 4★ ~every 8, ~103 Shards per 80 pulls', () => {
    const rng = seededRng(12345);
    const N = 2_000_000;
    let state: PityState = { pity5: 0, pity4: 0 };
    const counts = { 3: 0, 4: 0, 5: 0 };
    let maxGap5 = 0;
    let maxGap4 = 0;
    let since4 = 0;
    for (let i = 0; i < N; i++) {
      const r = rollRarity(state, rng);
      counts[r.rarity]++;
      if (r.rarity === 5) maxGap5 = Math.max(maxGap5, r.pity5);
      since4++;
      if (r.rarity >= 4) {
        maxGap4 = Math.max(maxGap4, since4);
        since4 = 0;
      }
      state = r.next;
    }
    const per5 = N / counts[5];
    const per4 = N / counts[4];
    const shardsPer80 =
      ((counts[3] * SHARDS.perPull[3] + counts[4] * SHARDS.perPull[4] + counts[5] * SHARDS.perPull[5]) / N) * 80;

    expect(per5).toBeGreaterThan(56);
    expect(per5).toBeLessThan(58.5);
    expect(per4).toBeGreaterThan(7.8);
    expect(per4).toBeLessThan(8.2);
    expect(shardsPer80).toBeGreaterThan(100);
    expect(shardsPer80).toBeLessThan(105);
    expect(maxGap5).toBeLessThanOrEqual(GACHA.hardPity);
    expect(maxGap4).toBeLessThanOrEqual(GACHA.guarantee4);
  });
});
