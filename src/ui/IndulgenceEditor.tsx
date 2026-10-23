import { useState } from 'preact/hooks';
import { SHARDS } from '../config';
import { deleteIndulgence, indulgenceUsed, saveIndulgence, type IndulgenceInput } from '../logic/actions';
import { sortByOrder } from '../logic/state';
import { run, useStore } from '../store';
import type { Indulgence } from '../types';
import { BackLink, confirmDialog, Empty, names, PageTitle, report, Segmented, Sheet, Stars } from './common';

export function IndulgenceEditor() {
  const state = useStore();
  const [draft, setDraft] = useState<IndulgenceInput | null>(null);
  const all = sortByOrder(state.indulgences.values()).sort((a, b) => b.rarity - a.rarity);
  const active = all.filter((i) => i.active);
  const retired = all.filter((i) => !i.active);

  const row = (i: Indulgence) => (
    <li key={i.id}>
      <button class={`panel item-row r${i.rarity} ${i.active ? '' : 'retired'}`} onClick={() => setDraft({ ...i })}>
        <span class={`item-emoji r${i.rarity}`}>{i.emoji || '◆'}</span>
        <span class="grow">
          <span class="item-name">{i.name}</span>
          {i.note && <small class="muted">{i.note}</small>}
        </span>
        <Stars rarity={i.rarity} />
      </button>
    </li>
  );

  return (
    <div class="page">
      <BackLink />
      <PageTitle eyebrow="// rewards registry" title="Indulgences" />
      <p class="hint">
        Treats you've defined for yourself. Active ones can be pulled (4★ / 5★) and bought in the shop for{' '}
        {SHARDS.shopPrice[4]} / {SHARDS.shopPrice[5]} {names().shardsName}. Retiring keeps history intact.
      </p>
      <button
        class="btn primary wide"
        onClick={() => setDraft({ name: '', rarity: 4, emoji: '', note: '', active: true })}
      >
        + New indulgence
      </button>
      {active.length === 0 ? <Empty>No active indulgences — pulling is blocked until you add some.</Empty> : <ul class="items">{active.map(row)}</ul>}
      {retired.length > 0 && (
        <>
          <h3 class="section-label">Retired</h3>
          <ul class="items">{retired.map(row)}</ul>
        </>
      )}
      {draft && <IndulgenceSheet draft={draft} onClose={() => setDraft(null)} />}
    </div>
  );
}

function IndulgenceSheet(props: { draft: IndulgenceInput; onClose: () => void }) {
  const state = useStore();
  const [d, setD] = useState(props.draft);
  const set = (patch: Partial<IndulgenceInput>) => setD((prev) => ({ ...prev, ...patch }));
  const used = d.id ? indulgenceUsed(state, d.id) : false;

  const save = async (e: Event) => {
    e.preventDefault();
    if (report(await run((s, now) => saveIndulgence(s, d, now))) !== undefined) props.onClose();
  };
  const remove = async () => {
    const ok = await confirmDialog({ title: `Delete "${d.name}"?`, confirmLabel: 'Delete', danger: true });
    if (ok && report(await run((s) => deleteIndulgence(s, d.id!))) !== undefined) props.onClose();
  };

  return (
    <Sheet title={d.id ? 'Edit indulgence' : 'New indulgence'} onClose={props.onClose}>
      <form class="form" onSubmit={save}>
        <div class="row gap">
          <label class="narrow">
            <span>Icon</span>
            <input
              class="emoji-input"
              value={d.emoji}
              maxLength={8}
              placeholder="◆"
              onInput={(e) => set({ emoji: e.currentTarget.value })}
            />
          </label>
          <label class="grow">
            <span>Name</span>
            <input value={d.name} maxLength={80} required onInput={(e) => set({ name: e.currentTarget.value })} />
          </label>
        </div>
        <fieldset>
          <legend>Rarity</legend>
          <Segmented
            value={String(d.rarity) as '4' | '5'}
            onChange={(v) => set({ rarity: Number(v) as 4 | 5 })}
            options={[
              { value: '4', label: '4★' },
              { value: '5', label: '5★' },
            ]}
          />
        </fieldset>
        <label>
          <span>Note (optional)</span>
          <textarea rows={2} maxLength={200} value={d.note} onInput={(e) => set({ note: e.currentTarget.value })} />
        </label>
        <label class="switch">
          <input type="checkbox" checked={d.active} onChange={(e) => set({ active: e.currentTarget.checked })} />
          <span>Active (in pulls and the shop)</span>
        </label>
        <button class="btn primary wide" type="submit">
          Save
        </button>
        {d.id && !used && (
          <button type="button" class="btn danger-ghost wide" onClick={remove}>
            Delete
          </button>
        )}
        {d.id && used && <p class="hint">This one appears in your history, so it can be retired but not deleted.</p>}
      </form>
    </Sheet>
  );
}
