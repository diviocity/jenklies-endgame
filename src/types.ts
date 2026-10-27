export type BucketId = 'morning' | 'afternoon' | 'evening' | 'half1' | 'half2';
export type DayType = 'weekday' | 'weekend';
export type Rarity = 3 | 4 | 5;
export type Currency = 'sparks' | 'shards';

/** Minutes after midnight of the day's date. Values past 1440 mean after midnight (up to 4 AM). */
export type Minutes = number;

/**
 * Fitness activity types, stored by code. Shown as Major activity (crossfit), Other workout
 * (workout), Moderate activity (pt) and Minor activity (activity); see FITNESS_LABELS.
 */
export type FitnessType = 'crossfit' | 'pt' | 'workout' | 'activity';

/** How many of each fitness activity make up a full target week. */
export type FitnessTarget = Record<FitnessType, number>;

export type ThemeId = 'default' | 'endgame' | 'market' | 'field';

export interface Settings {
  deadlines: Record<BucketId, Minutes>;
  soundOn: boolean;
  /** Play sounds even when the iPhone is on silent (missing in data from before this setting existed). */
  soundIgnoresSilent?: boolean;
  sparksName: string;
  shardsName: string;
  /** The Frontier Expedition's target week (missing in data from before the event). */
  fitnessTarget?: FitnessTarget;
  /** UI theme: 'endgame' (finishing the expedition), 'market' (20th Salvage Exchange sale), 'field' (25th Provisions card). */
  theme?: ThemeId;
}

export interface Meta {
  id: 'meta';
  schemaVersion: number;
  createdAt: string;
  settings: Settings;
  /** Pulls since the last 5★. */
  pity5: number;
  /** Pulls since the last 4★ (a 5★ does not reset this; see GACHA.fiveResetsFourPity). */
  pity4: number;
  lastBackupAt: string | null;
}

/** Contingency Provisions prep steps: both are needed to put a week's supply line up. */
export type PrepKind = 'shopping' | 'cooking';
export type MealRating = 'on' | 'off';

export interface TemplateTask {
  id: string;
  name: string;
  /** 0 = Sunday … 6 = Saturday. Must all match the bucket's day type. */
  days: number[];
  bucket: BucketId;
  deadlineOverride: Minutes | null;
  weight: number;
  order: number;
  /** Checking this task off also logs this fitness activity. */
  fitness?: FitnessType | null;
  /** A meal (Contingency Provisions): rated on or off plan when checked off. */
  meal?: boolean;
  /** Checking this task off logs this prep step. */
  prep?: PrepKind | null;
}

export interface DayTask {
  id: string;
  templateTaskId: string | null;
  name: string;
  bucket: BucketId;
  deadline: Minutes;
  weight: number;
  base: number;
  bonus: number;
  oneOff: boolean;
  order: number;
  completedAt: string | null;
  onTime: boolean | null;
  /** Copied from the template when the day starts. */
  fitness?: FitnessType | null;
  meal?: boolean;
  prep?: PrepKind | null;
  /** A meal's rating once checked off (a normal tick is on plan). */
  mealRating?: MealRating | null;
}

export interface DayBucket {
  id: BucketId;
  deadline: Minutes;
  /** Paid when every (non-one-off) task in the bucket is done. Missing on days from before bucket bonuses. */
  bonus?: number;
  /** Paid on top of `bonus` if every one of those tasks was on time. */
  perfectBonus?: number;
  /** The perfect bonus only needs every task done that day, not on time (set when the day starts). */
  perfectAnyTime?: boolean;
}

/** A snapshot of one day's tasks and values, taken the first time the app sees that day. */
export interface DayRecord {
  /** Day key, YYYY-MM-DD. */
  id: string;
  dayType: DayType;
  /** Base Sparks per unit of weight on this day (used to value one-off tasks). */
  baseRate: number;
  /** A task's on-time bonus as a fraction of its base on this day. Missing on older days, which used 0.5. */
  onTimeRatio?: number;
  buckets: DayBucket[];
  tasks: DayTask[];
  createdAt: string;
}

export type LedgerReason =
  | 'task'
  | 'bonus'
  | 'bucket'
  | 'bucket_perfect'
  | 'undo'
  | 'pull'
  | 'pull_shards'
  | 'shop'
  | 'event_node'
  | 'event_weekly'
  | 'depot_item'
  | 'depot_mission'
  | 'depot_milestone'
  | 'provisions_card'
  | 'provisions_ration'
  | 'provisions_milestone'
  | 'monumental_weekly';

export interface LedgerEntry {
  id: string;
  at: string;
  currency: Currency;
  amount: number;
  reason: LedgerReason;
  /** Human-readable description of what it was for. */
  note: string;
  dayKey?: string;
  taskId?: string;
  bucketId?: BucketId;
  pullId?: string;
  purchaseId?: string;
  /** The Salvage Exchange item it was for. */
  itemId?: string;
}

