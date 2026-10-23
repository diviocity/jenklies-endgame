import { GACHA } from '../config';
import type { Rarity } from '../types';

export type Rng = () => number;

export interface PityState {
  pity5: number;
  pity4: number;
}

export interface RollResult {
  rarity: Rarity;
  /** Which pull this was since the previous 5★ / 4★ (the counter values shown in history). */
  pity5: number;
  pity4: number;
  next: PityState;
}

/** 5★ chance on the nth pull since the last 5★ (n starts at 1). */
export function fiveStarChance(n: number): number {
  if (n >= GACHA.hardPity) return 1;
  if (n >= GACHA.softPityStart) {
    return Math.min(1, GACHA.rate5 + (n - GACHA.softPityStart + 1) * GACHA.softPityStep);
  }
  return GACHA.rate5;
}

export function rollRarity(state: PityState, rng: Rng): RollResult {
  const n5 = state.pity5 + 1;
  const n4 = state.pity4 + 1;
  const chance5 = fiveStarChance(n5);
  const x = rng();

  if (x < chance5) {
    return {
      rarity: 5,
      pity5: n5,
      pity4: n4,
      next: { pity5: 0, pity4: GACHA.fiveResetsFourPity ? 0 : n4 },
    };
  }
  if (n4 >= GACHA.guarantee4 || x < chance5 + GACHA.rate4) {
    return { rarity: 4, pity5: n5, pity4: n4, next: { pity5: n5, pity4: 0 } };
  }
  return { rarity: 3, pity5: n5, pity4: n4, next: { pity5: n5, pity4: n4 } };
}

export function pickIndex(length: number, rng: Rng): number {
  return Math.min(length - 1, Math.floor(rng() * length));
}

/** Uniform [0, 1) from the platform's cryptographic RNG. */
export const cryptoRng: Rng = () => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
};

/** A small seeded RNG (mulberry32) for repeatable tests and simulations. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
