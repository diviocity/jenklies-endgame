import { useEffect, useRef, useState } from 'preact/hooks';
import { bestRarity, nextStage, rarityCounts, SEQUENCE, timeline, type Stage } from '../logic/sequence';
import { play } from '../sound';
import { useStore } from '../store';
import type { PullRecord } from '../types';
import { Amount, Stars } from './common';
import './pull-sequence.css';

const STATUS: Record<Exclude<Stage, 'reveal'>, string> = {
  uplink: 'ESTABLISHING UPLINK',
  drop: 'SUPPLY POD INBOUND',
  flash: 'SIGNAL RESOLVED',
};

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The full pull sequence: uplink → pod drop → rarity flash → reveal. The pulls are already saved. */
export function PullSequence({ results, onClose }: { results: PullRecord[]; onClose: () => void }) {
  const [reduced] = useState(prefersReducedMotion);
  const best = bestRarity(results);
  const [steps] = useState(() => timeline(best));
  const [stage, setStage] = useState<Stage>(reduced ? 'reveal' : 'uplink');
  const [shown, setShown] = useState(reduced ? results.length : 0);
  const [focus, setFocus] = useState<PullRecord | null>(null);
  const chimed = useRef(false);

  const chime = () => {
    if (chimed.current) return;
    chimed.current = true;
    play(`reveal${best}`);
  };

  // Step through the cinematic.
  useEffect(() => {
    if (stage === 'reveal') {
      chime();
      return;
    }
    if (stage === 'drop') play('drop');
    if (stage === 'flash') chime();
    const step = steps.find((s) => s.stage === stage)!;
    const t = setTimeout(() => setStage(nextStage(steps, stage)), step.ms);
    return () => clearTimeout(t);
  }, [stage]);

  // Turn the cards over one at a time.
  useEffect(() => {
    if (stage !== 'reveal' || shown >= results.length) return;
    const t = setTimeout(() => setShown((n) => n + 1), shown === 0 ? SEQUENCE.firstFlipMs : SEQUENCE.flipGapMs);
    return () => clearTimeout(t);
  }, [stage, shown]);

  const allShown = stage === 'reveal' && shown >= results.length;
  const skip = () => {
    setStage('reveal');
    setShown(results.length);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Enter') return;
      if (focus) setFocus(null);
      else if (!allShown) skip();
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div
      class={`seq stage-${stage} best-${best} ${reduced ? 'reduced' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Pull results"
    >
      {stage !== 'reveal' && <Cinematic stage={stage} count={results.length} />}
      {!allShown && (
        <button class="seq-skip" onClick={skip}>
          SKIP <span aria-hidden="true">»</span>
        </button>
      )}
      {stage === 'reveal' && (
        <Results results={results} shown={shown} done={allShown} onFocus={setFocus} onClose={onClose} />
      )}
      {focus && <Focus pull={focus} onClose={() => setFocus(null)} />}
    </div>
  );
}

function Cinematic({ stage, count }: { stage: Exclude<Stage, 'reveal'>; count: number }) {
  return (
    <div class="cine" aria-live="polite">
      <i class="cine-grid" />
      <i class="corner tl" />
      <i class="corner tr" />
      <i class="corner bl" />
      <i class="corner br" />
      <div class="hud hud-top">
        <span>REQUISITION // ×{count}</span>
        <span class="blink">● LIVE</span>
      </div>
      <i class="beam" />
      <div class="rings">
        <i />
        <i />
        <i />
      </div>
      <div class="streaks">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <i key={i} style={{ '--i': i }} />
        ))}
      </div>
      <div class="pod">
        <i class="pod-core" />
        <i class="pod-crack" />
      </div>
      <i class="shock" />
      <i class="rays" />
      <i class="flash" />
      <div class="hud hud-bottom">
        <span>{STATUS[stage]}</span>
        <span class="bar">
          <i />
        </span>
      </div>
    </div>
  );
}

function CardFace({ pull, large = false }: { pull: PullRecord; large?: boolean }) {
  const state = useStore();
  const item = pull.kind === 'indulgence' ? state.indulgences.get(pull.itemId) : undefined;
  return (
    <div class={`rcard r${pull.rarity} ${pull.kind} ${large ? 'large' : ''}`}>
      <i class="rcard-band" />
      {pull.isNew && <em class="new">NEW</em>}
      <Stars rarity={pull.rarity} />
      {pull.kind === 'indulgence' ? (
        <>
          <div class="rcard-emoji">{item?.emoji || '◆'}</div>
          <div class="rcard-name">{pull.itemName}</div>
          {large && item?.note && <p class="rcard-note">{item.note}</p>}
        </>
      ) : (
        <div class={`rcard-quote ${pull.isNew || large ? '' : 'repeat'}`}>“{pull.itemName}”</div>
      )}
      <div class="rcard-foot">
        <Amount value={pull.shards} currency="shards" signed />
      </div>
    </div>
  );
}

function Results(props: {
  results: PullRecord[];
  shown: number;
  done: boolean;
  onFocus: (p: PullRecord) => void;
  onClose: () => void;
}) {
  const { results, shown, done } = props;
  const single = results.length === 1;
  const counts = rarityCounts(results);
  const shards = results.reduce((s, r) => s + r.shards, 0);
  const fresh = results.filter((r) => r.isNew).length;

  return (
    <div class="results">
      <div class="eyebrow center">// drop received{single ? '' : ' · ×10'}</div>
      {single ? (
        <div class="single-slot">{shown > 0 && <CardFace pull={results[0]} large />}</div>
      ) : (
        <ul class="ten-grid">
          {results.map((r, i) => (
            <li key={r.id} class={`flip ${i < shown ? 'on' : ''} r${r.rarity}`}>
              <button
                class="flip-inner"
                disabled={i >= shown}
                aria-label={i < shown ? `${r.rarity} star: ${r.itemName}` : 'Not revealed yet'}
                onClick={() => props.onFocus(r)}
              >
                <span class="flip-back" aria-hidden="true">
                  <i />
                </span>
                <span class="flip-front">
                  <CardFace pull={r} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div class={`results-foot ${done ? 'on' : ''}`}>
        <div class="tally">
          {!single && (
            <span class="mono">
              {counts[5] > 0 && <span class="r5">5★×{counts[5]} </span>}
              {counts[4] > 0 && <span class="r4">4★×{counts[4]} </span>}
              <span class="r3">3★×{counts[3]}</span>
            </span>
          )}
          <span class="muted small">
            <Amount value={shards} currency="shards" signed />
            {fresh > 0 && ` · ${fresh} new`}
          </span>
        </div>
        <button class="btn primary" disabled={!done} onClick={props.onClose}>
          Continue
        </button>
      </div>
      {!single && done && <p class="hint center">Tap a card to read it in full.</p>}
    </div>
  );
}

function Focus({ pull, onClose }: { pull: PullRecord; onClose: () => void }) {
  return (
    <div class="focus" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        <CardFace pull={pull} large />
        <button class="btn ghost wide" onClick={onClose}>
          Back to results
        </button>
      </div>
    </div>
  );
}
