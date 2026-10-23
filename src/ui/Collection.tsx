import { activeAffirmations, affirmationCounts } from '../logic/actions';
import { useStore } from '../store';
import { Empty, PageTitle } from './common';

export function Collection() {
  const state = useStore();
  const list = activeAffirmations(state);
  const counts = affirmationCounts(state);
  const collected = list.filter((a) => counts.has(a.id)).length;
  const pct = list.length ? Math.round((collected / list.length) * 100) : 0;

  return (
    <div class="page">
      <PageTitle eyebrow="// archive · 3★ affirmations" title="Collection">
        <div class="collected mono">
          <b>{collected}</b>/{list.length}
        </div>
      </PageTitle>
      <div class="meter" aria-label={`Collected ${collected} of ${list.length}`}>
        <i style={{ width: `${pct}%` }} />
      </div>
      <p class="hint">
        Collected {collected} of {list.length}
      </p>
      {list.length === 0 ? (
        <Empty>No affirmations yet. Add some in More → Affirmations.</Empty>
      ) : (
        <ul class="collection">
          {list.map((a, i) => {
            const n = counts.get(a.id) ?? 0;
            const no = String(i + 1).padStart(2, '0');
            return n > 0 ? (
              <li key={a.id} class="aff panel">
                <span class="aff-no mono">#{no}</span>
                <p>“{a.text}”</p>
                <span class="aff-count mono">×{n}</span>
              </li>
            ) : (
              <li key={a.id} class="aff locked" aria-label={`Affirmation ${no}, locked`}>
                <span class="aff-no mono">#{no}</span>
                <p aria-hidden="true">
                  <i />
                  <i />
                </p>
                <span class="aff-count mono">LOCKED</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
