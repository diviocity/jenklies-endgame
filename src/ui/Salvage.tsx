import { useState } from 'preact/hooks';
import { DEPOT } from '../config';
import {
  activeSlotOf,
  addPlatform,
  ageTag,
  deleteSaleItem,
  depotView,
  listingPrompt,
  listingReward,
  listItem,
  markHandedOff,
  markPhotographed,
  markSold,
  milestoneName,
  milestoneReward,
  milestonesThrough,
  moneyRecord,
  nextMilestone,
  platforms,
  saleFellThrough,
  saveSaleItem,
  setPlatforms,
  STAGE_LABELS,
  stageOf,
  STAGES,
  stepLabel,
  depot,
  takeDown,
  undoableStep,
  undoStep,
  type Milestone,
  type MilestoneKind,
  type StageResult,
} from '../logic/depot';
import type { ActionResult } from '../logic/errors';
import { isHibernating, isSkippedWeek } from '../logic/hibernation';
import { addDays, deadlineAt } from '../logic/time';
import { play } from '../sound';
import { run, useStore } from '../store';
import type { AppState, FeaturedSlot, SaleItem } from '../types';
import { Amount, confirmDialog, Empty, fmt, names, PageTitle, report, Sheet, succeeded, toast, useNow, useSaving } from './common';

type Open =
  | { kind: 'add' }
  | { kind: 'edit'; id: string }
  | { kind: 'item'; id: string }
  | { kind: 'list'; id: string }
  | { kind: 'platforms'; id: string }
  | { kind: 'sold'; id: string };

/** The Events tab card. */
export function SalvageCard() {
  const state = useStore();
  const now = useNow();
  const view = depotView(state, now);
  const summary =
    state.saleItems.size === 0
      ? 'Add the things you want to sell'
      : `${view.featured.length} featured · ${view.onMarket.length} on the market` +
        (view.mission.total > 0 ? ` · mission ${view.mission.listed}/${view.mission.total}` : '');
  return (
    <a class="event-card panel salvage-card" href="#/events/salvage">
      <span class="event-art crate-art" aria-hidden="true">
        <i />
        <i />
      </span>
      <span class="event-copy">
        <span class="eyebrow">permanent · selling</span>
        <b>Salvage Exchange</b>
        <small class="mono">{summary}</small>
      </span>
      <span aria-hidden="true">›</span>
    </a>
  );
}

function rewardToast(result: StageResult, what: string) {
  const { sparksName, shardsName } = names();
  const paid = [result.sparks ? `+${fmt(result.sparks)} ${sparksName}` : '', result.shards ? `+${result.shards} ${shardsName}` : '']
    .filter(Boolean)
    .join(' · ');
  const extras = result.parts.filter((p) => p.startsWith('listed ')).map((p) => p.replace('listed ', ''));
  toast(paid ? `${what} ${paid}${extras.length ? ` (${extras.join(', ')})` : ''}` : what, paid ? 'good' : 'info');
  for (const m of result.milestones) {
    toast(`Milestone · ${milestoneName(m)}: ${milestoneReward(m, sparksName)}${m.selector ? ' (in your Bag)' : ''}`, 'good');
  }
}

/** Runs a stage action and announces what it paid. */
async function stage(action: (s: AppState, now: Date) => ActionResult<StageResult>, what: string): Promise<boolean> {
  const result = report(await run(action));
  if (result === undefined) return false;
  play(result.sparks || result.shards ? 'complete' : 'undo');
  rewardToast(result, what);
  return true;
}

