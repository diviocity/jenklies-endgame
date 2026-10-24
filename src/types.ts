export type BucketId = 'morning' | 'afternoon' | 'evening' | 'half1' | 'half2';
export type DayType = 'weekday' | 'weekend';
export type Rarity = 3 | 4 | 5;
export type Currency = 'sparks' | 'shards';

/** Minutes after midnight of the day's date. Values past 1440 mean after midnight (up to 4 AM). */
export type Minutes = number;

export interface Settings {
  deadlines: Record<BucketId, Minutes>;
  soundOn: boolean;
  /** Play sounds even when the iPhone is on silent (missing in data from before this setting existed). */
  soundIgnoresSilent?: boolean;
  sparksName: string;
  shardsName: string;
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
}

export interface DayBucket {
  id: BucketId;
  deadline: Minutes;
  /** Paid when every (non-one-off) task in the bucket is done. Missing on days from before bucket bonuses. */
  bonus?: number;
  /** Paid on top of `bonus` if every one of those tasks was on time. */
  perfectBonus?: number;
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
  | 'shop';

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
];

/** All app data, held in memory as id → record maps. */
export type AppState = { [K in StoreName]: Map<string, StoreRecords[K]> };

export type Change = {
  [K in StoreName]:
    | { store: K; op: 'put'; value: StoreRecords[K] }
    | { store: K; op: 'delete'; id: string };
}[StoreName];
