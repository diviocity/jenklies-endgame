import { useState } from 'preact/hooks';
import { FITNESS } from '../config';
import { entriesForWeek, frontier, logActivity, rankStatus, undoActivity, type RankStatus } from '../logic/event';
import { countedEntryIds, FITNESS_LABELS, FITNESS_TYPES } from '../logic/rank';
import { addDays, dayKeyOf, deadlineAt, formatTime, keyToDate } from '../logic/time';
import { play } from '../sound';
import { run, useStore } from '../store';
import type { FitnessType } from '../types';
import { isHibernating } from '../logic/hibernation';
import { ExpeditionMap } from './ExpeditionMap';
import { Monumental, MonumentalCard } from './Monumental';
import { Provisions, ProvisionsCard } from './Provisions';
import { Salvage, SalvageCard } from './Salvage';
import { Empty, fmt, PageTitle, report, Segmented, Sheet, toast, useNow } from './common';

export function Events({ sub }: { sub?: string }) {
  if (sub === 'frontier') return <Frontier />;
  if (sub === 'salvage') return <Salvage />;
  if (sub === 'provisions') return <Provisions />;
  if (sub === 'monumental') return <Monumental />;
  return <EventList />;
}

function EventList() {
  const state = useStore();
  const now = useNow();
  const status = rankStatus(state, now);
  return (
    <div class="page">
      <PageTitle eyebrow="// operations" title="Events" />
      <a class="event-card panel" href="#/events/frontier">
        <span class="event-art" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span class="event-copy">
          <span class="eyebrow">permanent · fitness</span>
          <b>Frontier Expedition</b>
          {status && (
            <small class="mono">
              Rank {status.rank} · {fmt(status.weekPoints)}/{fmt(status.target)} this week
            </small>
          )}
        </span>
        <span aria-hidden="true">›</span>
      </a>
      <SalvageCard />
      <ProvisionsCard />
      <MonumentalCard />
    </div>
  );
}

