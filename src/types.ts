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

export interface Settings {
  deadlines: Record<BucketId, Minutes>;
  soundOn: boolean;
  /** Play sounds even when the iPhone is on silent (missing in data from before this setting existed). */
  soundIgnoresSilent?: boolean;
  sparksName: string;
  shardsName: string;
  /** The Frontier Expedition's target week (missing in data from before the event). */
  fitnessTarget?: FitnessTarget;
  /** UI theme; 'endgame' is unlocked by finishing the expedition. */
  theme?: 'default' | 'endgame';
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
  | 'depot_mission';

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
];

/** All app data, held in memory as id → record maps. */
export type AppState = { [K in StoreName]: Map<string, StoreRecords[K]> };

export type Change = {
  [K in StoreName]:
    | { store: K; op: 'put'; value: StoreRecords[K] }
    | { store: K; op: 'delete'; id: string };
}[StoreName];
