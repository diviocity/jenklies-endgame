import { useState } from 'preact/hooks';
import { MONUMENTAL } from '../config';
import { isHibernating } from '../logic/hibernation';
import {
  addWindow,
  bossOf,
  cancelDayOff,
  currentFight,
  defeatReward,
  deleteWindow,
  editWindow,
  endFocus,
  monumental,
  needsStopTime,
  runningWindow,
  setDayOff,
  startFocus,
  windowDamage,
  weekWindows,
  type FightStatus,
  type WindowDamage,
} from '../logic/monumental';
import { dayKeyOf, deadlineAt, formatDayKey, formatTime, inputToMinutes, keyToDate, minutesToInput, weekKeyOf } from '../logic/time';
import { play } from '../sound';
import { run, useStore } from '../store';
import type { FocusWindow } from '../types';
import { Amount, confirmDialog, Empty, fmt, PageTitle, report, Sheet, succeeded, toast, useNow, useSaving } from './common';

const MIN = 60_000;

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

/** An original sigil for each boss, drawn from its name: a spiked ring around a core. */
export function Sigil({ name, size = 72, hidden = false }: { name: string; size?: number; hidden?: boolean }) {
  let h = 2166136261;
  for (const c of name) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const points = 5 + (h % 5);
  const inner = 0.42 + ((h >> 3) % 20) / 100;
  const twist = ((h >> 8) % 360) * (Math.PI / 180);
  const rings = 1 + ((h >> 12) % 3);
  const star = Array.from({ length: points * 2 }, (_, i) => {
    const r = i % 2 ? 46 * inner : 46;
    const a = twist + (i * Math.PI) / points;
    return `${50 + r * Math.cos(a)},${50 + r * Math.sin(a)}`;
  }).join(' ');
  const core = Array.from({ length: points }, (_, i) => {
    const a = -twist + (i * 2 * Math.PI) / points;
    return `${50 + 14 * Math.cos(a)},${50 + 14 * Math.sin(a)}`;
  }).join(' ');
  return (
    <svg class={`sigil ${hidden ? 'hidden' : ''}`} viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <polygon points={star} class="spikes" />
      {Array.from({ length: rings }, (_, i) => (
        <circle key={i} cx="50" cy="50" r={30 - i * 6} class="ring" />
      ))}
      <polygon points={core} class="core" />
      <circle cx="50" cy="50" r="4" class="eye" />
    </svg>
  );
}

/** The Events tab card. */
export function MonumentalCard() {
  const state = useStore();
  const now = useNow();
  const fight = currentFight(state, now);
  const m = monumental(state);
  const summary = fight
    ? fight.hp.skipped
      ? `${fight.name} · skipped this week`
      : `Tier ${fight.fight.tier} · ${fight.name} · ${fight.defeatedAt ? 'defeated' : `${fmt(Math.max(0, fight.hp.hp - fight.damage))} HP left`}`
    : `First boss arrives Monday · Tier ${m?.tier ?? 1}`;
  return (
    <a class="event-card panel monumental-card" href="#/events/monumental">
      <span class="event-art boss-art" aria-hidden="true">
        <Sigil name={fight?.name ?? bossOf((m?.tier ?? 1) - 1).name} size={48} />
      </span>
      <span class="event-copy">
        <span class="eyebrow">permanent · work focus</span>
        <b>Monumental Works</b>
        <small class="mono">{summary}</small>
      </span>
      <span aria-hidden="true">›</span>
    </a>
  );
}

/** The slim bar under the top bar while a focus window runs. */
export function FocusPill() {
  const state = useStore();
  const now = useNow(1000);
  const w = runningWindow(state);
  if (!w) return null;
  const elapsed = now.getTime() - Date.parse(w.startAt);
  const left = w.planned ? w.planned * MIN - elapsed : null;
  const [d] = windowDamage([w], now);
  return (
    <a class="focus-pill mono" href="#/events/monumental">
      <i aria-hidden="true" />
      FOCUS {clock(elapsed)}
      {left !== null && <span>{left > 0 ? ` · ${clock(left)} left` : ' · planned time up'}</span>}
      <span class="muted"> · +{d.damage} dmg</span>
    </a>
  );
}

