import { describe, expect, it } from 'vitest';
import { buildBackup, parseBackup } from '../src/logic/backup';
import { applyChanges, emptyState, seedChanges } from '../src/logic/state';
import { ensureDay } from '../src/logic/actions';
import { STORE_NAMES } from '../src/types';

describe('backup', () => {
  const now = new Date(2026, 9, 20, 9);
  const state = emptyState();
  applyChanges(state, seedChanges(now.toISOString()));
  applyChanges(state, ensureDay(state, now));

  it('round-trips every store', () => {
    const file = parseBackup(JSON.stringify(buildBackup(state, now)));
    for (const name of STORE_NAMES) expect(file.data[name]).toHaveLength(state[name].size);
    expect(file.data.meta[0].lastBackupAt).toBe(now.toISOString());
  });

  it('rejects files that are not backups', () => {
    expect(() => parseBackup('not json')).toThrow(/valid JSON/);
    expect(() => parseBackup('{"app":"other"}')).toThrow(/not a Jenklies/);
    const file = buildBackup(state, now) as unknown as { data: Record<string, unknown> };
    delete file.data.pulls;
    expect(() => parseBackup(JSON.stringify(file))).toThrow(/missing "pulls"/);
  });

  it('rejects backups from a newer version', () => {
    const file = { ...buildBackup(state, now), schemaVersion: 999 };
    expect(() => parseBackup(JSON.stringify(file))).toThrow(/newer version/);
  });
});
