import { unseenDepotWeeks } from '../logic/depot';
import { unseenProvisionWeeks } from '../logic/provisions';
import { bossOf, unseenBossWeeks } from '../logic/monumental';
import { describeReward, markReportsSeen, unseenReports, type WeekReport } from '../logic/expedition';
import { isHibernating, periodLength, periods } from '../logic/hibernation';
import { addDays, keyToDate } from '../logic/time';
import type { BossWeek, DepotWeek, ProvisionsWeek } from '../types';
import { run, useStore } from '../store';
import { Amount, fmt, Portal, useNow } from './common';

function weekLabel(weekKey: string): string {
  const fmtDay = (key: string) => keyToDate(key).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${fmtDay(weekKey)} – ${fmtDay(addDays(weekKey, 6))}`;
}

/** Shown on the first open after a weekly reset: how the week went and what it paid. */
export function WeeklyReport() {
  const state = useStore();
  const now = useNow();
  const reports = unseenReports(state);
  const depotWeeks = unseenDepotWeeks(state);
  const provisionWeeks = unseenProvisionWeeks(state);
  const bossWeeks = unseenBossWeeks(state);
  // Held back until you wake up, so it greets you when you're back.
  const none = reports.length === 0 && depotWeeks.length === 0 && provisionWeeks.length === 0 && bossWeeks.length === 0;
  if (none || isHibernating(state, now)) return null;
  // After a long break, older weeks are summed up and the latest is shown in full.
  const latest = reports[reports.length - 1];
  const earlier = reports.slice(0, -1);
  const weekId =
    latest?.week.id ?? depotWeeks[depotWeeks.length - 1]?.id ?? provisionWeeks[provisionWeeks.length - 1]?.id ?? bossWeeks[bossWeeks.length - 1].id;
  const close = () => void run((s) => markReportsSeen(s));
  if (latest?.week.skipped) return <WelcomeBack reports={reports} onClose={close} />;
  const skipped = earlier.filter((r) => r.week.skipped);
  const missed = earlier.filter((r) => !r.week.skipped);

  return (
    <Portal>
      <div class="overlay">
        <div class="dialog panel weekly-report" role="dialog" aria-modal="true" aria-label="Weekly report">
          <div class="eyebrow">// weekly report</div>
          <h2>Week of {weekLabel(weekId)}</h2>
          {latest && <WeekSummary report={latest} />}
          <DepotSummary weeks={depotWeeks} weekId={weekId} />
          <ProvisionsSummary week={provisionWeeks.find((w) => w.id === weekId)} />
          <BossSummary week={bossWeeks.find((w) => w.id === weekId)} />
          {skipped.length > 0 && (
            <p class="hint small">
              Skipped while hibernating: {skipped.length} {skipped.length === 1 ? 'week' : 'weeks'}. Nothing decayed.
            </p>
          )}
          {missed.length > 0 && (
            <p class="hint small">
              Also closed while you were away: {missed.length} {missed.length === 1 ? 'week' : 'weeks'} (
              {missed.map((r) => `${fmt(r.week.points)} pts`).join(', ')}).
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

/** After hibernating through a week: a short summary instead of the usual report. */
function WelcomeBack({ reports, onClose }: { reports: WeekReport[]; onClose: () => void }) {
  const state = useStore();
  const now = useNow();
  const last = periods(state).filter((h) => h.endAt && h.endAt <= now.toISOString()).pop();
  const skipped = reports.filter((r) => r.week.skipped);
  const rank = reports[reports.length - 1].week.rankAfter;
  const paid = reports.reduce((s, r) => s + (r.week.rewardSparks ?? 0), 0);
  return (
    <Portal>
      <div class="overlay">
        <div class="dialog panel weekly-report welcome-back" role="dialog" aria-modal="true" aria-label="Welcome back">
          <div class="eyebrow">// hibernation ended</div>
          <h2>Welcome back</h2>
          {last && (
            <p class="report-line">
              You hibernated for {periodLength(last, now)} {periodLength(last, now) === 1 ? 'day' : 'days'}.
            </p>
          )}
          <p class="report-line">
            {skipped.length} {skipped.length === 1 ? 'week was' : 'weeks were'} skipped: nothing decayed, and Rank {rank} is right where you left
            it.
          </p>
          {paid > 0 && (
            <p class="report-line">
              Weekly rewards from the active part of the break: <Amount value={paid} currency="sparks" signed />
            </p>
          )}
          <p class="hint small">Tasks, fitness logging and the Salvage Exchange are back on.</p>
          <button class="btn primary wide" onClick={onClose}>
            Continue
          </button>
        </div>
      </div>
    </Portal>
  );
}

/** Monumental Works: the week's boss fight. */
function BossSummary({ week }: { week?: BossWeek }) {
  if (!week || week.result === 'skipped') return null;
  const pct = week.hp > 0 ? Math.round((week.damage / week.hp) * 100) : 0;
  const reward = week.rewardSparks + week.rewardShards > 0;
  return (
    <p class="report-line">
      Boss: {bossOf(week.boss).name} {week.result === 'defeated' ? 'defeated' : 'escaped'} ({pct}% of {week.hp} HP)
      {reward && (
        <>
          {' '}
          · <Amount value={week.rewardSparks} currency="sparks" signed /> <Amount value={week.rewardShards} currency="shards" signed />
        </>
      )}
      {week.nextTier !== week.tier && ` · next week Tier ${week.nextTier}`}
    </p>
  );
}

const SUPPLY_TEXT = { onTime: 'supply line up on time', late: 'supply line up late', down: 'supply line down', skipped: 'skipped' } as const;

/** Contingency Provisions: the week's meals, supply line and ration report. */
function ProvisionsSummary({ week }: { week?: ProvisionsWeek }) {
  if (!week || week.scheduled === 0) return null;
  const pct = Math.round((week.onPlan / week.scheduled) * 100);
  return (
    <p class="report-line">
      Rations: {week.onPlan}/{week.scheduled} meals on plan ({pct}%) · {SUPPLY_TEXT[week.supply]}
      {week.rationSparks > 0 ? (
        <>
          {' '}
          · <Amount value={week.rationSparks} currency="sparks" signed /> <Amount value={week.rationShards} currency="shards" signed />
        </>
      ) : null}
      {week.expired > 0 && ` · ${week.expired} held ${week.expired === 1 ? 'stamp' : 'stamps'} expired`}
    </p>
  );
}

/** The Salvage Exchange's weekly mission, for the week shown and any earlier ones missed. */
function DepotSummary({ weeks, weekId }: { weeks: DepotWeek[]; weekId: string }) {
  const week = weeks.find((w) => w.id === weekId);
  const earlierDone = weeks.filter((w) => w.id !== weekId && w.completed).length;
  if ((!week || week.total === 0) && earlierDone === 0) return null;
  return (
    <>
      {week && week.total > 0 && (
        <p class="report-line">
          Salvage mission:{' '}
          {week.completed ? (
            <>
              ✓ all {week.total} featured {week.total === 1 ? 'lot' : 'lots'} listed ·{' '}
              <Amount value={week.rewardSparks} currency="sparks" signed /> <Amount value={week.rewardShards} currency="shards" signed />
            </>
          ) : (
            `${week.listed}/${week.total} featured lots listed · they stay featured`
          )}
        </p>
      )}
      {earlierDone > 0 && (
        <p class="hint small">
          Salvage missions completed in earlier weeks: {earlierDone}.
        </p>
      )}
    </>
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