/** Asks when you stopped, for a window left running past 3 hours. Shown on opening the app. */
export function ForgottenEnd() {
  const state = useStore();
  const now = useNow();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const w = runningWindow(state);
  if (!w || !needsStopTime(w, now) || dismissed === w.id) return null;
  // Closing it puts it off until the app is opened again; End on the event screen asks too.
  return <StopTimeSheet window={w} onClose={() => setDismissed(w.id)} />;
}

function StopTimeSheet({ window: w, onClose }: { window: FocusWindow; onClose: () => void }) {
  const start = Date.parse(w.startAt);
  const cap = new Date(start + MONUMENTAL.maxWindowMinutes * MIN);
  const [time, setTime] = useState(minutesToInput(cap.getHours() * 60 + cap.getMinutes()));
  const [saving, save] = useSaving(async (e: Event) => {
    e.preventDefault();
    const minutes = inputToMinutes(time);
    if (minutes === null) return toast('Pick a time.', 'error');
    const at = deadlineAt(w.dayKey, minutes);
    const result = report(await run((s, now) => endFocus(s, now, at)));
    if (result === undefined) return;
    toast(`Window logged: ${result.minutes} min`, 'good');
    onClose();
  });
  return (
    <Sheet title="When did you stop?" onClose={onClose}>
      <form class="form" onSubmit={save}>
        <p class="hint">
          A focus window started at {formatTime(w.startAt)} and was never ended. Windows count for at most 3 hours, so anything after{' '}
          {formatTime(cap.toISOString())} doesn’t count.
        </p>
        <label>
          <span>Stopped at</span>
          <input type="time" value={time} required onInput={(e) => setTime(e.currentTarget.value)} />
        </label>
        <button class="btn primary wide" type="submit" disabled={saving}>
          End the window
        </button>
      </form>
    </Sheet>
  );
}

export function Monumental() {
  const state = useStore();
  const now = useNow();
  const fight = currentFight(state, now);
  const m = monumental(state);
  const hibernating = isHibernating(state, now);
  return (
    <div class="page monumental">
      <a class="back" href="#/events">
        ‹ Events
      </a>
      <PageTitle eyebrow="// permanent event" title="Monumental Works" />
      {fight ? (
        <BossPanel fight={fight} />
      ) : (
        <section class="panel boss waiting">
          <Sigil name={bossOf((m?.tier ?? 1) - 1).name} hidden />
          <b>The first boss arrives Monday at 4 AM.</b>
          <p class="hint">Focus you log before then is practice: it shows in your windows but doesn’t deal damage.</p>
        </section>
      )}
      {hibernating ? <p class="paused-note">Hibernating: focus logging is paused until you wake up.</p> : <FocusControl />}
      <TodayWindows now={now} />
      <DaysOff now={now} />
      <Ladder />
    </div>
  );
}

