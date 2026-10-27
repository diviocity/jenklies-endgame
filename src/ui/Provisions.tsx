import { PROVISIONS } from '../config';
import { isHibernating, isSkippedWeek } from '../logic/hibernation';
import {
  cardProgress,
  logPrep,
  provisionsAlert,
  supplyFor,
  undoPrep,
  weekMeals,
  type Supply,
} from '../logic/provisions';
import { addDays, dayKeyOf, deadlineAt, formatTime, keyToDate, weekKeyOf } from '../logic/time';
import { play } from '../sound';
import { run, useStore } from '../store';
import type { PrepKind } from '../types';
import { Amount, fmt, names, PageTitle, report, succeeded, toast, useNow, useSaving } from './common';

const SUPPLY_LABEL = { onTime: 'Up on time', late: 'Up late', down: 'Down' } as const;
const weekday = (dayKey: string) => keyToDate(dayKey).toLocaleDateString(undefined, { weekday: 'long' });

/** The Events tab card. */
export function ProvisionsCard() {
  const state = useStore();
  const now = useNow();
  const alert = provisionsAlert(state, now);
  const card = cardProgress(state);
  return (
    <a class={`event-card panel provisions-card ${alert.down ? 'alert' : ''}`} href="#/events/provisions">
      <span class="event-art ration-art" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span class="event-copy">
        <span class="eyebrow">permanent · diet</span>
        <b>Contingency Provisions</b>
        <small class="mono">
          Supply {alert.down ? 'down' : SUPPLY_LABEL[alert.supply.status].toLowerCase()} · card {card.onCard}/{PROVISIONS.stampsPerCard}
          {card.held > 0 && ` · ${card.held} held`}
        </small>
      </span>
      <span aria-hidden="true">›</span>
    </a>
  );
}

export function Provisions() {
  const state = useStore();
  const now = useNow();
  const today = dayKeyOf(now);
  const thisWeek = weekKeyOf(today);
  const alert = provisionsAlert(state, now);
  const skipped = isSkippedWeek(state, thisWeek, now);
  return (
    <div class="page provisions">
      <a class="back" href="#/events">
        ‹ Events
      </a>
      <PageTitle eyebrow="// permanent event" title="Contingency Provisions" />
      {alert.down && <DownBanner supply={alert.supply} />}
      {alert.spoiling && (
        <p class="spoilage mono">
          You shopped {weekday(alert.spoiling.dayKey)} and haven’t cooked yet.
        </p>
      )}
      <StampCard />
      <SupplyPanel now={now} skipped={skipped} />
      <ThisWeek now={now} skipped={skipped} />
    </div>
  );
}

function Mark({ ok }: { ok: boolean }) {
  return <b class={ok ? 'ok' : 'missing'}>{ok ? '✓' : '✗'}</b>;
}

function DownBanner({ supply }: { supply: Supply }) {
  return (
    <section class="supply-down" role="status">
      <b>
        Supply line down: Shopping <Mark ok={!!supply.shopping} /> · Cooking <Mark ok={!!supply.cooking} />
      </b>
      <small>Meals still earn stamps, but they’re held until both are logged, and expire at the reset.</small>
    </section>
  );
}

function StampCard() {
  const state = useStore();
  const card = cardProgress(state);
  const per = PROVISIONS.stampsPerCard;
  const held = Math.min(card.held, per - card.onCard);
  return (
    <section class="panel stamp-card">
      <div class="row between">
        <span class="label">Card {card.cards + 1}</span>
        <b class="mono">
          {card.onCard}/{per}
          {card.held > 0 && <small class="muted"> · {card.held} held</small>}
        </b>
      </div>
      <div class="stamps" role="img" aria-label={`${card.onCard} of ${per} stamps, ${card.held} held`}>
        {Array.from({ length: per }, (_, i) => (
          <i key={i} class={i < card.onCard ? 'on' : i < card.onCard + held ? 'held' : ''} />
        ))}
      </div>
      <small class="mono muted">
        Each card: <Amount value={PROVISIONS.card.sparks} currency="sparks" signed /> <Amount value={PROVISIONS.card.shards} currency="shards" signed /> ·{' '}
        {card.cards} filled · {fmt(card.counted)} stamps lifetime
      </small>
    </section>
  );
}

function PrepState({ supply }: { supply: Supply }) {
  const when = (at: string | undefined) => (at ? ` ${keyToDate(dayKeyOf(new Date(at))).toLocaleDateString(undefined, { weekday: 'short' })}` : '');
  return (
    <span class="mono prep-state">
      Shopping <Mark ok={!!supply.shopping} />
      {when(supply.shopping?.at)} · Cooking <Mark ok={!!supply.cooking} />
      {when(supply.cooking?.at)}
    </span>
  );
}