export interface PullRecord {
  id: string;
  at: string;
  batchId: string;
  batchSize: 1 | 10;
  index: number;
  rarity: Rarity;
  kind: 'affirmation' | 'indulgence';
  itemId: string;
  /** Snapshot of the item's name or text at pull time. */
  itemName: string;
  /** Which pull this was since the previous 5★ (1 = first pull after one). */
  pity5: number;
  /** Which pull this was since the previous 4★. */
  pity4: number;
  isNew: boolean;
  shards: number;
}

export interface Indulgence {
  id: string;
  name: string;
  rarity: 4 | 5;
  emoji: string;
  note: string;
  active: boolean;
  order: number;
  createdAt: string;
}

export interface Purchase {
  id: string;
  at: string;
  indulgenceId: string;
  name: string;
  cost: number;
}

export interface Redemption {
  id: string;
  at: string;
  indulgenceId: string;
  name: string;
}

export interface Affirmation {
  id: string;
  text: string;
  removed: boolean;
  order: number;
  createdAt: string;
}

/** One fitness activity, from a tagged task or logged by hand. */
export interface FitnessEntry {
  id: string;
  at: string;
  dayKey: string;
  /** Day key of the Monday that starts this entry's week. */
  weekKey: string;
  type: FitnessType;
  /** Points before the weekly activity cap is applied. */
  points: number;
  source: 'task' | 'manual';
  /** The day task that logged it (source 'task'). */
  taskId?: string;
  note: string;
}

/** The Frontier Expedition's running state. */
export interface FrontierState {
  id: 'frontier';
  /** The first week the event tracked. */
  startedWeek: string;
  /** The week in progress; every earlier week has been closed. */
  currentWeek: string;
  /** Rank points as of the last weekly reset. */
  rp: number;
  rank: number;
  /** Consecutive weak weeks so far (drives the decay rate). */
  weakStreak: number;
  peakRank: number;
  /** How far along the map you are, in points. It only ever moves forward; nodes up to here are claimed. */
  mapProgress?: number;
  /** Titles earned by clearing regions. */
  titles?: string[];
  /** The title shown under the brand (null for none). */
  activeTitle?: string | null;
  /** UI themes unlocked. */
  themes?: string[];
  /** Set when the Endgame is finished. */
  completion?: ExpeditionRecord | null;
}

export interface ExpeditionRecord {
  at: string;
  peakRank: number;
  /** Fitness sessions that counted, from the start to the finish. */
  sessions: number;
  /** Weeks from the event's first week to the finish (inclusive). */
  weeks: number;
}

/** A closed week of the Frontier Expedition: its points and what the reset did. */
export interface EventWeek {
  /** The week's Monday day key. */
  id: string;
  points: number;
  targetPoints: number;
  rpMax: number;
  rpBefore: number;
  rpAfter: number;
  decay: number;
  weak: boolean;
  weakStreak: number;
  rankBefore: number;
  rankAfter: number;
  closedAt: string;
  /** Whether the weekly report for this week has been shown. */
  seen: boolean;
  /** Days of the week spent hibernating (missing on weeks closed before hibernation existed). */
  hibernatedDays?: number;
  /** Skipped for hibernation: RP, rank and the weak-week streak were left as they were. */
  skipped?: boolean;
  /** Weekly rewards paid at the reset (missing on weeks closed before weekly rewards existed). */
  rewardSparks?: number;
  rewardShards?: number;
  /** Map position when the week closed. */
  mapAtClose?: number;
}

/** An unopened (or used) indulgence selector from the expedition map. */
export interface Selector {
  id: string;
  rarity: 4 | 5;
  source: string;
  createdAt: string;
  usedAt: string | null;
  indulgenceId: string | null;
  name: string | null;
}

// ---------------------------------------------------------------- Salvage Exchange

/** What happened to an item, in the order it can happen. */
export type SaleStage = 'cataloged' | 'photographed' | 'listed' | 'sold' | 'handedOff';

/** Money in whole cents (US dollars). Information only; never used in reward math. */
export interface SaleRecord {
  price: number;
  platform: string;
  fees: number;
}

/** The rewards an item has paid. Each is paid once per item, ever. */
export interface SaleRewardsPaid {
  photographed?: boolean;
  listed?: boolean;
  featured?: boolean;
  fresh?: boolean;
  handedOff?: boolean;
}

export type SaleStepKind = 'photographed' | 'listed' | 'platforms' | 'takenDown' | 'sold' | 'fellThrough' | 'handedOff';