function BossPanel({ fight }: { fight: FightStatus }) {
  const { hp } = fight;
  const total = fight.damage + fight.pending;
  const left = Math.max(0, hp.hp - fight.damage);
  const pct = hp.hp ? Math.max(0, Math.min(1, 1 - fight.damage / hp.hp)) : 0;
  const pendingPct = hp.hp ? Math.min(pct, fight.pending / hp.hp) : 0;
  const phase = pct > MONUMENTAL.phases[0] ? 1 : pct > MONUMENTAL.phases[1] ? 2 : 3;
  const reward = defeatReward(fight.fight.tier);
  if (hp.skipped) {
    return (
      <section class="panel boss">
        <Sigil name={fight.name} hidden />
        <b>{fight.name} · skipped</b>
        <p class="paused-note">This week is mostly hibernated (or every workday is off), so there’s no result and the ladder stays put.</p>
      </section>
    );
  }
  return (
    <section class={`panel boss phase-${phase} ${fight.defeatedAt ? 'defeated' : ''}`}>
      <div class="boss-head">
        <Sigil name={fight.name} />
        <div>
          <span class="label">Tier {fight.fight.tier} · phase {phase}</span>
          <h2>{fight.name}</h2>
          <p class="flavor">{fight.flavor}</p>
        </div>
      </div>
      {fight.defeatedAt && <div class="defeated-stamp">DEFEATED</div>}
      <div class="hp-bar" role="progressbar" aria-valuenow={left} aria-valuemin={0} aria-valuemax={hp.hp} aria-label={`${fight.name}: ${left} of ${hp.hp} HP`}>
        <i class="hp" style={{ width: `${pct * 100}%` }} />
        {pendingPct > 0 && <i class="pending" style={{ left: `${(pct - pendingPct) * 100}%`, width: `${pendingPct * 100}%` }} />}
        {MONUMENTAL.phases.map((p) => (
          <b key={p} style={{ left: `${p * 100}%` }} />
        ))}
      </div>
      <div class="row between mono hp-line">
        <span>
          {fmt(left)} / {fmt(hp.hp)} HP
          {fight.pending > 0 && <span class="pending-text"> · −{fight.pending} when you end</span>}
        </span>
        <span>{Math.round((total / Math.max(1, hp.hp)) * 100)}%</span>
      </div>
      {(hp.daysOff > 0 || hp.hibernatedWorkdays > 0) && (
        <small class="mono muted">
          HP prorated to {hp.activeWorkdays}/5 workdays ({[hp.daysOff && `${hp.daysOff} off`, hp.hibernatedWorkdays && `${hp.hibernatedWorkdays} hibernated`].filter(Boolean).join(', ')}).
        </small>
      )}
      <div class="assault">
        <span class="label">Today’s assault</span>
        <div class="meter" role="progressbar" aria-valuenow={fight.todayDamage} aria-valuemin={0} aria-valuemax={fight.todayTarget}>
          <i style={{ width: `${Math.min(100, (fight.todayDamage / Math.max(1, fight.todayTarget)) * 100)}%` }} />
        </div>
        <small class="mono muted">
          {fight.todayDamage} / {fight.todayTarget} damage (a fifth of its HP)
        </small>
      </div>
      <small class="mono muted">
        Defeat by Monday 4 AM: <Amount value={reward.sparks} currency="sparks" signed /> <Amount value={reward.shards} currency="shards" signed />, more at 120%. Escaping
        after 50%+ still pays part.
      </small>
    </section>
  );
}

