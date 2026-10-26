import { useState } from 'preact/hooks';
import {
  cancelHibernation,
  currentHibernation,
  isHibernating,
  periodDays,
  periodLength,
  periods,
  scheduleHibernation,
  startHibernation,
  wakeUp,
} from '../logic/hibernation';
import { addDays, dayKeyOf, formatDayKey } from '../logic/time';
import { run, useStore } from '../store';
import type { Hibernation } from '../types';
import { BackLink, confirmDialog, Empty, PageTitle, succeeded, toast, useNow, useSaving } from './common';

/** Wakes up from hibernation (the banner's one-tap button and the page's). */
export async function wake(): Promise<void> {
  if (succeeded(await run((s, now) => wakeUp(s, now)))) toast('Welcome back. Everything is running again.', 'good');
}

function range(h: Hibernation, now: Date): string {
  const { first, last } = periodDays(h, now);
  const open = h.endAt === null;
  return first === last && !open ? formatDayKey(first) : `${formatDayKey(first)} – ${open ? 'open-ended' : formatDayKey(last)}`;
}

function status(h: Hibernation, now: Date): 'scheduled' | 'active' | 'ended' {
  const t = now.toISOString();
  if (t < h.startAt) return 'scheduled';
  return h.endAt === null || t < h.endAt ? 'active' : 'ended';
}

export function HibernationPage() {
  const state = useStore();
  const now = useNow();
  const current = currentHibernation(state, now);
  const log = periods(state).reverse();
  return (
    <div class="page">
      <BackLink />
      <PageTitle eyebrow="// app-wide pause" title="Hibernation" />
      <p class="hint">
        For travel, illness, anything that takes you out of your routine. While hibernating nothing decays, expires or ages, and nothing
        is earned: no tasks are due, fitness logging and Salvage Exchange stage changes wait, and weeks that are mostly hibernated are
        skipped. Spending still works.
      </p>
      {current ? <Current h={current} now={now} /> : <StartForms now={now} />}
      <section class="panel">
        <h3 class="section-label">Log</h3>
        {log.length === 0 ? (
          <Empty>No hibernation yet.</Empty>
        ) : (
          <ul class="hibernation-log mono">
            {log.map((h) => (
              <li key={h.id}>
                <span>{range(h, now)}</span>
                <span class="muted">
                  {status(h, now) === 'scheduled' ? 'scheduled' : `${periodLength(h, now)} ${periodLength(h, now) === 1 ? 'day' : 'days'}`}
                  {status(h, now) === 'active' ? ' · now' : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p class="hint small">Each period counts whole days (4 AM to 4 AM). Periods can’t be edited once they’ve ended.</p>
      </section>
    </div>
  );
}

function Current({ h, now }: { h: Hibernation; now: Date }) {
  const state = useStore();
  const active = isHibernating(state, now);
  const cancel = async () => {
    const ok = await confirmDialog({ title: 'Cancel the scheduled hibernation?', confirmLabel: 'Cancel it' });
    if (ok && succeeded(await run((s, at) => cancelHibernation(s, h.id, at)))) toast('Scheduled hibernation cancelled');
  };
  return (
    <section class={`panel hibernation-now ${active ? 'on' : ''}`}>
      <span class="label">{active ? 'Hibernating' : 'Scheduled'}</span>
      <b>{range(h, now)}</b>
      <small class="mono muted">
        {active
          ? h.endDay
            ? `Ends at 4 AM after ${formatDayKey(h.endDay)}, or whenever you wake up.`
            : 'Until you wake up.'
          : `Starts at 4 AM on ${formatDayKey(dayKeyOf(new Date(h.startAt)))}.`}
      </small>
      {active ? (
        <button class="btn primary wide" onClick={wake}>
          Wake up
        </button>
      ) : (
        <button class="btn ghost wide" onClick={cancel}>
          Cancel scheduled hibernation
        </button>
      )}
    </section>
  );
}

function StartForms({ now }: { now: Date }) {
  const today = dayKeyOf(now);
  const [endNow, setEndNow] = useState('');
  const [start, setStart] = useState(addDays(today, 1));
  const [end, setEnd] = useState('');
  const [startingNow, startNow] = useSaving(async (e: Event) => {
    e.preventDefault();
    const ok = await confirmDialog({
      title: 'Start hibernating now?',
      body: 'Today counts as a hibernated day. Anything you’ve already earned today is kept. You can wake up any time.',
      confirmLabel: 'Hibernate',
    });
    if (ok && succeeded(await run((s, at) => startHibernation(s, endNow || null, at)))) toast('Hibernating. Your progress is safe.', 'good');
  });
  const [scheduling, schedule] = useSaving(async (e: Event) => {
    e.preventDefault();
    if (succeeded(await run((s, at) => scheduleHibernation(s, start, end || null, at)))) toast('Hibernation scheduled', 'good');
  });
  return (
    <>
      <section class="panel">
        <h3 class="section-label">Start now</h3>
        <form class="form" onSubmit={startNow}>
          <label>
            <span>Last day away (optional)</span>
            <input type="date" min={today} value={endNow} onInput={(e) => setEndNow(e.currentTarget.value)} />
          </label>
          <p class="hint small">Without one, it lasts until you wake up. With one, it ends at 4 AM the morning after.</p>
          <button class="btn primary wide" type="submit" disabled={startingNow}>
            Hibernate now
          </button>
        </form>
      </section>
      <section class="panel">
        <h3 class="section-label">Schedule</h3>
        <form class="form" onSubmit={schedule}>
          <div class="row gap">
            <label class="grow">
              <span>First day away</span>
              <input type="date" min={addDays(today, 1)} value={start} required onInput={(e) => setStart(e.currentTarget.value)} />
            </label>
            <label class="grow">
              <span>Last day (optional)</span>
              <input type="date" min={start} value={end} onInput={(e) => setEnd(e.currentTarget.value)} />
            </label>
          </div>
          <p class="hint small">It starts at 4 AM on the first day. There’s no backdating, so set it up before you leave.</p>
          <button class="btn wide" type="submit" disabled={scheduling}>
            Schedule
          </button>
        </form>
      </section>
    </>
  );
}