/** One stage change, kept so it can be undone the same day. */
export interface SaleStep {
  kind: SaleStepKind;
  at: string;
  dayKey: string;
  /** The item as it was before this step. */
  before: Omit<SaleItem, 'log'>;
  /** Ledger entries this step paid (reversed by undo). */
  ledgerIds: string[];
  /** The featured slot stint this step ended (reopened by undo). */
  endedSlotId?: string;
  /** Milestones this step reached, the selectors they gave, and the title shown before (all undone with it). */
  milestones?: string[];
  selectorIds?: string[];
  prevTitle?: string | null;
}

/** Something to sell. */
export interface SaleItem {
  id: string;
  name: string;
  notes: string;
  category: string;
  createdAt: string;
  photographedAt: string | null;
  /** Day key of the photo (the fresh-listing window counts from here). */
  photographedDay: string | null;
  /** When it first went on the market; never cleared, so relisting pays nothing. */
  firstListedAt: string | null;
  /** When the current listing went up (null when it's not on the market). */
  listedAt: string | null;
  /** Platforms it's listed on now. */
  platforms: string[];
  /** When it was last taken down without selling. */
  takenDownAt: string | null;
  soldAt: string | null;
  sale: SaleRecord | null;
  handedOffAt: string | null;
  paid: SaleRewardsPaid;
  /** Recent stage changes, newest last. */
  log: SaleStep[];
}

/** One stint of an item in a featured slot. */
export interface FeaturedSlot {
  id: string;
  /** 0-based slot. */
  slot: number;
  itemId: string;
  /** The item's name when it was featured (kept if the item is deleted). */
  name: string;
  startedAt: string;
  startedDay: string;
  endedAt: string | null;
  endReason: 'listed' | 'deleted' | null;
}

/** A closed week of the Salvage Exchange: its weekly mission. */
export interface DepotWeek {
  /** The week's Monday day key. */
  id: string;
  /** Featured lots that counted for the mission. */
  lots: string[];
  listed: number;
  total: number;
  completed: boolean;
  rewardSparks: number;
  rewardShards: number;
  closedAt: string;
  seen: boolean;
  /** No mission: the week had too many hibernated days. */
  skipped?: boolean;
}

/** The Salvage Exchange's running state. */
export interface DepotState {
  id: 'depot';
  startedWeek: string;
  /** The week in progress; every earlier week has been closed. */
  currentWeek: string;
  /** Platforms you've added on top of the defaults. */
  customPlatforms: string[];
  /** Lifetime counts (deleting an item never lowers them). */
  listedCount: number;
  handedOffCount: number;
  /** Milestones claimed, by id (e.g. "listed-1", "sold-20"). Missing before milestones existed. */
  milestones?: string[];
  /** Titles and themes earned here. The title shown is kept on the Frontier Expedition's state. */
  titles?: string[];
  themes?: string[];
  /** A reset passed while hibernating, so open slots fill when you wake up. */
  refillOnWake?: boolean;
}

// ---------------------------------------------------------------- Contingency Provisions

/** A shopping or cooking step, logged by a tagged task or by hand. */
export interface PrepLog {
  id: string;
  at: string;
  dayKey: string;
  kind: PrepKind;
  /** The week it supplies: logs made Friday–Sunday supply the next week. */
  weekKey: string;
  source: 'task' | 'manual';
  taskId?: string;
}

/** One on-plan meal. While its week is open, whether it counts or is held follows the supply line. */
export interface Stamp {
  id: string;
  /** The day task (meal) that earned it. */
  taskId: string;
  dayKey: string;
  weekKey: string;
  at: string;
  /** Set when the week closes: counted (with its value) or expired. */
  status?: 'counted' | 'expired';
  value?: number;
}

export type SupplyStatus = 'onTime' | 'late' | 'down';

/** A closed week of Contingency Provisions. */
export interface ProvisionsWeek {
  /** The week's Monday day key. */
  id: string;
  /** 'skipped' when the week was mostly hibernated. */
  supply: SupplyStatus | 'skipped';
  /** When both prep steps were in. */
  upAt: string | null;
  hibernatedDays: number;
  /** Meals scheduled and on plan, on active days only. */
  scheduled: number;
  onPlan: number;
  /** Stamp value counted, and stamps that expired. */
  stamps: number;
  expired: number;
  rationSparks: number;
  rationShards: number;
  closedAt: string;
  seen: boolean;
}

/** Contingency Provisions' running state. */
export interface ProvisionsState {
  id: 'provisions';
  /** The first day tracked (earlier days in the first week aren't counted). */
  startedDay: string;
  /** The week in progress; every earlier week has been closed. */
  currentWeek: string;
  /** Cards filled and paid so far. */
  cardsFilled: number;
  /** Milestones claimed (missing before milestones existed). */
  milestones?: ProvisionsClaim[];
  /** Titles and themes earned here. The title shown is kept on the Frontier Expedition's state. */
  titles?: string[];
  themes?: string[];
}

