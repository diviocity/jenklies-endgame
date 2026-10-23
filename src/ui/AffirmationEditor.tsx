import { useState } from 'preact/hooks';
import { affirmationCounts, saveAffirmation, setAffirmationRemoved } from '../logic/actions';
import { sortByOrder } from '../logic/state';
import { run, useStore } from '../store';
import { BackLink, PageTitle, report, Sheet } from './common';

type Draft = { id?: string; text: string; removed: boolean };

export function AffirmationEditor() {
  const state = useStore();
  const [draft, setDraft] = useState<Draft | null>(null);
  const counts = affirmationCounts(state);
  const all = sortByOrder(state.affirmations.values());
  const active = all.filter((a) => !a.removed);
  const removed = all.filter((a) => a.removed);

  return (
    <div class="page">
      <BackLink />
      <PageTitle eyebrow="// 3★ pool" title="Affirmations" />
      <p class="hint">
        Every 3★ pull draws one of these. Removing one takes it out of the pool and the Collection, but pull history
        keeps it.
      </p>
      <button class="btn primary wide" onClick={() => setDraft({ text: '', removed: false })}>
        + New affirmation
      </button>
      <ol class="aff-list">
        {active.map((a) => (
          <li key={a.id}>
            <button class="panel" onClick={() => setDraft(a)}>
              <span>{a.text}</span>
              <small class="mono muted">{counts.get(a.id) ? `×${counts.get(a.id)}` : 'uncollected'}</small>
            </button>
          </li>
        ))}
      </ol>
      {removed.length > 0 && (
        <>
          <h3 class="section-label">Removed</h3>
          <ul class="aff-list removed">
            {removed.map((a) => (
              <li key={a.id}>
                <button class="panel" onClick={() => setDraft(a)}>
                  <span>{a.text}</span>
                  <small class="mono muted">tap to restore</small>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {draft && <AffirmationSheet draft={draft} onClose={() => setDraft(null)} />}
    </div>
  );
}

function AffirmationSheet(props: { draft: Draft; onClose: () => void }) {
  const [text, setText] = useState(props.draft.text);
  const { id, removed } = props.draft;

  const save = async (e: Event) => {
    e.preventDefault();
    if (report(await run((s, now) => saveAffirmation(s, { id, text }, now))) !== undefined) props.onClose();
  };
  const toggle = async () => {
    if (report(await run((s) => setAffirmationRemoved(s, id!, !removed))) !== undefined) props.onClose();
  };

  return (
    <Sheet title={id ? 'Edit affirmation' : 'New affirmation'} onClose={props.onClose}>
      <form class="form" onSubmit={save}>
        <label>
          <span>Text</span>
          <textarea rows={3} maxLength={240} value={text} required onInput={(e) => setText(e.currentTarget.value)} />
        </label>
        <button class="btn primary wide" type="submit">
          Save
        </button>
        {id && (
          <button type="button" class={`btn wide ${removed ? 'ghost' : 'danger-ghost'}`} onClick={toggle}>
            {removed ? 'Restore to the pool' : 'Remove from the pool'}
          </button>
        )}
      </form>
    </Sheet>
  );
}