function SupplyPanel({ now, skipped }: { now: Date; skipped: boolean }) {
  const state = useStore();
  const today = dayKeyOf(now);
  const thisWeek = weekKeyOf(today);
  const nextWeek = addDays(thisWeek, 7);
  const current = supplyFor(state, thisWeek);
  const next = supplyFor(state, nextWeek);
  const hibernating = isHibernating(state, now);
  const todaysLogs = [...state.prepLogs.values()].filter((l) => l.dayKey === today).sort((a, b) => (a.at < b.at ? -1 : 1));
  const [busy, log] = useSaving(async (kind: PrepKind) => {
    const result = report(await run((s, at) => logPrep(s, kind, at)));
    if (!result) return;
    play('complete');
    toast(`${kind === 'shopping' ? 'Shopping' : 'Cooking'} logged for the week of ${keyToDate(result.weekKey).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`, 'good');
    if (result.cards > 0) toast(`Provisions card filled! +${fmt(PROVISIONS.card.sparks * result.cards)} ${names().sparksName}`, 'good');
  });
  const undo = async (id: string) => {
    if (succeeded(await run((s, at) => undoPrep(s, id, at)))) toast('Prep log undone');
  };
  return (
    <section class="panel supply">
      <h3 class="section-label">Supply line</h3>
      <div class="supply-row">
        <div>
          <span class="label">This week</span>
          <b class={`supply-status ${skipped ? 'skipped' : current.status}`}>
            {skipped ? 'Skipped (hibernation)' : SUPPLY_LABEL[current.status]}
            {!skipped && current.status === 'onTime' && ' · stamps ×2'}
          </b>
          <PrepState supply={current} />
        </div>
        <div>
          <span class="label">Next week</span>
          <b class={`supply-status ${next.status === 'down' ? 'pending' : 'onTime'}`}>
            {next.status === 'down' ? 'Not ready yet' : 'Ready · stamps ×2'}
          </b>
          <PrepState supply={next} />
        </div>
      </div>
      <p class="hint small">
        Shopping and cooking from Friday to Sunday supply the next week; Monday to Thursday, this one. Both before Monday 4 AM doubles
        that week’s stamps.
      </p>
      {hibernating ? (
        <p class="paused-note">Hibernating: prep logging is paused until you wake up.</p>
      ) : (
        <div class="row gap">
          <button class="btn" disabled={busy} onClick={() => log('shopping')}>
            I shopped
          </button>
          <button class="btn" disabled={busy} onClick={() => log('cooking')}>
            I cooked
          </button>
        </div>
      )}
      {todaysLogs.length > 0 && (
        <ul class="prep-log mono">
          {todaysLogs.map((l) => (
            <li key={l.id}>
              <span>
                {l.kind === 'shopping' ? 'Shopping' : 'Cooking'} · {formatTime(l.at)} · {l.source === 'task' ? 'from Today' : 'logged here'}
              </span>
              {l.source === 'manual' && (
                <button class="mini" onClick={() => undo(l.id)}>
                  Undo
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ThisWeek({ now, skipped }: { now: Date; skipped: boolean }) {
  const state = useStore();
  const today = dayKeyOf(now);
  const thisWeek = weekKeyOf(today);
  const meals = weekMeals(state, thisWeek, now, today);
  const pct = meals.scheduled ? Math.round((meals.onPlan / meals.scheduled) * 100) : 0;
  const target = Math.round(PROVISIONS.ration.share * 100);
  const reset = deadlineAt(addDays(thisWeek, 7), 4 * 60);
  const days = Math.max(0, Math.round((reset.getTime() - now.getTime()) / 86_400_000));
  return (
    <section class="panel ration">
      <h3 class="section-label">Ration report · this week</h3>
      {skipped ? (
        <p class="paused-note">Mostly hibernated, so this week has no supply check and no ration report.</p>
      ) : (
        <>
          <div class="row between">
            <span>
              On plan so far: <b class="mono">{meals.onPlan}</b>
              <span class="muted mono">/{meals.scheduled}</span>
            </span>
            <b class={`mono ${pct >= target ? 'ok' : ''}`}>{pct}%</b>
          </div>
          <div class="meter" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${pct}% of meals on plan`}>
            <i style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <small class="mono muted">
            {target}% of the week’s meals on plan with the supply line up pays <Amount value={PROVISIONS.ration.sparks} currency="sparks" signed />{' '}
            <Amount value={PROVISIONS.ration.shards} currency="shards" signed /> at the reset{days > 0 ? `, in ${days} ${days === 1 ? 'day' : 'days'}` : ''}. Skipped meals
            don’t count as on plan.
          </small>
        </>
      )}
    </section>
  );
}