export function Salvage() {
  const state = useStore();
  const now = useNow();
  const [open, setOpen] = useState<Open | null>(null);
  const view = depotView(state, now);
  const close = () => setOpen(null);
  const item = open && 'id' in open ? state.saleItems.get(open.id) : undefined;
  const reset = deadlineAt(addDays(view.weekKey, 7), 4 * 60);

  return (
    <div class="page salvage">
      <a class="back" href="#/events">
        ‹ Events
      </a>
      <PageTitle eyebrow="// permanent event" title="Salvage Exchange" />
      <MissionPanel view={view} reset={reset} now={now} />
      <button class="btn primary wide" onClick={() => setOpen({ kind: 'add' })}>
        + Add item
      </button>

      <h3 class="section-label">Featured lots</h3>
      {state.saleItems.size === 0 ? (
        <Empty>Add the things you want to sell. The first two become featured lots straight away.</Empty>
      ) : (
        <div class="lots">
          {view.featured.map(({ slot, item }) => (
            <FeaturedLot key={slot.id} slot={slot} item={item} now={now} onOpen={setOpen} />
          ))}
          {Array.from({ length: view.openSlots }, (_, i) => (
            <div key={`open${i}`} class="panel lot open-slot">
              <span class="label">Open slot</span>
              <p class="hint small">Fills at the reset, Monday 4 AM.</p>
            </div>
          ))}
        </div>
      )}
      {view.upNext.length > 0 && (
        <p class="up-next mono">
          <span class="label">Up next</span> {view.upNext.map((i) => i.name).join(' · ')}
        </p>
      )}
      {view.nextInLine && (
        <p class="up-next mono muted">
          <span class="label">Next in line</span> {view.nextInLine.name}
        </p>
      )}

      {view.onMarket.length > 0 && (
        <>
          <h3 class="section-label">On the market · {view.onMarket.length}</h3>
          <ul class="items">
            {view.onMarket.map((i) => (
              <ItemRow key={i.id} item={i} onOpen={setOpen} />
            ))}
          </ul>
        </>
      )}

      {view.catalog.length > 0 && (
        <>
          <h3 class="section-label">Catalog · {view.catalog.length}</h3>
          <ul class="items">
            {view.catalog.map((i) => (
              <ItemRow key={i.id} item={i} onOpen={setOpen} />
            ))}
          </ul>
        </>
      )}

      {view.cleared.length > 0 && (
        <details class="cleared">
          <summary class="section-label">Cleared · {view.cleared.length}</summary>
          <ul class="items">
            {view.cleared.map((i) => (
              <ItemRow key={i.id} item={i} onOpen={setOpen} />
            ))}
          </ul>
        </details>
      )}

      <Milestones />
      <Money />

      {open?.kind === 'add' && <ItemForm categories={view.categories} onClose={close} />}
      {item && open?.kind === 'edit' && <ItemForm item={item} categories={view.categories} onClose={() => setOpen({ kind: 'item', id: item.id })} />}
      {item && open?.kind === 'item' && <ItemSheet item={item} now={now} onOpen={setOpen} onClose={close} />}
      {item && (open?.kind === 'list' || open?.kind === 'platforms') && (
        <ListSheet item={item} editing={open.kind === 'platforms'} now={now} onClose={close} />
      )}
      {item && open?.kind === 'sold' && <SoldSheet item={item} onClose={close} />}
    </div>
  );
}

