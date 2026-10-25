import { useEffect, useRef, useState } from 'preact/hooks';
import { BACKUP, FITNESS } from '../config';
import { markBackedUp, saveSettings } from '../logic/actions';
import { backupFileName, buildBackup, parseBackup, summarizeBackup } from '../logic/backup';
import { getMeta } from '../logic/state';
import { BUCKET_LABELS, formatDateTime, inputToMinutes, minutesToInput, WEEKDAY_BUCKETS, WEEKEND_BUCKETS } from '../logic/time';
import { getState, importBackup, run, useStore } from '../store';
import type { BucketId, FitnessTarget, Settings } from '../types';
import { canIgnoreSilentMode } from '../sound';
import { frontier } from '../logic/event';
import { setActiveTitle } from '../logic/expedition';
import { screenReport } from '../screen';
import { FITNESS_LABELS, FITNESS_TYPES, targetPoints } from '../logic/rank';
import { BackLink, BuildStamp, confirmDialog, fmt, PageTitle, report, toast } from './common';

export function SettingsPage() {
  const state = useStore();
  const saved = getMeta(state).settings;
  const [s, setS] = useState<Settings>(saved);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);
  const event = frontier(state);
  const themes = event?.themes ?? [];

  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersisted, () => setPersisted(null));
  }, []);

  const setDeadline = (bucket: BucketId, value: string) => {
    const m = inputToMinutes(value);
    if (m !== null) setS({ ...s, deadlines: { ...s.deadlines, [bucket]: m } });
  };

  const save = async (e: Event) => {
    e.preventDefault();
    if (report(await run((st) => saveSettings(st, s))) !== undefined) toast('Settings saved', 'good');
  };

  const requestPersist = async () => {
    const ok = await navigator.storage?.persist?.();
    setPersisted(!!ok);
    toast(ok ? 'Storage is now persistent' : 'The browser declined. Installing to the Home Screen usually helps.');
  };

  const deadlineField = (b: BucketId) => (
    <label key={b}>
      <span>{BUCKET_LABELS[b]}</span>
      <input type="time" value={minutesToInput(s.deadlines[b])} onInput={(e) => setDeadline(b, e.currentTarget.value)} />
    </label>
  );

  return (
    <div class="page">
      <BackLink />
      <PageTitle eyebrow="// configuration" title="Settings" />
      <form class="form" onSubmit={save}>
        <section class="panel">
          <h3 class="section-label">Weekday deadlines</h3>
          <div class="grid3">{WEEKDAY_BUCKETS.map(deadlineField)}</div>
          <h3 class="section-label">Weekend deadlines</h3>
          <div class="grid3">{WEEKEND_BUCKETS.map(deadlineField)}</div>
          <p class="hint">Times before 4:00 AM count as after midnight. Changes apply from tomorrow.</p>
        </section>
        <section class="panel">
          <h3 class="section-label">Currency names</h3>
          <div class="row gap">
            <label class="grow">
              <span>Main currency</span>
              <input value={s.sparksName} maxLength={20} onInput={(e) => setS({ ...s, sparksName: e.currentTarget.value })} />
            </label>
            <label class="grow">
              <span>Shop currency</span>
              <input value={s.shardsName} maxLength={20} onInput={(e) => setS({ ...s, shardsName: e.currentTarget.value })} />
            </label>
          </div>
          <label class="switch">
            <input type="checkbox" checked={s.soundOn} onChange={(e) => setS({ ...s, soundOn: e.currentTarget.checked })} />
            <span>Sound effects</span>
          </label>
          {canIgnoreSilentMode() && (
            <>
              <label class="switch">
                <input
                  type="checkbox"
                  checked={s.soundIgnoresSilent ?? false}
                  disabled={!s.soundOn}
                  onChange={(e) => setS({ ...s, soundIgnoresSilent: e.currentTarget.checked })}
                />
                <span>Play even when the iPhone is on silent</span>
              </label>
              <p class="hint">This can pause music or podcasts playing in other apps when a sound plays.</p>
            </>
          )}
        </section>
        <TargetWeek
          target={s.fitnessTarget ?? { ...FITNESS.defaultTarget }}
          onChange={(fitnessTarget) => setS({ ...s, fitnessTarget })}
        />
        {themes.includes('endgame') && (
          <section class="panel">
            <h3 class="section-label">Theme</h3>
            <label class="switch">
              <input
                type="checkbox"
                checked={s.theme === 'endgame'}
                onChange={(e) => setS({ ...s, theme: e.currentTarget.checked ? 'endgame' : 'default' })}
              />
              <span>Endgame theme (unlocked by finishing the expedition)</span>
            </label>
          </section>
        )}
        <button class="btn primary wide" type="submit" disabled={!dirty}>
          Save settings
        </button>
      </form>
      {(event?.titles ?? []).length > 0 && (
        <section class="panel">
          <h3 class="section-label">Title</h3>
          <label>
            <span>Shown under the brand</span>
            <select
              value={event!.activeTitle ?? ''}
              onChange={async (e) => {
                const title = e.currentTarget.value || null;
                report(await run((st) => setActiveTitle(st, title)));
              }}
            >
              <option value="">No title</option>
              {event!.titles!.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </section>
      )}
      <section class="panel">
        <h3 class="section-label">Storage</h3>
        <p class="small">
          {persisted === true && 'Persistent: the browser has agreed to keep your data.'}
          {persisted === false && 'Not persistent yet: the browser may clear data under pressure. Keep backups.'}
          {persisted === null && 'Persistence status is unavailable in this browser.'}
        </p>
        {persisted === false && (
          <button class="btn ghost wide" onClick={requestPersist}>
            Ask again
          </button>
        )}
      </section>
      <section class="panel">
        <h3 class="section-label">Screen</h3>
        <p class="hint">What this device reports about its screen. Handy for troubleshooting layout.</p>
        <pre class="screen-report">{screenReport().join('\n')}</pre>
      </section>
      <BuildStamp />
    </div>
  );
}

