import { SCHEMA_VERSION } from '../config';
import type { AppState, StoreName, StoreRecords } from '../types';
import { STORE_NAMES } from '../types';

export const APP_ID = 'jenklies-endgame';

export type BackupData = { [K in StoreName]: StoreRecords[K][] };

export interface BackupFile {
  app: typeof APP_ID;
  schemaVersion: number;
  exportedAt: string;
  data: BackupData;
}

/** Builds the export file. Its meta already records this export as the last backup. */
export function buildBackup(state: AppState, now: Date): BackupFile {
  const exportedAt = now.toISOString();
  const data = {} as Record<StoreName, unknown[]>;
  for (const name of STORE_NAMES) data[name] = [...state[name].values()];
  data.meta = (data.meta as StoreRecords['meta'][]).map((m) => ({ ...m, lastBackupAt: exportedAt }));
  return { app: APP_ID, schemaVersion: SCHEMA_VERSION, exportedAt, data: data as BackupData };
}

export function backupFileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `endgame-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Parses and checks a backup file. Throws an Error with a readable message if it isn't usable. */
export function parseBackup(text: string): BackupFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (!isObject(raw) || raw.app !== APP_ID) throw new Error('That file is not a Jenklies: Endgame backup.');
  if (typeof raw.schemaVersion !== 'number' || raw.schemaVersion > SCHEMA_VERSION) {
    throw new Error('That backup comes from a newer version of the app. Update the app first.');
  }
  if (!isObject(raw.data)) throw new Error('The backup has no data.');
  for (const name of STORE_NAMES) {
    const records = raw.data[name];
    if (!Array.isArray(records)) throw new Error(`The backup is missing "${name}".`);
    for (const r of records) {
      if (!isObject(r) || typeof r.id !== 'string') throw new Error(`The backup has a broken record in "${name}".`);
    }
  }
  const meta = raw.data.meta as unknown[];
  if (meta.length !== 1 || !isObject(meta[0]) || meta[0].id !== 'meta' || !isObject(meta[0].settings)) {
    throw new Error('The backup has broken settings.');
  }
  return raw as unknown as BackupFile;
}

export function summarizeBackup(file: BackupFile): string {
  const d = file.data;
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return [
    count(d.templateTasks.length, 'template task'),
    count(d.days.length, 'day'),
    count(d.pulls.length, 'pull'),
    count(d.indulgences.length, 'indulgence'),
    count(d.affirmations.length, 'affirmation'),
  ].join(' · ');
}