function FocusControl() {
  const state = useStore();
  const now = useNow(1000);
  const w = runningWindow(state);
  const [planned, setPlanned] = useState<number | null>(null);
  const [asking, setAsking] = useState(false);
  const start = async () => {
    if (report(await run((s, at) => startFocus(s, planned, at))) === undefined) return;
    play('complete');
    toast('Focus window started. Pair a planned length with the iPhone timer for an alarm.', 'good');
  };
  const end = async () => {
    if (!w) return;
    if (needsStopTime(w, now)) return setAsking(true);
    const result = report(await run((s, at) => endFocus(s, at)));
    if (result === undefined) return;
    play('complete');
    const fight = currentFight(state, now);
    toast(fight ? `Window ended: ${result.minutes} min` : `Practice window: ${result.minutes} min`, 'good');
  };
  if (w) {
    const elapsed = now.getTime() - Date.parse(w.startAt);
    const left = w.planned ? w.planned * MIN - elapsed : null;
    const all = windowDamage(weekWindows(state, w.weekKey), now);
    const mine = all.find((d) => d.window.id === w.id)!;
    return (
      <section class="panel focus-panel running">
        <span class="label">Focus window · since {formatTime(w.startAt)}</span>
        <b class="mono timer">{clock(elapsed)}</b>
        {left !== null && <small class="mono">{left > 0 ? `${clock(left)} left of ${w.planned} min` : `${w.planned} min reached`}</small>}
        <small class="mono muted">
          Pending damage {mine.damage}
          {mine.chain > 0 && ` · chain ×${MONUMENTAL.chainMultipliers[Math.min(mine.chain, MONUMENTAL.chainMultipliers.length - 1)]}`}
          {mine.crit ? ' · deep focus crit' : mine.minutes < MONUMENTAL.critMinutes ? ` · crit at ${MONUMENTAL.critMinutes} min` : ''}
        </small>
        <button class="btn primary wide" onClick={end}>
          End
        </button>
        {asking && <StopTimeSheet window={w} onClose={() => setAsking(false)} />}
      </section>
    );
  }
  return (
    <section class="panel focus-panel">
      <span class="label">Planned length (optional)</span>
      <div class="segmented dense" role="tablist">
        {[null, ...MONUMENTAL.plannedLengths].map((p) => (
          <button type="button" key={String(p)} role="tab" aria-selected={planned === p} class={planned === p ? 'on' : ''} onClick={() => setPlanned(p)}>
            {p === null ? 'None' : `${p} min`}
          </button>
        ))}
      </div>
      <button class="btn primary wide" onClick={start}>
        Start focus
      </button>
      <p class="hint small">
        The countdown shows while the app is open, but web apps can’t sound an alarm, so set the iPhone timer too. Windows of {MONUMENTAL.critMinutes}+ minutes
        crit, and starting within {MONUMENTAL.chainGapMinutes} minutes of the last one chains.
      </p>
    </section>
  );
}