function timeUntil(target: Date, now: Date): string {
  const mins = Math.max(0, Math.round((target.getTime() - now.getTime()) / 60_000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${String(mins % 60).padStart(2, '0')}m`;
}

function MissionPanel({ view, reset, now }: { view: ReturnType<typeof depotView>; reset: Date; now: Date }) {
  const state = useStore();
  const skipped = isSkippedWeek(state, view.weekKey, now);
  const { mission } = skipped ? { mission: { ...view.mission, total: 0, listed: 0, completed: false } } : view;
  return (
    <section class={`panel mission ${mission.completed ? 'done' : ''}`}>
      <div class="mission-head">
        <div>
          <span class="label">Weekly mission</span>
          <b>
            {skipped
              ? 'No mission this week (hibernation)'
              : mission.total === 0
                ? 'No featured lots this week'
                : `List this week’s featured ${mission.total === 1 ? 'lot' : 'lots'}`}
          </b>
        </div>
        {mission.total > 0 && (
          <b class={`mono mission-count ${mission.completed ? 'ok' : ''}`}>
            {mission.completed ? '✓' : `${mission.listed}/${mission.total}`}
          </b>
        )}
      </div>
      <small class="mono muted">
        {mission.completed ? 'Complete · paid at the reset' : 'Reward'} <Amount value={DEPOT.mission.sparks} currency="sparks" signed />{' '}
        <Amount value={DEPOT.mission.shards} currency="shards" signed /> · resets in {timeUntil(reset, now)}
      </small>
    </section>
  );
}

function StageTrack({ item }: { item: SaleItem }) {
  const current = STAGES.indexOf(stageOf(item));
  return (
    <div class="stage-track" aria-label={`Stage: ${STAGE_LABELS[stageOf(item)]}`}>
      {STAGES.map((s, i) => (
        <i key={s} class={i <= current ? 'on' : ''} title={STAGE_LABELS[s]} />
      ))}
      <span class="mono">
        {STAGE_LABELS[stageOf(item)]}
        {item.takenDownAt && !item.listedAt && !item.soldAt ? ' · taken down' : ''}
      </span>
    </div>
  );
}

function FeaturedLot({ slot, item, now, onOpen }: { slot: FeaturedSlot; item: SaleItem; now: Date; onOpen: (o: Open) => void }) {
  const state = useStore();
  const age = ageTag(state, slot, now);
  return (
    <section class="panel lot">
      <div class="lot-head">
        <span class="label">Slot {String(slot.slot + 1).padStart(2, '0')}</span>
        <span class={`age age-${age.level}`}>{age.label}</span>
      </div>
      <button class="lot-name" onClick={() => onOpen({ kind: 'item', id: item.id })}>
        {item.name}
        {item.notes && <small class="muted">{item.notes}</small>}
      </button>
      <StageTrack item={item} />
      <StageActions item={item} now={now} onOpen={onOpen} />
      <CopyPrompt item={item} />
    </section>
  );
}

function ItemRow({ item, onOpen }: { item: SaleItem; onOpen: (o: Open) => void }) {
  const stageNow = stageOf(item);
  const detail =
    stageNow === 'listed'
      ? item.platforms.join(' · ')
      : stageNow === 'sold'
        ? `Sold $${dollars(item.sale!.price)} · waiting to hand off`
        : stageNow === 'handedOff'
          ? `Sold $${dollars(item.sale!.price)} on ${item.sale!.platform}`
          : item.takenDownAt
            ? 'Taken down'
            : STAGE_LABELS[stageNow];
  return (
    <li>
      <button class={`panel item-row sale-row stage-${stageNow}`} onClick={() => onOpen({ kind: 'item', id: item.id })}>
        <span class="grow">
          <span class="item-name">{item.name}</span>
          <small class="muted mono">
            {item.category ? `${item.category} · ` : ''}
            {detail}
          </small>
        </span>
        <span aria-hidden="true">›</span>
      </button>
    </li>
  );
}

/** The next things you can do with an item, with what each pays. */
function StageActions({ item, now, onOpen }: { item: SaleItem; now: Date; onOpen: (o: Open) => void }) {
  const state = useStore();
  const stageNow = stageOf(item);
  const undo = undoableStep(item, now);
  const listPay = listingReward(state, item, now);
  const buttons = [];

  if (stageNow === 'cataloged') {
    buttons.push(
      <button key="photo" class="btn" onClick={() => stage((s, at) => markPhotographed(s, item.id, at), 'Photographed!')}>
        Photographed <small class="mono">+{fmt(DEPOT.photographed.sparks)}</small>
      </button>,
    );
  }
  if (stageNow === 'cataloged' || stageNow === 'photographed') {
    buttons.push(
      <button key="list" class="btn primary" onClick={() => onOpen({ kind: 'list', id: item.id })}>
        {item.firstListedAt ? 'Relist' : 'Listed'} {listPay.sparks > 0 && <small class="mono">+{fmt(listPay.sparks)}</small>}
      </button>,
    );
  }
  if (stageNow === 'listed') {
    buttons.push(
      <button key="sold" class="btn primary" onClick={() => onOpen({ kind: 'sold', id: item.id })}>
        Sold
      </button>,
    );
  }
  if (stageNow === 'sold') {
    buttons.push(
      <button key="handoff" class="btn primary" onClick={() => stage((s, at) => markHandedOff(s, item.id, at), 'Handed off!')}>
        Handed off {!item.paid.handedOff && <small class="mono">+{fmt(DEPOT.handedOff.sparks)}</small>}
      </button>,
    );
  }

  return (
    <div class="stage-actions">
      {buttons.length > 0 &&
        (isHibernating(state, now) ? (
          <p class="paused-note">Hibernating: stage changes wait until you wake up, so no rewards are lost.</p>
        ) : (
          <div class="row gap">{buttons}</div>
        ))}
      {undo && (
        <button
          class="mini"
          onClick={async () => {
            if (succeeded(await run((s, at) => undoStep(s, item.id, at)))) {
              play('undo');
              toast(`Undone: ${stepLabel(undo)}`);
            }
          }}
        >
          Undo: {stepLabel(undo)}
        </button>
      )}
    </div>
  );
}

function CopyPrompt({ item }: { item: SaleItem }) {
  const copy = async () => {
    const text = listingPrompt(item);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Older browsers: copy through a temporary text box.
      const box = document.createElement('textarea');
      box.value = text;
      box.setAttribute('readonly', '');
      box.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      document.body.appendChild(box);
      box.select();
      const ok = document.execCommand('copy');
      box.remove();
      if (!ok) return toast('Couldn’t copy. Long-press to copy it from the item instead.', 'error');
    }
    toast('Listing prompt copied. Paste it into an AI chat with your photos.', 'good');
  };
  return (
    <button type="button" class="btn ghost wide copy-prompt" onClick={copy}>
      Copy listing prompt
    </button>
  );
}

function dollars(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
}

function ItemSheet({ item, now, onOpen, onClose }: { item: SaleItem; now: Date; onOpen: (o: Open) => void; onClose: () => void }) {
  const state = useStore();
  const stageNow = stageOf(item);
  const slot = activeSlotOf(state, item.id);
  const dated = (label: string, iso: string | null) =>
    iso && (
      <li>
        <span class="muted">{label}</span> {new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
      </li>
    );
  return (
    <Sheet title={item.name} onClose={onClose}>
      <div class="form item-sheet">
        {slot && <p class="mono featured-note">★ Featured lot · {ageTag(state, slot, now).label}</p>}
        {item.notes && <p class="item-notes">{item.notes}</p>}
        <StageTrack item={item} />
        <ul class="stage-dates mono">
          {dated('Added', item.createdAt)}
          {dated('Photographed', item.photographedAt)}
          {dated('First listed', item.firstListedAt)}
          {dated('Taken down', !item.listedAt ? item.takenDownAt : null)}
          {dated('Sold', item.soldAt)}
          {dated('Handed off', item.handedOffAt)}
        </ul>
        {item.listedAt && <p class="mono small">On: {item.platforms.join(' · ')}</p>}
        {item.sale && (
          <p class="mono small">
            Sold for ${dollars(item.sale.price)} on {item.sale.platform}
            {item.sale.fees ? ` · fees $${dollars(item.sale.fees)}` : ''}
          </p>
        )}
        <StageActions item={item} now={now} onOpen={onOpen} />
        {!item.soldAt && <CopyPrompt item={item} />}
        <div class="row gap wrap">
          {stageNow === 'listed' && (
            <>
              <button type="button" class="btn ghost" onClick={() => onOpen({ kind: 'platforms', id: item.id })}>
                Platforms
              </button>
              <button
                type="button"
                class="btn ghost"
                onClick={async () => {
                  const ok = await confirmDialog({
                    title: `Take "${item.name}" down?`,
                    body: 'It goes back to unlisted. Relisting it later pays nothing, since listing rewards are paid once per item.',
                    confirmLabel: 'Take down',
                  });
                  if (ok) await stage((s, at) => takeDown(s, item.id, at), 'Taken down');
                }}
              >
                Take down
              </button>
            </>
          )}
          {(stageNow === 'cataloged' || stageNow === 'photographed') && (
            <button type="button" class="btn ghost" onClick={() => onOpen({ kind: 'sold', id: item.id })}>
              Mark sold
            </button>
          )}
          {stageNow === 'sold' && (
            <button
              type="button"
              class="btn ghost"
              onClick={async () => {
                const ok = await confirmDialog({
                  title: 'Sale fell through?',
                  body: 'It goes back on the market on the same platforms. The sale record is cleared.',
                  confirmLabel: 'Back on the market',
                });
                if (ok) await stage((s, at) => saleFellThrough(s, item.id, at), 'Back on the market');
              }}
            >
              Sale fell through
            </button>
          )}
          <button type="button" class="btn ghost" onClick={() => onOpen({ kind: 'edit', id: item.id })}>
            Edit
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function ItemForm({ item, categories, onClose }: { item?: SaleItem; categories: string[]; onClose: () => void }) {
  const [name, setName] = useState(item?.name ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [category, setCategory] = useState(item?.category ?? '');
  const [saving, save] = useSaving(async (e: Event) => {
    e.preventDefault();
    if (!succeeded(await run((s, now) => saveSaleItem(s, { id: item?.id, name, notes, category }, now)))) return;
    if (!item) toast(`Added: ${name.trim()}`, 'good');
    onClose();
  });
  const remove = async () => {
    const ok = await confirmDialog({
      title: `Delete "${item!.name}"?`,
      body: 'For items added by mistake or sold outside the app. It pays nothing and doesn’t count as cleared; rewards already earned are kept. A featured lot’s slot stays open until the reset.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok && succeeded(await run((s, now) => deleteSaleItem(s, item!.id, now)))) {
      toast(`Deleted: ${item!.name}`);
      onClose();
    }
  };
  return (
    <Sheet title={item ? 'Edit item' : 'New item'} onClose={onClose}>
      <form class="form" onSubmit={save}>
        <label>
          <span>Name</span>
          <input value={name} maxLength={80} required placeholder="e.g. Nintendo Switch dock" onInput={(e) => setName(e.currentTarget.value)} />
        </label>
        <label>
          <span>Notes (optional)</span>
          <textarea
            rows={3}
            maxLength={500}
            value={notes}
            placeholder="Condition, details, asking price ideas"
            onInput={(e) => setNotes(e.currentTarget.value)}
          />
        </label>
        <label>
          <span>Category (optional)</span>
          <input value={category} maxLength={40} list="sale-categories" onInput={(e) => setCategory(e.currentTarget.value)} />
          <datalist id="sale-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <button class="btn primary wide" type="submit" disabled={saving}>
          {saving ? 'Saving…' : item ? 'Save' : 'Add item'}
        </button>
        {item && (
          <button type="button" class="btn danger-ghost wide" onClick={remove}>
            Delete item
          </button>
        )}
      </form>
    </Sheet>
  );
}

function PlatformPicker({ chosen, onToggle }: { chosen: string[]; onToggle: (p: string) => void }) {
  const state = useStore();
  const [adding, setAdding] = useState('');
  const add = async () => {
    const result = report(await run((s) => addPlatform(s, adding)));
    if (result === undefined) return;
    if (!chosen.includes(result.name)) onToggle(result.name);
    setAdding('');
  };
  return (
    <fieldset>
      <legend>Platforms</legend>
      <div class="platform-toggles">
        {platforms(state).map((p) => (
          <button type="button" key={p} class={chosen.includes(p) ? 'on' : ''} aria-pressed={chosen.includes(p)} onClick={() => onToggle(p)}>
            {p}
          </button>
        ))}
      </div>
      <div class="row gap add-platform">
        <input value={adding} maxLength={40} placeholder="Add a platform" onInput={(e) => setAdding(e.currentTarget.value)} />
        <button type="button" class="btn ghost" disabled={!adding.trim()} onClick={add}>
          Add
        </button>
      </div>
    </fieldset>
  );
}

function ListSheet({ item, editing, now, onClose }: { item: SaleItem; editing: boolean; now: Date; onClose: () => void }) {
  const state = useStore();
  const [chosen, setChosen] = useState<string[]>(item.platforms);
  const toggle = (p: string) => setChosen((c) => (c.includes(p) ? c.filter((x) => x !== p) : [...c, p]));
  const pay = listingReward(state, item, now);
  const [saving, save] = useSaving(async (e: Event) => {
    e.preventDefault();
    const ok = editing
      ? succeeded(await run((s, at) => setPlatforms(s, item.id, chosen, at)))
      : await stage((s, at) => listItem(s, item.id, chosen, at), 'Listed!');
    if (ok) onClose();
  });
  return (
    <Sheet title={editing ? 'Platforms' : `List: ${item.name}`} onClose={onClose}>
      <form class="form" onSubmit={save}>
        <PlatformPicker chosen={chosen} onToggle={toggle} />
        {!editing && (
          <p class="hint">
            {pay.sparks > 0 ? (
              <>
                Pays <Amount value={pay.sparks} currency="sparks" signed />:{' '}
                {pay.parts.map((p) => REWARD_PARTS[p] ?? p).join(' + ')}.
              </>
            ) : (
              'Already listed once, so relisting pays nothing.'
            )}
            {!item.photographedAt && ' Marks it photographed too.'}
          </p>
        )}
        <button class="btn primary wide" type="submit" disabled={saving || chosen.length === 0}>
          {editing ? 'Save platforms' : 'Mark listed'}
        </button>
      </form>
    </Sheet>
  );
}

const REWARD_PARTS: Record<string, string> = {
  photographed: `${DEPOT.photographed.sparks} photo`,
  listed: `${DEPOT.listed.sparks} listing`,
  featured: `${DEPOT.featuredBonus.sparks} featured`,
  fresh: `${DEPOT.freshBonus.sparks} fresh`,
};

function SoldSheet({ item, onClose }: { item: SaleItem; onClose: () => void }) {
  const state = useStore();
  const all = platforms(state);
  const [price, setPrice] = useState('');
  const [fees, setFees] = useState('');
  const [platform, setPlatform] = useState(item.platforms[0] ?? '');
  const [saving, save] = useSaving(async (e: Event) => {
    e.preventDefault();
    if (await stage((s, at) => markSold(s, item.id, { price, platform, fees }, at), 'Sold!')) onClose();
  });
  // The platforms it's listed on come first.
  const options = [...item.platforms, ...all.filter((p) => !item.platforms.includes(p))];
  return (
    <Sheet title={`Sold: ${item.name}`} onClose={onClose}>
      <form class="form" onSubmit={save}>
        <div class="row gap">
          <label class="grow">
            <span>Sale price ($)</span>
            <input inputMode="decimal" value={price} required placeholder="0.00" onInput={(e) => setPrice(e.currentTarget.value)} />
          </label>
          <label class="grow">
            <span>Fees ($, optional)</span>
            <input inputMode="decimal" value={fees} placeholder="0.00" onInput={(e) => setFees(e.currentTarget.value)} />
          </label>
        </div>
        <label>
          <span>Sold on</span>
          <select value={platform} required onChange={(e) => setPlatform(e.currentTarget.value)}>
            <option value="" disabled>
              Pick a platform
            </option>
            {options.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <p class="hint">
          The hand-off pays <Amount value={DEPOT.handedOff.sparks} currency="sparks" signed />{' '}
          <Amount value={DEPOT.handedOff.shards} currency="shards" signed /> once it’s shipped, picked up or delivered.
          {!item.listedAt && ' Marking it sold also marks it listed.'}
        </p>
        <button class="btn primary wide" type="submit" disabled={saving}>
          Mark sold
        </button>
      </form>
    </Sheet>
  );
}

function MilestoneTrack({ kind, count }: { kind: MilestoneKind; count: number }) {
  const { sparksName } = names();
  const next = nextMilestone(kind, count);
  const reached = milestonesThrough(kind, count);
  const prev = reached[reached.length - 1]?.count ?? 0;
  const pct = next ? Math.round(((count - prev) / (next.count - prev)) * 100) : 100;
  const label = kind === 'listed' ? 'Items listed' : 'Items sold';
  return (
    <div class="milestone-track">
      <div class="row between">
        <span class="label">{label}</span>
        <b class="mono">{count}</b>
      </div>
      <div class="meter" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${label}: ${count}`}>
        <i style={{ width: `${pct}%` }} />
      </div>
      <small class="mono muted">
        {next ? `Next: ${milestoneName(next)} · ${milestoneReward(next, sparksName)} · ${next.count - count} to go` : 'Every listing milestone reached'}
      </small>
    </div>
  );
}

