import { activeAffirmations, affirmationCounts } from '../logic/actions';
import { useStore } from '../store';
import { Empty } from './common';

/** The 3★ affirmation collection, shown in the Bag. */
export function AffirmationCollection() {
  const state = useStore();
  const list = activeAffirmations(state);
  const counts = affirmationCounts(state);
  const collected = list.filter((a) => counts.has(a.id)).length;
  const pct = list.length ? Math.round((collected / list.length) * 100) : 0;

  return (
    <>
      <div class="row between">
        <span class="hint">3★ affirmations · collected {collected} of {list.length}</span>
        <span class="collected mono">
          <b>{collected}</b>/{list.length}
        </span>
      </div>
      <div class="meter" aria-label={`Collected ${collected} of ${list.length}`}>
        <i style={{ width: `${pct}%` }} />
      </div>
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
    </>
  );
}