function damageTags(d: WindowDamage): string {
  return [
    d.window.endAt === null ? 'running' : null,
    d.chain > 0 ? `chain ${d.chain + 1}` : null,
    d.crit ? 'crit' : null,
    d.short ? 'short' : null,
    d.window.source === 'manual' ? 'added' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function TodayWindows({ now }: { now: Date }) {
  const state = useStore();
  const today = dayKeyOf(now);
  const [editing, setEditing] = useState<FocusWindow | 'new' | null>(null);
  const all = windowDamage(weekWindows(state, weekKeyOf(today)), now).filter((d) => d.window.dayKey === today);
  const hibernating = isHibernating(state, now);
  const remove = async (w: FocusWindow) => {
    const ok = await confirmDialog({ title: 'Delete this window?', confirmLabel: 'Delete', danger: true });
    if (ok && succeeded(await run((s, at) => deleteWindow(s, w.id, at)))) toast('Window deleted');
  };
  return (
    <section class="panel windows">
      <h3 class="section-label">Today’s windows</h3>
      {all.length === 0 ? (
        <Empty>No focus yet today.</Empty>
      ) : (
        <ul class="window-list mono">
          {all.map((d) => (
            <li key={d.window.id}>
              <span class="grow">
                {formatTime(d.window.startAt)}
                {d.window.endAt && `–${formatTime(d.window.endAt)}`} · {d.minutes} min
                <small class="muted">{damageTags(d)}</small>
              </span>
              <b>{d.damage}</b>
              {d.window.endAt && (
                <>
                  <button class="mini" onClick={() => setEditing(d.window)}>
                    Edit
                  </button>
                  <button class="mini" aria-label="Delete window" onClick={() => remove(d.window)}>
                    ✕
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {!hibernating && (
        <button class="btn ghost wide" onClick={() => setEditing('new')}>
          + Add a window you forgot to start
        </button>
      )}
      {editing && <WindowSheet window={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function WindowSheet({ window: w, onClose }: { window: FocusWindow | null; onClose: () => void }) {
  const toInput = (iso: string) => {
    const d = new Date(iso);
    return minutesToInput(d.getHours() * 60 + d.getMinutes());
  };
  const [start, setStart] = useState(w ? toInput(w.startAt) : '');
  const [end, setEnd] = useState(w?.endAt ? toInput(w.endAt) : '');
  const [saving, save] = useSaving(async (e: Event) => {
    e.preventDefault();
    const s = inputToMinutes(start);
    const t = inputToMinutes(end);
    if (s === null || t === null) return toast('Pick a start and an end.', 'error');
    const ok = await run((st, now) => {
      const day = dayKeyOf(now);
      const from = deadlineAt(day, s);
      const to = deadlineAt(day, t);
      return w ? editWindow(st, w.id, from, to, now) : addWindow(st, from, to, now);
    });
    if (succeeded(ok)) {
      toast(w ? 'Window adjusted' : 'Window added', 'good');
      onClose();
    }
  });
  return (
    <Sheet title={w ? 'Adjust window' : 'Add a window'} onClose={onClose}>
      <form class="form" onSubmit={save}>
        <div class="row gap">
          <label class="grow">
            <span>Start</span>
            <input type="time" value={start} required onInput={(e) => setStart(e.currentTarget.value)} />
          </label>
          <label class="grow">
            <span>End</span>
            <input type="time" value={end} required onInput={(e) => setEnd(e.currentTarget.value)} />
          </label>
        </div>
        <p class="hint small">Today only, up to 3 hours, not overlapping another window.</p>
        <button class="btn primary wide" type="submit" disabled={saving}>
          {w ? 'Save' : 'Add window'}
        </button>
      </form>
    </Sheet>
  );
}

function DaysOff({ now }: { now: Date }) {
  const state = useStore();
  const today = dayKeyOf(now);
  const [day, setDay] = useState(today);
  const days = [...state.daysOff.keys()].sort().reverse();
  const mark = async (e: Event) => {
    e.preventDefault();
    if (succeeded(await run((s, at) => setDayOff(s, day, at)))) toast(`${formatDayKey(day)} is a day off: a fifth less boss HP that week`, 'good');
  };
  const cancel = async (d: string) => {
    if (succeeded(await run((s, at) => cancelDayOff(s, d, at)))) toast('Day off cancelled');
  };
  return (
    <section class="panel days-off">
      <h3 class="section-label">Days off</h3>
      <form class="row gap" onSubmit={mark}>
        <input type="date" min={today} value={day} required onInput={(e) => setDay(e.currentTarget.value)} />
        <button class="btn" type="submit">
          Mark off
        </button>
      </form>
      <p class="hint small">Holidays and PTO, Monday to Friday. Each one takes a fifth off that week’s boss HP. Only this event uses them.</p>
      {days.length > 0 && (
        <ul class="day-off-list mono">
          {days.map((d) => (
            <li key={d}>
              <span>{keyToDate(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>
              {d >= today ? (
                <button class="mini" onClick={() => cancel(d)}>
                  Cancel
                </button>
              ) : (
                <span class="muted">taken</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Ladder() {
  const state = useStore();
  const m = monumental(state);
  if (!m) return null;
  const weeks = [...state.bossWeeks.values()].sort((a, b) => (a.id < b.id ? 1 : -1)).slice(0, 6);
  const next = bossOf(Math.min(MONUMENTAL.tiers.length, m.tier + 1) - 1);
  return (
    <section class="panel ladder">
      <h3 class="section-label">Ladder</h3>
      <p class="mono small">
        Next week: Tier {m.tier}
        {m.escapes > 0 && ` · ${m.escapes} escape in a row (another drops a tier)`}
      </p>
      <p class="hint small">
        Defeat a boss to face the next tier ({m.tier < MONUMENTAL.tiers.length ? next.name : 'the top of the ladder'}); escape twice in a row and you drop one.
      </p>
      {weeks.length > 0 && (
        <ul class="ladder-list mono">
          {weeks.map((w) => (
            <li key={w.id}>
              <span>{keyToDate(w.id).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              <span class="grow">
                T{w.tier} {bossOf(w.boss).name}
              </span>
              <b class={w.result}>{w.result}</b>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

