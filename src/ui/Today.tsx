import { useState } from 'preact/hooks';
import {
  addOneOff,
  bucketStatus,
  completeTask,
  dayTotals,
  oneOffValues,
  removeOneOff,
  today,
  undoTask,
} from '../logic/actions';
import { BUCKET_LABELS, deadlineAt, formatDayKey, formatMinutes, formatTime, inputToMinutes } from '../logic/time';
import { FITNESS } from '../config';
import { play } from '../sound';
import { run, useStore } from '../store';
import type { BucketId, DayBucket, DayRecord, DayTask } from '../types';
import { Amount, confirmDialog, Empty, fmt, names, report, Sheet, succeeded, toast, useNow, useSaving } from './common';

function timeLeft(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

export function Today() {
  const state = useStore();
  const now = useNow();
  const [adding, setAdding] = useState(false);
  const day = today(state, now);
  if (!day) return <div class="boot">Starting the day…</div>;

  const done = day.tasks.filter((t) => t.completedAt);
  const { earned, max: possible } = dayTotals(day);
  const pct = day.tasks.length ? Math.round((done.length / day.tasks.length) * 100) : 0;

  return (
    <div class="page">
      <section class="hero panel">
        <div class="eyebrow">
          // {day.dayType === 'weekday' ? 'weekday' : 'weekend'} operations · {day.id}
        </div>
        <h1>{formatDayKey(day.id)}</h1>
        <div class="hero-stats">
          <div>
            <span class="label">Tasks</span>
            <b>
              {done.length}/{day.tasks.length}
            </b>
          </div>
          <div>
            <span class="label">Earned</span>
            <b>
              <Amount value={earned} currency="sparks" />
            </b>
          </div>
          <div>
            <span class="label">Max</span>
            <b class="muted">{fmt(possible)}</b>
          </div>
        </div>
        <div class="meter" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <i style={{ width: `${pct}%` }} />
        </div>
      </section>

      {day.buckets.map((b, i) => (
        <BucketCard key={b.id} day={day} bucket={b} index={i} now={now} />
      ))}

      <button class="btn ghost wide" onClick={() => setAdding(true)}>
        + Add a one-off task for today
      </button>
      {adding && <OneOffSheet day={day} onClose={() => setAdding(false)} />}
    </div>
  );
}

function BucketCard(props: { day: DayRecord; bucket: DayBucket; index: number; now: Date }) {
  const { day, bucket, now } = props;
  const tasks = day.tasks.filter((t) => t.bucket === bucket.id).sort((a, b) => a.order - b.order);
  const due = deadlineAt(day.id, bucket.deadline).getTime() + 60_000;
  const open = now.getTime() < due;
  const status = bucketStatus(day, bucket.id);
  const complete = tasks.length > 0 && tasks.every((t) => t.completedAt);

  return (
    <section class={`bucket panel ${complete ? 'complete' : ''}`}>
      <header>
        <div>
          <span class="index">0{props.index + 1}</span>
          <h2>{BUCKET_LABELS[bucket.id]}</h2>
        </div>
        <div class={`window ${open ? 'open' : 'closed'}`}>
          {complete ? 'CLEAR' : open ? `BONUS · ${timeLeft(due - now.getTime())}` : 'BONUS CLOSED'}
          <small>by {formatMinutes(bucket.deadline)}</small>
        </div>
      </header>
      {status.counted.length > 0 && status.bonus + status.perfectBonus > 0 && <BucketReward status={status} now={now} day={day} />}
      {tasks.length === 0 ? (
        <Empty>No tasks in this bucket.</Empty>
      ) : (
        <ul class="tasks">
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} bucketDeadline={bucket.deadline} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** The bucket's two bonuses: one for clearing it, one more if every task was on time. */
function BucketReward({ status, now, day }: { status: ReturnType<typeof bucketStatus>; now: Date; day: DayRecord }) {
  const doneCount = status.counted.filter((t) => t.completedAt).length;
  const missed = status.counted.some(
    (t) => (t.completedAt && !t.onTime) || (!t.completedAt && now.getTime() >= deadlineAt(day.id, t.deadline).getTime() + 60_000),
  );
  const perfectState = status.perfect ? 'earned' : missed ? 'lost' : 'pending';
  return (
    <div class="bucket-reward">
      <span class={`reward-chip clear ${status.cleared ? 'earned' : ''}`}>
        <span class="reward-label">{status.cleared ? '✓ Cleared' : `Clear ${doneCount}/${status.counted.length}`}</span>
        <b>+{fmt(status.bonus)}</b>
      </span>
      <span class={`reward-chip perfect ${perfectState}`}>
        <span class="reward-label">
          {perfectState === 'earned' ? '✓ Perfect' : perfectState === 'lost' ? 'Perfect missed' : 'All on time'}
        </span>
        <b>+{fmt(status.perfectBonus)}</b>
      </span>
    </div>
  );
}

function TaskRow({ task, bucketDeadline }: { task: DayTask; bucketDeadline: number }) {
  const { sparksName } = names();
  const complete = async () => {
    play('complete');
    const result = report(await run((s, now) => completeTask(s, task.id, now)));
    if (!result) return;
    const fitness = result.fitness ? ` · +${result.fitness} FP` : '';
    toast(`+${result.earned} ${sparksName}${result.onTime ? ' · on time' : ''}${fitness}`, 'good');
    if (result.cleared) {
      play('clear');
      const label = BUCKET_LABELS[task.bucket];
      toast(
        result.perfect
          ? `${label} perfect! +${fmt(result.cleared + result.perfect)} ${sparksName}`
          : `${label} cleared! +${fmt(result.cleared)} ${sparksName}`,
        'good',
      );
    }
  };
  const undo = async () => {
    play('undo');
    const result = report(await run((s, now) => undoTask(s, task.id, now)));
    if (result) toast(`Undone · −${result.refunded} ${sparksName}`);
  };
  const remove = async () => {
    const ok = await confirmDialog({ title: `Remove "${task.name}" from today?`, confirmLabel: 'Remove', danger: true });
    if (ok) report(await run((s, now) => removeOneOff(s, task.id, now)));
  };

  const done = !!task.completedAt;
  return (
    <li class={`task ${done ? 'done' : ''}`}>
      <button
        class="check"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `${task.name}, done` : `Complete ${task.name}`}
        onClick={done ? undefined : complete}
        disabled={done}
      >
        <span class="box" aria-hidden="true">
          {done && '✓'}
        </span>
        <span class="task-text">
          <span class="task-name">
            {task.name}
            {task.oneOff && <em class="tag">ONE-OFF</em>}
          </span>
          {done ? (
            <span class={`task-sub ${task.onTime ? 'ok' : 'late'}`}>
              {formatTime(task.completedAt!)} · +{task.base + (task.onTime ? task.bonus : 0)}{' '}
              {task.onTime ? 'ON TIME' : 'LATE'}
            </span>
          ) : (
            <span class="task-sub">
              +{task.base} <span class="bonus">+{task.bonus} on time</span>
              {task.deadline !== bucketDeadline && <> · by {formatMinutes(task.deadline)}</>}
              {task.fitness && <span class="fp"> · +{FITNESS.points[task.fitness]} FP</span>}
            </span>
          )}
        </span>
      </button>
      {done ? (
        <button class="mini" onClick={undo}>
          Undo
        </button>
      ) : (
        task.oneOff && (
          <button class="mini" aria-label={`Remove ${task.name}`} onClick={remove}>
            ✕
          </button>
        )
      )}
    </li>
  );
}

function OneOffSheet({ day, onClose }: { day: DayRecord; onClose: () => void }) {
  const [name, setName] = useState('');
  const [bucket, setBucket] = useState<BucketId>(day.buckets[day.buckets.length - 1].id);
  const [deadline, setDeadline] = useState('');
  const value = oneOffValues(day);

  const [saving, save] = useSaving(async (e: Event) => {
    e.preventDefault();
    const minutes = deadline ? inputToMinutes(deadline) : null;
    if (succeeded(await run((s, now) => addOneOff(s, { name, bucket, deadline: minutes }, now)))) onClose();
  });

  return (
    <Sheet title="One-off task" onClose={onClose}>
      <form class="form" onSubmit={save}>
        <label>
          <span>Name</span>
          <input value={name} onInput={(e) => setName(e.currentTarget.value)} autoFocus maxLength={80} required />
        </label>
        <label>
          <span>Bucket</span>
          <select value={bucket} onChange={(e) => setBucket(e.currentTarget.value as BucketId)}>
            {day.buckets.map((b) => (
              <option key={b.id} value={b.id}>
                {BUCKET_LABELS[b.id]} (by {formatMinutes(b.deadline)})
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Own deadline (optional)</span>
          <input type="time" value={deadline} onInput={(e) => setDeadline(e.currentTarget.value)} />
        </label>
        <p class="hint">
          Worth +{value.base} (+{value.bonus} on time), today only. One-off tasks don't affect bucket bonuses.
        </p>
        <button class="btn primary wide" type="submit" disabled={saving}>
          {saving ? 'Adding…' : 'Add to today'}
        </button>
      </form>
    </Sheet>
  );
}