function timeUntil(target: Date, now: Date): string {
  const mins = Math.max(0, Math.round((target.getTime() - now.getTime()) / 60_000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

function Frontier() {
  const state = useStore();
  const now = useNow();
  const [logging, setLogging] = useState(false);
  const status = rankStatus(state, now);
  if (!status) return <div class="boot">Starting the expedition…</div>;

  return (
    <div class="page">
      <a class="back" href="#/events">
        ‹ Events
      </a>
      <PageTitle eyebrow="// permanent event" title="Frontier Expedition" />
      <Honors />
      <RankPanel status={status} now={now} />
      {isHibernating(state, now) ? (
        <p class="paused-note">Hibernating: logging is paused until you wake up.</p>
      ) : (
        <button class="btn primary wide" onClick={() => setLogging(true)}>
          + Log activity
        </button>
      )}
      <ExpeditionMap />
      <WeekLog weekKey={status.weekKey} now={now} />
      {logging && <LogSheet onClose={() => setLogging(false)} weekKey={status.weekKey} />}
    </div>
  );
}

/** Your title and, once finished, the expedition's completion record. */
function Honors() {
  const state = useStore();
  const event = frontier(state);
  if (!event) return null;
  const record = event.completion;
  return (
    <>
      {event.activeTitle && (
        <p class="title-line mono">
          <span class="muted">Title</span> {event.activeTitle}
        </p>
      )}
      {record && (
        <section class="panel record">
          <h3 class="section-label">Expedition complete</h3>
          <div class="rank-stats">
            <div>
              <span class="label">Finished</span>
              <b class="mono">{new Date(record.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</b>
            </div>
            <div>
              <span class="label">Peak rank</span>
              <b class="mono">{record.peakRank}</b>
            </div>
            <div>
              <span class="label">Sessions · weeks</span>
              <b class="mono">
                {record.sessions} · {record.weeks}
              </b>
            </div>
          </div>
        </section>
      )}
    </>
  );
}

function RankPanel({ status, now }: { status: RankStatus; now: Date }) {
  const reset = deadlineAt(addDays(status.weekKey, 7), 4 * 60);
  const pct = Math.round(status.progress * 100);
  const atMax = status.toNext === null && !status.skipped;
  const meterLabel = status.skipped
    ? 'Skipped this week (hibernation)'
    : !status.holding
    ? `${pct}% of the way to holding Rank ${status.rank}`
    : atMax
      ? 'Rank 20 held'
      : `${pct}% of the way to Rank ${status.rank + 1}`;
  return (
    <section class="panel rank-panel">
      <div class="rank-head">
        <div>
          <span class="label">Rank</span>
          <div class="rank-big mono">
            {String(status.rank).padStart(2, '0')}
            <small>/20</small>
          </div>
        </div>
        <div class="rank-side">
          <span class="label">At reset</span>
          <b class={`mono ${status.projectedRank > status.rank ? 'up' : status.projectedRank < status.rank ? 'down' : ''}`}>
            Rank {status.projectedRank}
          </b>
          <small class="mono muted">in {timeUntil(reset, now)}</small>
        </div>
      </div>
      <div
        class={`meter rank-meter ${status.holding ? '' : 'short'}`}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={meterLabel}
      >
        <i style={{ width: `${pct}%` }} />
      </div>
      <small class="mono muted rank-caption">{meterLabel}</small>
      {status.skipped ? (
        <p class="paused-note">
          {status.hibernatedDays} hibernated days this week, so it’s skipped at the reset: no decay, no weekly reward, rank held.
        </p>
      ) : (
        status.hibernatedDays > 0 && (
          <p class="hint small">
            {status.hibernatedDays} hibernated {status.hibernatedDays === 1 ? 'day' : 'days'} this week: the target, decay and thresholds
            are prorated to {7 - status.hibernatedDays}/7.
          </p>
        )
      )}
      <div class="rank-stats">
        <div>
          <span class="label">This week</span>
          <b class="mono">
            {fmt(status.weekPoints)}
            <small>/{fmt(status.target)}</small>
          </b>
        </div>
        <div>
          <span class="label">Hold rank</span>
          <b class={`mono ${status.toHold === 0 ? 'ok' : ''}`}>{status.toHold === 0 ? '✓ Held' : `+${fmt(status.toHold)}`}</b>
        </div>
        <div>
          <span class="label">Next rank</span>
          <b class={`mono ${status.toNext === 0 ? 'ok' : ''}`}>
            {status.skipped ? '—' : atMax ? 'MAX' : status.toNext === 0 ? '✓ Reached' : `+${fmt(status.toNext!)}`}
          </b>
        </div>
      </div>
      <RankHistory status={status} />
    </section>
  );
}

/** The last few weeks' ranks as bars, ending with where this week stands. */
function RankHistory({ status }: { status: RankStatus }) {
  const past = status.history.slice(-11).map((w) => ({ rank: w.rankAfter, label: w.id, now: false, skipped: !!w.skipped }));
  const bars = [...past, { rank: status.projectedRank, label: 'this week', now: true, skipped: status.skipped }];
  if (past.length === 0) {
    return <p class="hint small">Your rank history starts after the first weekly reset (Mondays at 4 AM).</p>;
  }
  const w = 100 / 12;
  return (
    <div class="rank-history">
      <span class="label">Last {past.length} {past.length === 1 ? 'week' : 'weeks'}</span>
      <svg viewBox="0 0 100 32" preserveAspectRatio="none" role="img" aria-label={bars.map((b) => `${b.label}: rank ${b.rank}`).join(', ')}>
        {bars.map((b, i) => {
          const h = Math.max(1.5, (b.rank / 20) * 30);
          return (
            <rect
              key={b.label}
              class={`${b.now ? 'now' : ''} ${b.skipped ? 'hib' : ''}`}
              x={i * w + w * 0.15}
              y={32 - h}
              width={w * 0.7}
              height={h}
            />
          );
        })}
      </svg>
    </div>
  );
}

function WeekLog({ weekKey, now }: { weekKey: string; now: Date }) {
  const state = useStore();
  const entries = entriesForWeek(state, weekKey).sort((a, b) => (a.at < b.at ? 1 : -1));
  const counted = countedEntryIds(entries);
  const todayKey = dayKeyOf(now);
  const undo = async (id: string) => {
    play('undo');
    report(await run((s, at) => undoActivity(s, id, at)));
  };
  return (
    <section class="panel">
      <h3 class="section-label">
        This week · since {keyToDate(weekKey).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
      </h3>
      {entries.length === 0 ? (
        <Empty>Nothing yet. Tagged tasks on Today count automatically.</Empty>
      ) : (
        <ul class="fitness-log">
          {entries.map((e) => (
            <li key={e.id}>
              <span class="grow">
                <b>{e.note}</b>
                <small class="mono muted">
                  {FITNESS_LABELS[e.type]} · {keyToDate(e.dayKey).toLocaleDateString(undefined, { weekday: 'short' })}{' '}
                  {formatTime(e.at)}
                  {e.source === 'task' && ' · from Today'}
                </small>
              </span>
              <span class={`mono ${counted.has(e.id) ? 'pos' : 'muted'}`}>
                {counted.has(e.id) ? `+${e.points}` : 'over cap'}
              </span>
              {e.source === 'manual' && e.dayKey === todayKey && (
                <button class="mini" onClick={() => undo(e.id)}>
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

const TYPE_SHORT: Record<FitnessType, string> = { crossfit: 'Major', workout: 'Workout', pt: 'Moderate', activity: 'Minor' };

function LogSheet({ onClose, weekKey }: { onClose: () => void; weekKey: string }) {
  const state = useStore();
  const [type, setType] = useState<FitnessType>('workout');
  const [note, setNote] = useState('');
  const activities = entriesForWeek(state, weekKey).filter((e) => e.type === 'activity').length;

  const save = async (e: Event) => {
    e.preventDefault();
    play('complete');
    const result = report(await run((s, now) => logActivity(s, { type, note }, now)));
    if (result === undefined) return;
    toast(result.points > 0 ? `+${result.points} fitness points` : 'Logged · over this week’s minor activity cap', 'good');
    onClose();
  };

  return (
    <Sheet title="Log activity" onClose={onClose}>
      <form class="form" onSubmit={save}>
        <fieldset>
          <legend>Type</legend>
          <Segmented
            value={type}
            onChange={setType}
            options={FITNESS_TYPES.map((t) => ({ value: t, label: TYPE_SHORT[t] }))}
          />
        </fieldset>
        <p class="hint">
          {FITNESS_LABELS[type]}: +{FITNESS.points[type]} points.
          {type === 'activity' &&
            ` Only the first ${FITNESS.activityWeeklyCap} minor activities a week count (${Math.min(activities, FITNESS.activityWeeklyCap)} so far).`}
        </p>
        <label>
          <span>Note (optional)</span>
          <input
            value={note}
            maxLength={80}
            placeholder={type === 'activity' ? 'e.g. Evening walk' : type === 'crossfit' ? 'e.g. CrossFit class' : type === 'pt' ? 'e.g. Shoulder PT' : 'e.g. Hike, swim, bike ride'}
            onInput={(e) => setNote(e.currentTarget.value)}
          />
        </label>
        <button class="btn primary wide" type="submit">
          Log it
        </button>
      </form>
    </Sheet>
  );
}
