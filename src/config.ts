// Every tunable number in the game lives here.

export const EVENTS = {
  /** Scales the Sparks and Shards of every event's rewards (not daily tasks), to tune overall pacing in one place. */
  rewardMultiplier: 1.0,
} as const;

/** An event reward scaled by EVENTS.rewardMultiplier: Sparks to the nearest 10, Shards rounded down. */
export function eventReward(sparks: number, shards = 0): { sparks: number; shards: number } {
  return { sparks: eventSparks(sparks), shards: eventShards(shards) };
}

export function eventSparks(sparks: number): number {
  return Math.round((sparks * EVENTS.rewardMultiplier) / 10) * 10;
}

export function eventShards(shards: number): number {
  return Math.floor(shards * EVENTS.rewardMultiplier + 1e-9);
}

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
  nodeReward: eventReward(250, 0),
  cacheReward: eventReward(1_000, 5),
  /** Region-end selectors (they replace the node's Sparks): regions 1–2 give 4★, 3–5 give 5★. */
  regionEndSelector: [4, 4, 5, 5, 5] as (4 | 5)[],
  /** Unlocked by finishing the Endgame. */
  finalTheme: 'endgame',
} as const;

export const WEEKLY_REWARDS = {
  /** Paid at the reset for the week that ended; the higher tier replaces the lower one. */
  half: { share: 0.5, ...eventReward(500, 2) },
  full: { share: 1, ...eventReward(1_500, 5) },
  /** Extra Shards for holding Rank 20 at the reset. */
  rank20Shards: eventShards(5),
} as const;

export const DEPOT = {
  /** Featured lots: the items you're nudged to list next. */
  slots: 2,
  /** Per-item rewards, each paid once per item, ever. */
  photographed: eventReward(100, 0),
  listed: eventReward(500, 0),
  /** Extra when the item was a featured lot at the time it was listed. */
  featuredBonus: eventReward(250, 0),
  /** Extra when listed within this many calendar days (4 AM days) of being photographed. */
  freshDays: 3,
  freshBonus: eventReward(250, 0),
  handedOff: eventReward(500, 2),
  /** Listing every featured lot of the week before the reset. */
  mission: eventReward(500, 5),
  /** Platforms offered out of the box; you can add your own. */
  defaultPlatforms: ['eBay', 'Facebook Marketplace', 'Facebook group', 'Discord'],
  /** Age tags on featured lots, by whole weeks in the slot (the last one covers everything after). */
  ageTags: ['New', '1 week', '2 weeks', '3+ weeks'],
  /** Lifetime milestones, counted in items (deleting an item never sets them back). */
  milestones: {
    listed: [
      { count: 1, sparks: 0, selector: 4, title: null, theme: null },
      { count: 10, sparks: 0, selector: 5, title: null, theme: null },
    ],
    /** Sales count once an item is handed off. */
    sold: [
      { count: 1, sparks: eventSparks(1_000), selector: null, title: 'Open for Business', theme: null },
      { count: 5, sparks: 0, selector: 4, title: null, theme: null },
      { count: 15, sparks: 0, selector: 5, title: null, theme: null },
      { count: 20, sparks: 0, selector: null, title: 'Quartermaster', theme: 'market' },
    ],
  } as Record<'listed' | 'sold', { count: number; sparks: number; selector: 4 | 5 | null; title: string | null; theme: string | null }[]>,
  /** After the last sales milestone, a 5★ selector every this many sales (30th, 40th, 50th…). */
  soldRepeatEvery: 10,
  soldRepeatSelector: 5 as 4 | 5,
} as const;

export const HIBERNATION = {
  /** A week with at least this many hibernated days is skipped by weekly event resets. */
  skipWeekDays: 4,
} as const;