/** A claimed milestone and what it gave, so a same-day undo that unfills its card can take it back. */
export interface ProvisionsClaim {
  /** e.g. "cards-1", "cards-50". */
  id: string;
  cards: number;
  ledgerIds: string[];
  selectorId?: string;
  /** The title shown before this milestone's title replaced it. */
  prevTitle?: string | null;
}

// ---------------------------------------------------------------- Monumental Works

/** A stretch of focused work. Only timestamps are stored; the length is worked out from them. */
export interface FocusWindow {
  id: string;
  startAt: string;
  /** Null while running. */
  endAt: string | null;
  /** The day and week it started in (it belongs to them). */
  dayKey: string;
  weekKey: string;
  /** Planned length in minutes, if one was picked. */
  planned: number | null;
  /** Started and ended with the buttons, or added by hand. */
  source: 'live' | 'manual';
}

/** A workday marked off (holidays, PTO); keyed by its day key. Only this event uses it. */
export interface DayOff {
  id: string;
  createdAt: string;
}

/** A week's boss: chosen at the reset that starts the week, settled at the next. */
export interface BossFight {
  weekKey: string;
  /** 1–11 (12 is Agony Mode). */
  tier: number;
  /** Index into MONUMENTAL.tiers of the boss fought. */
  boss: number;
}

/** A closed week of Monumental Works. */
export interface BossWeek {
  /** The week's Monday day key. */
  id: string;
  tier: number;
  boss: number;
  /** HP after prorating for days off and hibernation (0 when skipped). */
  hp: number;
  damage: number;
  result: 'defeated' | 'escaped' | 'skipped';
  /** When HP first reached 0. */
  defeatedAt: string | null;
  /** Tier for the next week, after the ladder moved. */
  nextTier: number;
  rewardSparks: number;
  rewardShards: number;
  closedAt: string;
  seen: boolean;
}

/** Monumental Works' running state: the ladder and this week's boss. */
export interface MonumentalState {
  id: 'monumental';
  startedWeek: string;
  /** The week in progress; every earlier week has been closed. */
  currentWeek: string;
  /** The tier the next boss is drawn from. */
  tier: number;
  /** Escapes in a row (two drop a tier). Skipped weeks don't count either way. */
  escapes: number;
  /** This week's boss (null in the first, partial week). */
  fight: BossFight | null;
}

/** A hibernation period: an app-wide pause. Ended periods are read-only. */
export interface Hibernation {
  id: string;
  /** When it starts: the moment it was switched on, or 4 AM on the scheduled start day. */
  startAt: string;
  /** When it ends: when woken up, or 4 AM after the last scheduled day. Null while open-ended. */
  endAt: string | null;
  /** The scheduled last day away, if one was set. */
  endDay: string | null;
  createdAt: string;
}

export interface StoreRecords {
  meta: Meta;
  templateTasks: TemplateTask;
  days: DayRecord;
  ledger: LedgerEntry;
  pulls: PullRecord;
  indulgences: Indulgence;
  purchases: Purchase;
  redemptions: Redemption;
  affirmations: Affirmation;
  fitness: FitnessEntry;
  events: FrontierState;
  eventWeeks: EventWeek;
  selectors: Selector;
  saleItems: SaleItem;
  featuredSlots: FeaturedSlot;
  depotWeeks: DepotWeek;
  depot: DepotState;
  hibernations: Hibernation;
  prepLogs: PrepLog;
  stamps: Stamp;
  provisionWeeks: ProvisionsWeek;
  provisions: ProvisionsState;
  focusWindows: FocusWindow;
  daysOff: DayOff;
  bossWeeks: BossWeek;
  monumental: MonumentalState;
}

export type StoreName = keyof StoreRecords;

export const STORE_NAMES: StoreName[] = [
  'meta',
  'templateTasks',
  'days',
  'ledger',
  'pulls',
  'indulgences',
  'purchases',
  'redemptions',
  'affirmations',
  'fitness',
  'events',
  'eventWeeks',
  'selectors',
  'saleItems',
  'featuredSlots',
  'depotWeeks',
  'depot',
  'hibernations',
  'prepLogs',
  'stamps',
  'provisionWeeks',
  'provisions',
  'focusWindows',
  'daysOff',
  'bossWeeks',
  'monumental',
];

/** All app data, held in memory as id → record maps. */
export type AppState = { [K in StoreName]: Map<string, StoreRecords[K]> };

export type Change = {
  [K in StoreName]:
    | { store: K; op: 'put'; value: StoreRecords[K] }
    | { store: K; op: 'delete'; id: string };
}[StoreName];