function Milestones() {
  const state = useStore();
  const { sparksName } = names();
  const d = depot(state);
  if (!d) return null;
  const claimed = new Set(d.milestones ?? []);
  const reached: Milestone[] = [...milestonesThrough('listed', d.listedCount), ...milestonesThrough('sold', d.handedOffCount)].filter((m) =>
    claimed.has(m.id),
  );
  return (
    <section class="panel milestones">
      <h3 class="section-label">Milestones</h3>
      <MilestoneTrack kind="listed" count={d.listedCount} />
      <MilestoneTrack kind="sold" count={d.handedOffCount} />
      <p class="hint small">A sale counts once the item is handed off. Deleting an item never sets these back.</p>
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

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function Money() {
  const state = useStore();
  const money = moneyRecord(state);
  if (money.total.count === 0) return null;
  const table = (lines: typeof money.byPlatform, label: (k: string) => string) => (
    <table class="money-table mono">
      <thead>
        <tr>
          <th />
          <th>Sold</th>
          <th>Net</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.key}>
            <td>{label(l.key)}</td>
            <td>{l.count}</td>
            <td>${dollars(l.net)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <section class="panel money">
      <h3 class="section-label">Money record</h3>
      <div class="rank-stats">
        <div>
          <span class="label">Gross</span>
          <b class="mono">${dollars(money.total.gross)}</b>
        </div>
        <div>
          <span class="label">Fees</span>
          <b class="mono">${dollars(money.total.fees)}</b>
        </div>
        <div>
          <span class="label">Net</span>
          <b class="mono ok">${dollars(money.total.net)}</b>
        </div>
      </div>
      <p class="mono small muted">
        {money.total.count} {money.total.count === 1 ? 'sale' : 'sales'}
        {money.avgDaysToSell !== null &&
          ` · ${money.avgDaysToSell < 1 ? 'under a day' : `${money.avgDaysToSell.toFixed(1)} days`} from listing to sale on average`}
      </p>
      <details>
        <summary class="section-label">By platform</summary>
        {table(money.byPlatform, (k) => k)}
      </details>
      <details>
        <summary class="section-label">By month</summary>
        {table(money.byMonth, monthLabel)}
      </details>
      <p class="hint small">For your records only; it never affects rewards.</p>
    </section>
  );
}
