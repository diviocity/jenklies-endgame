// Every tunable number in the game lives here.

export const ECONOMY = {
  /** Sparks for a full week of tasks without any on-time bonuses. */
  weeklyBaseTarget: 20_000,
  /** On-time bonus as a fraction of a task's base value (30,000 for a perfect week). */
  bonusRatio: 0.5,
  /** Task values are rounded to the nearest multiple of this. */
  roundTo: 10,
  /** No task is ever worth less than this many base Sparks. */
  minBase: 10,
} as const;

export const PULLS = {
  singleCost: 500,
  tenCost: 5_000,
} as const;

export const GACHA = {
  /** 5★ base rate per pull. */
  rate5: 0.006,
  /** From this pull number onward, the 5★ chance starts rising. */
  softPityStart: 66,
  /** 5★ chance added per pull from softPityStart onward (pull 66 = rate5 + 1 step). */
  softPityStep: 0.06,
  /** A 5★ is guaranteed on this pull. */
  hardPity: 80,
  /** 4★ base rate per pull. */
  rate4: 0.051,
  /** At least one 4★-or-higher every this many pulls. */
  guarantee4: 10,
  /** Whether a 5★ also resets the 4★ counter. Off matches the "4★ about every 8" target. */
  fiveResetsFourPity: false,
} as const;

export const SHARDS = {
  /** Shards granted by every pull, by rarity. */
  perPull: { 3: 1, 4: 2, 5: 10 } as Record<3 | 4 | 5, number>,
  /** Shop prices, by rarity. */
  shopPrice: { 4: 20, 5: 100 } as Record<4 | 5, number>,
} as const;

export const DAY = {
  /** Minutes after midnight when a new day begins (4:00 AM). */
  startMinutes: 4 * 60,
} as const;

export const BACKUP = {
  /** Suggest a backup when the last one is older than this many days. */
  remindAfterDays: 7,
} as const;

export const SCHEMA_VERSION = 1;