export const PROVISIONS = {
  stampsPerCard: 21,
  /** Stamps count this many times over in a week whose supply line went up on time. */
  onTimeMultiplier: 2,
  /** Each filled card. */
  card: eventReward(1_000, 3),
  /** Weekly ration report: at least this share of the week's scheduled meals (active days) on plan, supply line up. */
  ration: { share: 0.85, ...eventReward(500, 5) },
  /** Prep logged on these weekdays (Fri, Sat, Sun) supplies the next week; Mon–Thu supplies the current one. */
  nextWeekDays: [5, 6, 0] as readonly number[],
  /** Shopping this many days ago with no cooking since shows the spoilage reminder. */
  spoilageDays: 2,
  /** Lifetime milestones, by cards filled. */
  milestones: [
    { cards: 1, sparks: eventSparks(1_000), selector: null, title: 'Well Supplied', theme: null },
    { cards: 5, sparks: 0, selector: 4, title: null, theme: null },
    { cards: 10, sparks: 0, selector: 5, title: null, theme: null },
    { cards: 25, sparks: 0, selector: null, title: 'Provisioner', theme: 'field' },
  ] as { cards: number; sparks: number; selector: 4 | 5 | null; title: string | null; theme: string | null }[],
  /** After the last milestone, a 5★ selector every this many cards (50th, 75th, 100th…). */
  repeatEvery: 25,
  repeatSelector: 5 as 4 | 5,
} as const;

export const MONUMENTAL = {
  /** Focus windows are capped at this length; a window left running longer asks when you stopped. */
  maxWindowMinutes: 180,
  /** Planned lengths offered when starting (optional). */
  plannedLengths: [25, 50, 90] as readonly number[],
  /** Windows shorter than this deal `shortMultiplier` damage. */
  shortMinutes: 15,
  shortMultiplier: 0.5,
  /** A window starting within this many minutes of the previous one's end continues the chain. */
  chainGapMinutes: 15,
  /** Damage multiplier for the 1st, 2nd and 3rd-onward window of a chain. */
  chainMultipliers: [1, 1.25, 1.5] as readonly number[],
  /** A single window this long is a deep-focus crit, dealing `critBonus` extra. */
  critMinutes: 90,
  critBonus: 0.25,
  /** A week with this many hibernated workdays (Mon–Fri) is skipped. */
  skipHibernatedWorkdays: 3,
  /** HP bar phases, as shares of max HP. */
  phases: [0.66, 0.33] as readonly number[],
  /** The ladder: boss HP is hours × 60. */
  tiers: [
    { hours: 5, name: 'Lethargos', flavor: 'A heavy-lidded titan that sleeps across the road ahead and asks you to lie down beside it.' },
    { hours: 7, name: 'Akedia Shard', flavor: 'A splinter of old apathy that whispers none of it matters, in your own voice.' },
    { hours: 9, name: 'Distraxis', flavor: 'A thousand-eyed swarm that turns every glance into a detour.' },
    { hours: 11, name: 'Marble Procrastes', flavor: 'A flawless statue of tomorrow, carved from every task you meant to start.' },
    { hours: 13, name: 'Torpor Colossus', flavor: 'It moves only to slow everything around it, and it is never in a hurry.' },
    { hours: 15, name: 'Oblivane', flavor: 'It drinks intentions the moment you set them down.' },
    { hours: 17, name: 'Entropos', flavor: 'Every plan it touches frays a little, then quietly comes apart.' },
    { hours: 19, name: 'Kronoklast, the Hour-Eater', flavor: 'It feeds on afternoons and leaves only the evening’s regret.' },
    { hours: 21, name: 'Dysergia', flavor: 'A knot of misfiring purpose: all motion, no progress.' },
    { hours: 23, name: 'Hydra of Tabs', flavor: 'Close one head and two more open, each insisting it matters most.' },
    { hours: 25, name: 'Akrasia the Unmoved', flavor: 'It knows exactly what you should do, and stands between you and doing it.' },
  ],
  /** Weekly rewards (scaled by EVENTS.rewardMultiplier when paid). Defeating Tier t: base + perTier × (t − 1). */
  defeat: { sparks: 1_000, sparksPerTier: 200, shards: 3, shardsEveryTiers: 2 },
  /** Dealing at least this share of HP adds the overkill bonus. */
  overkill: { share: 1.2, sparks: 500, shards: 2 },
  /** Escaping after dealing at least `share` of HP pays `fraction` of the defeat reward (highest match). */
  partial: [
    { share: 0.75, fraction: 0.5 },
    { share: 0.5, fraction: 0.25 },
  ] as readonly { share: number; fraction: number }[],
} as const;

export const SCHEMA_VERSION = 7;