export function BackupPage() {
  const state = useStore();
  const meta = getMeta(state);
  const fileInput = useRef<HTMLInputElement>(null);

  const exportData = async () => {
    const now = new Date();
    const json = JSON.stringify(buildBackup(getState(), now), null, 1);
    const name = backupFileName(now);
    const file = new File([json], name, { type: 'application/json' });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
      } else {
        const url = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      toast(`Export failed: ${(e as Error).message}`, 'error');
      return;
    }
    report(await run((s) => markBackedUp(s, now)));
    toast('Backup exported', 'good');
  };

  const onFile = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    let parsed;
    try {
      parsed = parseBackup(await file.text());
    } catch (err) {
      toast((err as Error).message, 'error');
      return;
    }
    const ok = await confirmDialog({
      title: 'Replace all current data?',
      body: (
        <>
          <p>
            Backup from <b>{formatDateTime(parsed.exportedAt)}</b>
          </p>
          <p class="small muted">{summarizeBackup(parsed)}</p>
          <p class="warn-text">Everything on this device is replaced. This can't be undone.</p>
        </>
      ),
      confirmLabel: 'Replace',
      danger: true,
    });
    if (!ok) return;
    try {
      await importBackup(parsed);
      toast('Backup restored', 'good');
    } catch (err) {
      toast(`Import failed: ${(err as Error).message}`, 'error');
    }
  };

  return (
    <div class="page">
      <BackLink />
      <PageTitle eyebrow="// data integrity" title="Backup" />
      <section class="panel">
        <span class="label">Last backup</span>
        <p class="big mono">{meta.lastBackupAt ? formatDateTime(meta.lastBackupAt) : 'Never'}</p>
        <p class="hint">
          Your data only lives on this device. Export a backup at least every {BACKUP.remindAfterDays} days and keep it
          somewhere safe (Files, iCloud Drive).
        </p>
        <button class="btn primary wide" onClick={exportData}>
          Export backup (.json)
        </button>
      </section>
      <section class="panel">
        <span class="label">Restore</span>
        <p class="hint">Import a backup file. You'll be asked to confirm before anything is replaced.</p>
        <button class="btn ghost wide" onClick={() => fileInput.current?.click()}>
          Import backup…
        </button>
        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={onFile} />
      </section>
    </div>
  );
}

/** The Frontier Expedition's target week: Rank 20 means doing this consistently. */
function TargetWeek(props: { target: FitnessTarget; onChange: (t: FitnessTarget) => void }) {
  const total = targetPoints(props.target);
  return (
    <section class="panel">
      <h3 class="section-label">Frontier Expedition · target week</h3>
      <div class="grid3">
        {FITNESS_TYPES.map((type) => (
          <label key={type}>
            <span>
              {FITNESS_LABELS[type]} ×
            </span>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              max="21"
              step="1"
              value={props.target[type]}
              onInput={(e) => {
                const n = Math.max(0, Math.floor(Number(e.currentTarget.value) || 0));
                props.onChange({ ...props.target, [type]: n });
              }}
            />
          </label>
        ))}
      </div>
      <p class="hint">
        {fmt(total)} points a week. Rank 20 means doing this consistently, and your rank rescales straight away when you
        change it (for example, when PT ends). Only {FITNESS.activityWeeklyCap} minor activities a week count.
      </p>
    </section>
  );
}
