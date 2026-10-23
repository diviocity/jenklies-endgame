import { useState } from 'preact/hooks';
import { GACHA, PULLS, SHARDS } from '../config';
import { pull, pullBlockReason } from '../logic/actions';
import { cryptoRng } from '../logic/gacha';
import { getMeta } from '../logic/state';
import { play } from '../sound';
import { run, useStore } from '../store';
import type { PullRecord } from '../types';
import { Amount, fmt, names, PageTitle, report, Stars } from './common';

export function Pull() {
  const state = useStore();
  const meta = getMeta(state);
  const [results, setResults] = useState<PullRecord[] | null>(null);
  const [busy, setBusy] = useState(false);
  const blocked1 = pullBlockReason(state, 1);
  const blocked10 = pullBlockReason(state, 10);
  const { sparksName, shardsName } = names();

  const doPull = async (count: 1 | 10) => {
    play('tap');
    setBusy(true);
    const result = report(await run((s, now) => pull(s, count, now, cryptoRng)));
    setBusy(false);
    if (result) {
      const best = Math.max(...result.map((r) => r.rarity)) as 3 | 4 | 5;
      play(`reveal${best}`);
      setResults(result);
    }
  };

  const soft = GACHA.softPityStart;
  const hard = GACHA.hardPity;
  const pct5 = Math.min(100, (meta.pity5 / hard) * 100);
  const until4 = Math.max(1, GACHA.guarantee4 - meta.pity4);

  return (
    <div class="page">
      <PageTitle eyebrow="// requisition terminal" title="Supply Drop" />

      <section class="banner panel">
        <div class="banner-art" aria-hidden="true">
          <i class="ring r1" />
          <i class="ring r2" />
          <i class="ring r3" />
          <i class="core" />
          <i class="scan" />
        </div>
        <div class="banner-copy">
          <div class="eyebrow">standard channel · always open</div>
          <h2>
            Indulgences <span class="r5">5★</span> / <span class="r4">4★</span>
          </h2>
          <p>Affirmations at 3★. Every drop also yields {shardsName}.</p>
        </div>
      </section>

      <section class="panel pity">
        <div class="row between">
          <span class="label">Pulls since last 5★</span>
          <b class="mono big">
            {meta.pity5}
            <small>/{hard}</small>
          </b>
        </div>
        <div class="pity-meter" aria-hidden="true">
          <i style={{ width: `${pct5}%` }} />
          <span class="mark" style={{ left: `${((soft - 1) / hard) * 100}%` }} title="Odds start rising" />
        </div>
        <div class="row between small muted">
          <span>Odds rise from pull {soft}</span>
          <span>
            4★+ guaranteed within <b>{until4}</b>
          </span>
        </div>
      </section>

      <div class="pull-buttons">
        <button class="btn pull-btn" disabled={busy || !!blocked1} onClick={() => doPull(1)}>
          <span>PULL ×1</span>
          <Amount value={PULLS.singleCost} currency="sparks" />
        </button>
        <button class="btn primary pull-btn" disabled={busy || !!blocked10} onClick={() => doPull(10)}>
          <span>PULL ×10</span>
          <Amount value={PULLS.tenCost} currency="sparks" />
        </button>
      </div>
      {blocked1 ? <p class="blocked">{blocked1}</p> : blocked10 && <p class="hint center">×10: {blocked10}</p>}

      <details class="panel rates">
        <summary>Rates &amp; rules</summary>
        <ul>
          <li>
            <span class="r5">5★</span> {(GACHA.rate5 * 100).toFixed(1)}% · from pull {soft} the chance rises{' '}
            {GACHA.softPityStep * 100} points per pull · guaranteed by pull {hard}
          </li>
          <li>
            <span class="r4">4★</span> {(GACHA.rate4 * 100).toFixed(1)}% · at least one 4★ or higher every{' '}
            {GACHA.guarantee4} pulls
          </li>
          <li>
            <span class="r3">3★</span> an affirmation
          </li>
          <li>
            {shardsName} per pull: 3★ {SHARDS.perPull[3]} · 4★ {SHARDS.perPull[4]} · 5★ {SHARDS.perPull[5]}
          </li>
          <li>
            One pull costs {fmt(PULLS.singleCost)} {sparksName}. Counters carry over between sessions and between ×1 and
            ×10.
          </li>
        </ul>
      </details>

      {results && <Reveal results={results} onClose={() => setResults(null)} />}
    </div>
  );
}

/** Phase 1 placeholder reveal: a quick fade-in of the result cards. */
function Reveal({ results, onClose }: { results: PullRecord[]; onClose: () => void }) {
  const state = useStore();
  const single = results.length === 1;
  const shards = results.reduce((s, r) => s + r.shards, 0);
  const best = Math.max(...results.map((r) => r.rarity));
  return (
    <div class={`overlay reveal best-${best}`} onClick={onClose}>
      <div class="reveal-inner" onClick={(e) => e.stopPropagation()}>
        <div class="eyebrow center">// drop received</div>
        <div class={single ? 'reveal-single' : 'reveal-grid'}>
          {results.map((r, i) => {
            const item = r.kind === 'indulgence' ? state.indulgences.get(r.itemId) : undefined;
            return (
              <div key={r.id} class={`card r${r.rarity} ${r.kind}`} style={{ animationDelay: `${i * 60}ms` }}>
                {r.isNew && <em class="new">NEW</em>}
                <Stars rarity={r.rarity} />
                {r.kind === 'indulgence' ? (
                  <>
                    <div class="card-emoji">{item?.emoji || '◆'}</div>
                    <div class="card-name">{r.itemName}</div>
                  </>
                ) : (
                  <div class={`card-quote ${!r.isNew && !single ? 'repeat' : ''}`}>“{r.itemName}”</div>
                )}
                <div class="card-foot">
                  <Amount value={r.shards} currency="shards" signed />
                </div>
              </div>
            );
          })}
        </div>
        <div class="row between reveal-foot">
          <span class="muted">
            Total <Amount value={shards} currency="shards" signed />
          </span>
          <button class="btn primary" onClick={onClose}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
