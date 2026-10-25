import { useState } from 'preact/hooks';
import { countedEntryIds, FITNESS_LABELS } from '../logic/rank';
import { sortByTime } from '../logic/state';
import { formatDateTime } from '../logic/time';
import { useStore } from '../store';
import type { LedgerEntry, PullRecord } from '../types';
import { Amount, BackLink, Empty, names, PageTitle, Segmented, Stars } from './common';

type View = 'pulls' | 'ledger' | 'fitness' | 'redemptions';
const PAGE = 100;

export function History() {
  const [view, setView] = useState<View>('pulls');
  return (
    <div class="page">
      <BackLink />
      <PageTitle eyebrow="// records" title="History" />
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: 'pulls', label: 'Pulls' },
          { value: 'ledger', label: 'Ledger' },
          { value: 'fitness', label: 'Fitness' },
          { value: 'redemptions', label: 'Redeemed' },
        ]}
      />
      {view === 'pulls' && <Pulls />}
      {view === 'ledger' && <Ledger />}
      {view === 'fitness' && <FitnessLog />}
      {view === 'redemptions' && <Redemptions />}
    </div>
  );
}

function useLimit() {
  const [limit, setLimit] = useState(PAGE);
  return [limit, () => setLimit((l) => l + PAGE)] as const;
}

function sortPulls(pulls: Iterable<PullRecord>): PullRecord[] {
  return [...pulls].sort((a, b) => (a.at === b.at ? b.index - a.index : a.at < b.at ? 1 : -1));
}

function Pulls() {
  const state = useStore();
  const [limit, more] = useLimit();
  const pulls = sortPulls(state.pulls.values());
  if (pulls.length === 0) return <Empty>No pulls yet.</Empty>;
  return (
    <>
      <ul class="log">
        {pulls.slice(0, limit).map((p) => (
          <li key={p.id} class={`pull-row r${p.rarity}`}>
            <span class="mono muted">
              {formatDateTime(p.at)} · {p.batchSize === 10 ? `×10 #${p.index + 1}` : '×1'}
            </span>
            <span class="pull-main">
              <Stars rarity={p.rarity} /> <span class="clip">{p.itemName}</span>
              {p.isNew && <em class="tag new-tag">NEW</em>}
            </span>
            <span class="mono muted small">
              5★ pity {p.pity5} · 4★ pity {p.pity4} · +{p.shards} {names().shardsName}
            </span>
          </li>
        ))}
      </ul>
      {pulls.length > limit && (
        <button class="btn ghost wide" onClick={more}>
          Show more
        </button>
      )}
    </>
  );
}

function Ledger() {
  const state = useStore();
  const [limit, more] = useLimit();
  const entries: LedgerEntry[] = sortByTime(state.ledger.values());
  if (entries.length === 0) return <Empty>No currency movements yet.</Empty>;
  return (
    <>
      <ul class="log">
        {entries.slice(0, limit).map((e) => (
          <li key={e.id} class="ledger-row">
            <span class="mono muted">{formatDateTime(e.at)}</span>
            <span class="row between">
              <span class="clip">{e.note}</span>
              <span class={e.amount < 0 ? 'neg' : 'pos'}>
                <Amount value={e.amount} currency={e.currency} signed />
              </span>
            </span>
          </li>
        ))}
      </ul>
      {entries.length > limit && (
        <button class="btn ghost wide" onClick={more}>
          Show more
        </button>
      )}
    </>
  );
}

function FitnessLog() {
  const state = useStore();
  const [limit, more] = useLimit();
  const entries = sortByTime(state.fitness.values());
  if (entries.length === 0) return <Empty>No fitness logged yet.</Empty>;
  // Which entries counted is decided per week (only the first few activities do).
  const counted = new Set<string>();
  for (const week of new Set(entries.map((e) => e.weekKey))) {
    for (const id of countedEntryIds(entries.filter((e) => e.weekKey === week))) counted.add(id);
  }
  return (
    <>
      <ul class="log">
        {entries.slice(0, limit).map((e) => (
          <li key={e.id} class="ledger-row">
            <span class="mono muted">
              {formatDateTime(e.at)} · {FITNESS_LABELS[e.type]}
              {e.source === 'task' ? ' · task' : ''}
            </span>
            <span class="row between">
              <span class="clip">{e.note}</span>
              <span class={counted.has(e.id) ? 'pos mono' : 'muted mono'}>
                {counted.has(e.id) ? `+${e.points} FP` : 'over cap'}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {entries.length > limit && (
        <button class="btn ghost wide" onClick={more}>
          Show more
        </button>
      )}
    </>
  );
}

export function Redemptions() {
  const state = useStore();
  const log = sortByTime(state.redemptions.values());
  if (log.length === 0) return <Empty>Nothing redeemed yet.</Empty>;
  return (
    <ul class="log">
      {log.map((r) => (
        <li key={r.id}>
          <span class="mono muted">{formatDateTime(r.at)}</span>
          <span>{r.name}</span>
        </li>
      ))}
    </ul>
  );
}
