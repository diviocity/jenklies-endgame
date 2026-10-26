import { describe, expect, it } from 'vitest';
import { buildBackup, parseBackup, restoredData } from '../src/logic/backup';
import { ensureDepot, listItem, saveSaleItem } from '../src/logic/depot';
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

  it('keeps Salvage Exchange items, slots and platforms through a round trip', () => {
    const copy = emptyState();
    applyChanges(copy, seedChanges(now.toISOString()));
    applyChanges(copy, ensureDepot(copy, now));
    const { changes, result } = saveSaleItem(copy, { name: 'Lamp', notes: 'brass', category: 'Home' }, now);
    applyChanges(copy, changes);
    applyChanges(copy, listItem(copy, result.id, ['eBay', 'OfferUp'], now).changes);
    const restored = restoredData(parseBackup(JSON.stringify(buildBackup(copy, now))), now);
    expect(restored.saleItems[0]).toMatchObject({ name: 'Lamp', platforms: ['eBay', 'OfferUp'], paid: { listed: true } });
    expect(restored.featuredSlots[0]).toMatchObject({ endReason: 'listed' });
    expect(restored.depot[0]).toMatchObject({ listedCount: 1 });
  });

  it('imports a version 3 backup, which has no Salvage Exchange data', () => {
    const file = buildBackup(state, now) as unknown as { schemaVersion: number; data: Record<string, unknown> };
    file.schemaVersion = 3;
    for (const name of ['saleItems', 'featuredSlots', 'depotWeeks', 'depot']) delete file.data[name];
    const restored = restoredData(parseBackup(JSON.stringify(file)), now);
    expect(restored.saleItems).toEqual([]);
    expect(restored.meta[0].schemaVersion).toBe(4);
  });

  it('rejects backups from a newer version', () => {
    const file = { ...buildBackup(state, now), schemaVersion: 999 };
    expect(() => parseBackup(JSON.stringify(file))).toThrow(/newer version/);
  });
});
