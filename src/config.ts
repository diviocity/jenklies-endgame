// Every tunable number in the game lives here.

export const ECONOMY = {
  /** Sparks for a perfect week: every task done, every task and bucket on time (80 pulls). */
  perfectWeekTarget: 40_000,
  /** Share of a perfect week paid out as bucket bonuses; the rest is paid per task. */
  bucketShare: 0.75,
  /** Share of each bucket's bonus that is only paid if every task in it was on time. */
  bucketPerfectShare: 0.5,
  /**
   * Days of the week (0 = Sunday … 6 = Saturday) whose buckets pay the perfect bonus for
   * finishing every task that day, on time or not. Each task's own on-time bonus still
   * needs its deadline.
   */
  perfectAnyTimeDays: [6] as readonly number[],
  /** A task's on-time bonus as a fraction of its base value. */
  taskOnTimeRatio: 0.2,
  /** Values are rounded to the nearest multiple of this. */
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

export const FITNESS = {
  /** Points per type: Major 100, Other workout 75, Moderate 50, Minor 10 (keys are the stored codes). */
  points: { crossfit: 100, pt: 50, workout: 75, activity: 10 },
  /** Only this many Minor activities per week earn points. */
  activityWeeklyCap: 7,
  /** Default target week: 3 Major + 3 Moderate + 7 Minor = 520 points. Editable in Settings. */
  defaultTarget: { crossfit: 3, pt: 3, workout: 0, activity: 7 },
} as const;

export const RANK = {
  maxRank: 20,
  /** Normal weekly RP decay. */
  baseDecay: 0.1,
  /** Decay on the 1st, 2nd and 3rd-or-later consecutive weak week. */
  weakDecay: [0.1, 0.15, 0.25],
  /** A week is weak if its points are below this share of RP (the points needed to hold RP steady). */
  weakThreshold: 0.1,
  /** RP_max = rpMaxFactor × (target week points ÷ baseDecay); Rank 20 = doing the full routine. */
  rpMaxFactor: 0.9,
} as const;

export const EXPEDITION = {
  /** The route, in order. Moving forward inside a region needs at least its minimum rank. */
  regions: [
    { name: 'Outskirts', minRank: 1, length: 1_500, title: 'Outskirts Scout' },
    { name: 'Badlands', minRank: 5, length: 1_600, title: 'Badlands Ranger' },
    { name: 'Deep Frontier', minRank: 10, length: 2_600, title: 'Frontier Pathfinder' },
    { name: 'The Wall', minRank: 15, length: 4_200, title: 'Wallbreaker' },
    { name: 'Endgame', minRank: 20, length: 3_600, title: null },
  ],
  /** Nodes are spaced evenly inside each region, about this far apart. */
  nodeSpacing: 260,
  /** Every Nth node along the whole route is a Cache. */
  cacheEvery: 4,
  nodeReward: { sparks: 250, shards: 0 },
  cacheReward: { sparks: 1_000, shards: 5 },
  /** Region-end selectors (they replace the node's Sparks): regions 1–2 give 4★, 3–5 give 5★. */
  regionEndSelector: [4, 4, 5, 5, 5] as (4 | 5)[],
  /** Unlocked by finishing the Endgame. */
  finalTheme: 'endgame',
} as const;

export const WEEKLY_REWARDS = {
  /** Paid at the reset for the week that ended; the higher tier replaces the lower one. */
  half: { share: 0.5, sparks: 500, shards: 2 },
  full: { share: 1, sparks: 1_500, shards: 5 },
  /** Extra Shards for holding Rank 20 at the reset. */
  rank20Shards: 5,
} as const;

export const SCHEMA_VERSION = 3;
