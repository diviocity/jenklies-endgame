import { describeReward, markReportsSeen, unseenReports, type WeekReport } from '../logic/expedition';
import { addDays, keyToDate } from '../logic/time';
import { run, useStore } from '../store';
import { Amount, fmt, Portal } from './common';

function weekLabel(weekKey: string): string {
  const fmtDay = (key: string) => keyToDate(key).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${fmtDay(weekKey)} – ${fmtDay(addDays(weekKey, 6))}`;
}

/** Shown on the first open after a weekly reset: how the week went and what it paid. */
export function WeeklyReport() {
  const state = useStore();
  const reports = unseenReports(state);
  if (reports.length === 0) return null;
  // After a long break, older weeks are summed up and the latest is shown in full.
  const latest = reports[reports.length - 1];
  const earlier = reports.slice(0, -1);
  const close = () => void run((s) => markReportsSeen(s));

  return (
    <Portal>
      <div class="overlay">
        <div class="dialog panel weekly-report" role="dialog" aria-modal="true" aria-label="Weekly report">
          <div class="eyebrow">// expedition · weekly report</div>
          <h2>Week of {weekLabel(latest.week.id)}</h2>
          <WeekSummary report={latest} />
          {earlier.length > 0 && (
            <p class="hint small">
              Also closed while you were away: {earlier.length} {earlier.length === 1 ? 'week' : 'weeks'} (
              {earlier.map((r) => `${fmt(r.week.points)} pts`).join(', ')}).
            </p>
          )}
          <button class="btn primary wide" onClick={close}>
            Continue
          </button>
        </div>
      </div>
    </Portal>
  );
}

function WeekSummary({ report }: { report: WeekReport }) {
  const { week, nodes, mapFrom, mapTo } = report;
  const pct = week.targetPoints > 0 ? Math.round((week.points / week.targetPoints) * 100) : 0;
  const change = week.rankAfter - week.rankBefore;
  const rankNote = week.weak
    ? `weak week · ${Math.round(week.decay * 100)}% decay`
    : change > 0
      ? 'ranked up'
      : change < 0
        ? 'ranked down'
        : 'held steady';
  return (
    <div class="report-body">
      <div class="rank-stats">
        <div>
          <span class="label">Points</span>
          <b class="mono">
            {fmt(week.points)}
            <small>/{fmt(week.targetPoints)}</small>
          </b>
          <small class="mono muted">{pct}% of target</small>
        </div>
        <div>
          <span class="label">Rank</span>
          <b class={`mono ${change > 0 ? 'up' : change < 0 ? 'down' : ''}`}>
            {week.rankBefore} → {week.rankAfter}
          </b>
          <small class="mono muted">{rankNote}</small>
        </div>
      </div>
      {(week.rewardSparks ?? 0) + (week.rewardShards ?? 0) > 0 ? (
        <p class="report-line">
          Weekly reward: {week.rewardSparks ? <Amount value={week.rewardSparks} currency="sparks" signed /> : null}{' '}
          {week.rewardShards ? <Amount value={week.rewardShards} currency="shards" signed /> : null}
        </p>
      ) : (
        <p class="report-line muted">No weekly reward (it starts at 50% of the target).</p>
      )}
      {mapTo !== null && mapFrom !== null && (
        <p class="report-line">
          Map: {mapTo > mapFrom ? `+${fmt(mapTo - mapFrom)} points` : 'no movement'}
          {nodes.length > 0 && ` · ${nodes.length} ${nodes.length === 1 ? 'node' : 'nodes'} reached`}
        </p>
      )}
      {nodes.some((n) => n.selector) && (
        <ul class="report-nodes">
          {nodes
            .filter((n) => n.selector)
            .map((n) => (
              <li key={n.index}>★ {describeReward(n)}</li>
            ))}
        </ul>
      )}
    </div>
  );
}
