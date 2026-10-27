import { PROVISIONS } from '../config';
import { isHibernating, isSkippedWeek } from '../logic/hibernation';
import {
  cardProgress,
  logPrep,
  milestoneName,
  prepLogged,
  milestoneReward,
  milestonesThrough,
  nextMilestone,
  provisions,
  provisionsAlert,
  supplyFor,
  supplyWeekOf,
  undoPrep,
  weekMeals,
  type Supply,
} from '../logic/provisions';
import { addDays, dayKeyOf, deadlineAt, formatTime, keyToDate, weekKeyOf } from '../logic/time';
import { play } from '../sound';
import { run, useStore } from '../store';
import type { PrepKind } from '../types';
import { Amount, fmt, names, PageTitle, report, succeeded, toast, useNow, useSaving } from './common';
import { cardToast } from './Today';

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
    <div class="page wide provisions">
      <a class="back" href="#/events">
        ‹ Events
      </a>
      <PageTitle eyebrow="// permanent event" title="Contingency Provisions" />
      <div class="cols">
        <div class="col">
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
        <div class="col side">
          <Milestones />
          <Stats now={now} />
        </div>
      </div>
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
  // One line per step, so a mark never wraps away from its word.
  return (
    <span class="mono prep-state">
      <span>
        Shopping <Mark ok={!!supply.shopping} />
        {when(supply.shopping?.at)}
      </span>
      <span>
        Cooking <Mark ok={!!supply.cooking} />
        {when(supply.cooking?.at)}
      </span>
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
  // The buttons log for the week today supplies (next week from Friday on); each step counts once per week.
  const supplying = supplyWeekOf(today);
  const shopped = !!prepLogged(state, supplying, 'shopping');
  const cooked = !!prepLogged(state, supplying, 'cooking');
  const todaysLogs = [...state.prepLogs.values()].filter((l) => l.dayKey === today).sort((a, b) => (a.at < b.at ? -1 : 1));
  const [busy, log] = useSaving(async (kind: PrepKind) => {
    const result = report(await run((s, at) => logPrep(s, kind, at)));
    if (!result) return;
    play('complete');
    toast(`${kind === 'shopping' ? 'Shopping' : 'Cooking'} logged for the week of ${keyToDate(result.weekKey).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`, 'good');
    cardToast(result.cards, result.milestones);
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
          <button class={`btn ${shopped ? 'logged' : ''}`} disabled={busy || shopped} onClick={() => log('shopping')}>
            {shopped ? '✓ Shopped' : 'I shopped'}
          </button>
          <button class={`btn ${cooked ? 'logged' : ''}`} disabled={busy || cooked} onClick={() => log('cooking')}>
            {cooked ? '✓ Cooked' : 'I cooked'}
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

function Milestones() {
  const state = useStore();
  const { sparksName } = names();
  const p = provisions(state);
  if (!p) return null;
  const filled = p.cardsFilled;
  const next = nextMilestone(filled);
  const reached = milestonesThrough(filled).filter((m) => (p.milestones ?? []).some((c) => c.id === m.id));
  const prev = reached[reached.length - 1]?.cards ?? 0;
  const pct = Math.round(((filled - prev) / (next.cards - prev)) * 100);
  return (
    <section class="panel milestones">
      <h3 class="section-label">Milestones</h3>
      <div class="milestone-track">
        <div class="row between">
          <span class="label">Cards filled</span>
          <b class="mono">{filled}</b>
        </div>
        <div class="meter" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Cards filled: ${filled}`}>
          <i style={{ width: `${pct}%` }} />
        </div>
        <small class="mono muted">
          Next: {milestoneName(next)} · {milestoneReward(next, sparksName)} · {next.cards - filled} to go
        </small>
      </div>
      {reached.length > 0 && (
        <ul class="milestone-list">
          {reached.map((m) => (
            <li key={m.id}>
              <span class="mono">✓ {milestoneName(m)}</span> <span class="muted">{milestoneReward(m, sparksName)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const SUPPLY_SHORT = { onTime: 'on time', late: 'late', down: 'down', skipped: 'hibernated' } as const;

/** Information only: the on-plan trend with each week's supply line, and lifetime totals. */
function Stats({ now }: { now: Date }) {
  const state = useStore();
  const today = dayKeyOf(now);
  const thisWeek = weekKeyOf(today);
  const closed = [...state.provisionWeeks.values()].sort((a, b) => (a.id < b.id ? -1 : 1)).slice(-11);
  const live = weekMeals(state, thisWeek, now, today);
  const liveSupply: keyof typeof SUPPLY_SHORT = isSkippedWeek(state, thisWeek, now) ? 'skipped' : supplyFor(state, thisWeek).status;
  const bars = [
    ...closed.map((w) => ({ id: w.id, pct: w.scheduled ? w.onPlan / w.scheduled : 0, supply: w.supply, now: false })),
    { id: thisWeek, pct: live.scheduled ? live.onPlan / live.scheduled : 0, supply: liveSupply, now: true },
  ];
  const card = cardProgress(state);
  const expired = [...state.stamps.values()].filter((s) => s.status === 'expired').length;
  const counts = { onTime: 0, late: 0, down: 0, skipped: 0 };
  for (const w of closed) counts[w.supply]++;
  const w = 100 / 12;
  const line = 32 - PROVISIONS.ration.share * 30;
  const label = (id: string) => keyToDate(id).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return (
    <section class="panel provisions-stats">
      <h3 class="section-label">Stats</h3>
      <span class="label">On plan by week</span>
      <svg
        class="trend"
        viewBox="0 0 100 32"
        preserveAspectRatio="none"
        role="img"
        aria-label={bars.map((b) => `${b.now ? 'this week' : label(b.id)}: ${Math.round(b.pct * 100)}% on plan, supply ${SUPPLY_SHORT[b.supply]}`).join('; ')}
      >
        <line x1="0" x2="100" y1={line} y2={line} class="target" />
        {bars.map((b, i) => {
          const h = Math.max(1.5, b.pct * 30);
          return <rect key={b.id} class={`${b.supply} ${b.now ? 'now' : ''}`} x={i * w + w * 0.15} y={32 - h} width={w * 0.7} height={h} />;
        })}
      </svg>
      <div class="legend mono">
        <span class="onTime">■ on time</span>
        <span class="late">■ late</span>
        <span class="down">■ down</span>
        <span class="skipped">■ hibernated</span>
        <span class="target-key">- - 85%</span>
      </div>
      {closed.length === 0 ? (
        <p class="hint small">Weekly history starts after the first reset (Mondays at 4 AM).</p>
      ) : (
        <p class="mono small muted">
          Supply line, last {closed.length} {closed.length === 1 ? 'week' : 'weeks'}: {counts.onTime} on time · {counts.late} late · {counts.down} down
          {counts.skipped ? ` · ${counts.skipped} hibernated` : ''}
        </p>
      )}
      <div class="rank-stats">
        <div>
          <span class="label">Stamps</span>
          <b class="mono">{fmt(card.counted)}</b>
        </div>
        <div>
          <span class="label">Cards</span>
          <b class="mono">{card.cards}</b>
        </div>
        <div>
          <span class="label">Expired</span>
          <b class="mono">{expired}</b>
        </div>
      </div>
    </section>
  );
}
