import { useState } from 'preact/hooks';
import { deleteTemplateTask, moveTemplateTask, saveTemplateTask, validateTemplateTask } from '../logic/actions';
import { baseRate, taskValues, weeklyWeight } from '../logic/rewards';
import { getMeta, sortByOrder } from '../logic/state';
import {
  BUCKET_LABELS,
  bucketsFor,
  DAY_NAMES,
  formatMinutes,
  inputToMinutes,
  minutesToInput,
} from '../logic/time';
import { run, useStore } from '../store';
import type { BucketId, DayType, TemplateTask } from '../types';
import { BackLink, confirmDialog, Empty, fmt, PageTitle, report, Segmented, Sheet } from './common';

const GROUP_DAYS: Record<DayType, number[]> = { weekday: [1, 2, 3, 4, 5], weekend: [6, 0] };

function daysLabel(days: number[], group: DayType): string {
  const all = GROUP_DAYS[group];
  if (all.every((d) => days.includes(d))) return group === 'weekday' ? 'Mon–Fri' : 'Sat & Sun';
  return all.filter((d) => days.includes(d)).map((d) => DAY_NAMES[d]).join(' ');
}

type Draft = { id?: string; name: string; days: number[]; bucket: BucketId; deadline: string; weight: string };

export function TemplateEditor() {
  const state = useStore();
  const [group, setGroup] = useState<DayType>('weekday');
  const [draft, setDraft] = useState<Draft | null>(null);
  const tasks = [...state.templateTasks.values()];
  const rate = baseRate(tasks);
  const one = taskValues(1, rate);
  const { deadlines } = getMeta(state).settings;

  const edit = (t: TemplateTask) =>
    setDraft({
      id: t.id,
      name: t.name,
      days: t.days,
      bucket: t.bucket,
      deadline: t.deadlineOverride === null ? '' : minutesToInput(t.deadlineOverride),
      weight: String(t.weight),
    });
  const add = (bucket: BucketId) =>
    setDraft({ name: '', days: GROUP_DAYS[group], bucket, deadline: '', weight: '1' });

  return (
    <div class="page">
      <BackLink />
      <PageTitle eyebrow="// weekly template" title="Template" />
      <p class="hint">
        {fmt(weeklyWeight(tasks))} weighted tasks a week · weight 1 = +{one.base} (+{one.bonus} on time). Changes apply
        from tomorrow; today is already locked in.
      </p>
      <Segmented
        value={group}
        onChange={setGroup}
        options={[
          { value: 'weekday', label: 'Weekdays' },
          { value: 'weekend', label: 'Weekend' },
        ]}
      />
      {bucketsFor(group).map((bucket) => {
        const list = sortByOrder(tasks.filter((t) => t.bucket === bucket));
        return (
          <section key={bucket} class="panel bucket">
            <header>
              <h2>{BUCKET_LABELS[bucket]}</h2>
              <span class="mono muted small">by {formatMinutes(deadlines[bucket])}</span>
            </header>
            {list.length === 0 && <Empty>No tasks.</Empty>}
            <ul class="tasks editable">
              {list.map((t, i) => {
                const v = taskValues(t.weight, rate);
                return (
                  <li key={t.id} class="task">
                    <button class="edit-row" onClick={() => edit(t)}>
                      <span class="task-name">{t.name}</span>
                      <span class="task-sub">
                        {daysLabel(t.days, group)} · +{v.base}/{v.bonus}
                        {t.weight !== 1 && <> · weight {t.weight}</>}
                        {t.deadlineOverride !== null && <> · by {formatMinutes(t.deadlineOverride)}</>}
                      </span>
                    </button>
                    <span class="order-btns">
                      <button
                        class="mini"
                        aria-label={`Move ${t.name} up`}
                        disabled={i === 0}
                        onClick={async () => report(await run((s) => moveTemplateTask(s, t.id, -1)))}
                      >
                        ↑
                      </button>
                      <button
                        class="mini"
                        aria-label={`Move ${t.name} down`}
                        disabled={i === list.length - 1}
                        onClick={async () => report(await run((s) => moveTemplateTask(s, t.id, 1)))}
                      >
                        ↓
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
            <button class="btn ghost wide" onClick={() => add(bucket)}>
              + Add to {BUCKET_LABELS[bucket]}
            </button>
          </section>
        );
      })}
      {draft && <TaskSheet draft={draft} group={group} onClose={() => setDraft(null)} />}
    </div>
  );
}

function TaskSheet(props: { draft: Draft; group: DayType; onClose: () => void }) {
  const [d, setD] = useState(props.draft);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => setD((prev) => ({ ...prev, ...patch }));
  const toggleDay = (day: number) =>
    set({ days: d.days.includes(day) ? d.days.filter((x) => x !== day) : [...d.days, day] });

  const save = async (e: Event) => {
    e.preventDefault();
    const input = {
      id: d.id,
      name: d.name,
      days: d.days,
      bucket: d.bucket,
      deadlineOverride: d.deadline ? inputToMinutes(d.deadline) : null,
      weight: Number(d.weight),
    };
    const problem = validateTemplateTask(input);
    if (problem) return setError(problem);
    if (report(await run((s) => saveTemplateTask(s, input))) !== undefined) props.onClose();
  };

  const remove = async () => {
    const ok = await confirmDialog({
      title: `Delete "${d.name}" from the template?`,
      body: 'Past days keep their records. It disappears from tomorrow on.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok && report(await run((s) => deleteTemplateTask(s, d.id!))) !== undefined) props.onClose();
  };

  return (
    <Sheet title={d.id ? 'Edit task' : 'New task'} onClose={props.onClose}>
      <form class="form" onSubmit={save}>
        <label>
          <span>Name</span>
          <input value={d.name} onInput={(e) => set({ name: e.currentTarget.value })} maxLength={80} required />
        </label>
        <label>
          <span>Bucket</span>
          <select value={d.bucket} onChange={(e) => set({ bucket: e.currentTarget.value as BucketId })}>
            {bucketsFor(props.group).map((b) => (
              <option key={b} value={b}>
                {BUCKET_LABELS[b]}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>Days</legend>
          <div class="day-toggles">
            {GROUP_DAYS[props.group].map((day) => (
              <button
                type="button"
                key={day}
                class={d.days.includes(day) ? 'on' : ''}
                aria-pressed={d.days.includes(day)}
                onClick={() => toggleDay(day)}
              >
                {DAY_NAMES[day]}
              </button>
            ))}
          </div>
        </fieldset>
        <div class="row gap">
          <label class="grow">
            <span>Own deadline (optional)</span>
            <input type="time" value={d.deadline} onInput={(e) => set({ deadline: e.currentTarget.value })} />
          </label>
          <label class="narrow">
            <span>Weight</span>
            <input
              type="number"
              inputMode="decimal"
              min="0.1"
              step="0.1"
              value={d.weight}
              onInput={(e) => set({ weight: e.currentTarget.value })}
            />
          </label>
        </div>
        {d.deadline && (
          <button type="button" class="link" onClick={() => set({ deadline: '' })}>
            Use the bucket deadline instead
          </button>
        )}
        {error && <p class="blocked">{error}</p>}
        <button class="btn primary wide" type="submit">
          Save
        </button>
        {d.id && (
          <button type="button" class="btn danger-ghost wide" onClick={remove}>
            Delete task
          </button>
        )}
      </form>
    </Sheet>
  );
}
