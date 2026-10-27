import { useState } from 'preact/hooks';
import { SHARDS } from '../config';
import { activeIndulgences, balances, buy, inventory, redeem } from '../logic/actions';
import { sortByOrder } from '../logic/state';
import { play } from '../sound';
import { run, useStore } from '../store';
import { useSelector } from '../logic/expedition';
import type { Indulgence, Selector } from '../types';
import { AffirmationCollection } from './Collection';
import { Redemptions } from './History';
import { Amount, confirmDialog, Empty, names, PageTitle, report, Segmented, Sheet, Stars, succeeded, toast } from './common';

export type BagView = View;
type View = 'inventory' | 'affirmations' | 'shop' | 'log';

export function Bag({ view: initial = 'inventory' }: { view?: View }) {
  const [view, setView] = useState<View>(initial);
  return (
    <div class="page wide bag">
      <PageTitle eyebrow="// storage" title="Bag" />
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: 'inventory', label: 'Indulgences' },
          { value: 'affirmations', label: 'Affirmations' },
          { value: 'shop', label: 'Shop' },
          { value: 'log', label: 'Redeemed' },
        ]}
      />
      {view === 'inventory' && <Inventory />}
      {view === 'affirmations' && <AffirmationCollection />}
      {view === 'shop' && <Shop />}
      {view === 'log' && <Redemptions />}
    </div>
  );
}

function ItemHead({ item }: { item: Indulgence }) {
  return (
    <div class="item-head">
      <span class={`item-emoji r${item.rarity}`}>{item.emoji || '◆'}</span>
      <span>
        <span class="item-name">{item.name}</span>
        <Stars rarity={item.rarity} />
        {!item.active && <em class="tag">RETIRED</em>}
      </span>
    </div>
  );
}

function Inventory() {
  const state = useStore();
  const counts = inventory(state);
  const held = sortByOrder([...state.indulgences.values()].filter((i) => (counts.get(i.id) ?? 0) > 0)).sort(
    (a, b) => b.rarity - a.rarity,
  );

  const doRedeem = async (item: Indulgence) => {
    const ok = await confirmDialog({
      title: `Redeem ${item.name}?`,
      body: 'This uses one up and logs it. Enjoy it.',
      confirmLabel: 'Redeem',
    });
    if (!ok) return;
    play('buy');
    if (succeeded(await run((s, now) => redeem(s, item.id, now)))) toast(`Redeemed: ${item.name}`, 'good');
  };

  const selectors = [...state.selectors.values()].filter((sel) => !sel.usedAt);
  if (held.length === 0 && selectors.length === 0) {
    return <Empty>Nothing in storage yet. Win indulgences from pulls or buy them in the shop.</Empty>;
  }
  return (
    <>
      {selectors.length > 0 && <Selectors selectors={selectors} />}
    <ul class="items">
      {held.map((item) => (
        <li key={item.id} class={`item panel r${item.rarity}`}>
          <ItemHead item={item} />
          {item.note && <p class="item-note">{item.note}</p>}
          <div class="row between">
            <b class="mono count">×{counts.get(item.id)}</b>
            <button class="btn primary" onClick={() => doRedeem(item)}>
              Redeem
            </button>
          </div>
        </li>
      ))}
    </ul>
    </>
  );
}

/** Unopened selectors from the expedition: each one turns into an indulgence of your choice. */
function Selectors({ selectors }: { selectors: Selector[] }) {
  const [open, setOpen] = useState<Selector | null>(null);
  return (
    <>
      <ul class="items">
        {selectors.map((sel) => (
          <li key={sel.id} class={`item panel selector r${sel.rarity}`}>
            <div class="item-head">
              <span class={`item-emoji r${sel.rarity}`}>✦</span>
              <span>
                <span class="item-name">{sel.rarity}★ Selector</span>
                <small class="muted">{sel.source} · choose any active {sel.rarity}★ indulgence</small>
              </span>
            </div>
            <button class="btn primary" onClick={() => setOpen(sel)}>
              Choose
            </button>
          </li>
        ))}
      </ul>
      {open && <SelectorSheet selector={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function SelectorSheet({ selector, onClose }: { selector: Selector; onClose: () => void }) {
  const state = useStore();
  const options = activeIndulgences(state, selector.rarity);
  const choose = async (item: Indulgence) => {
    const ok = await confirmDialog({
      title: `Take ${item.name}?`,
      body: `This uses your ${selector.rarity}★ selector. It goes into your Bag to redeem whenever you like.`,
      confirmLabel: 'Take it',
    });
    if (!ok) return;
    play('buy');
    const result = report(await run((s, now) => useSelector(s, selector.id, item.id, now)));
    if (result) {
      toast(`Added to your Bag: ${result.name}`, 'good');
      onClose();
    }
  };
  return (
    <Sheet title={`${selector.rarity}★ Selector`} onClose={onClose}>
      {options.length === 0 ? (
        <Empty>No active {selector.rarity}★ indulgences. Add or bring one back in More → Indulgences.</Empty>
      ) : (
        <ul class="items">
          {options.map((item) => (
            <li key={item.id}>
              <button class={`panel item-row r${item.rarity}`} onClick={() => choose(item)}>
                <span class={`item-emoji r${item.rarity}`}>{item.emoji || '◆'}</span>
                <span class="grow">
                  <span class="item-name">{item.name}</span>
                  {item.note && <small class="muted">{item.note}</small>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

function Shop() {
  const state = useStore();
  const { shards } = balances(state);
  const { shardsName } = names();
  const items = [...activeIndulgences(state, 5), ...activeIndulgences(state, 4)];

  const doBuy = async (item: Indulgence) => {
    const price = SHARDS.shopPrice[item.rarity];
    const ok = await confirmDialog({
      title: `Buy ${item.name}?`,
      body: `Costs ${price} ${shardsName}. Shop purchases don't give ${shardsName} or affect pity.`,
      confirmLabel: 'Buy',
    });
    if (!ok) return;
    play('buy');
    if (succeeded(await run((s, now) => buy(s, item.id, now)))) toast(`Bought: ${item.name}`, 'good');
  };

  return (
    <>
      <p class="hint">
        You have <Amount value={shards} currency="shards" />. 4★ costs {SHARDS.shopPrice[4]}, 5★ costs{' '}
        {SHARDS.shopPrice[5]}.
      </p>
      {items.length === 0 ? (
        <Empty>No active indulgences. Add some in More → Indulgences.</Empty>
      ) : (
        <ul class="items">
          {items.map((item) => {
            const price = SHARDS.shopPrice[item.rarity];
            return (
              <li key={item.id} class={`item panel r${item.rarity}`}>
                <ItemHead item={item} />
                <div class="row between">
                  <Amount value={price} currency="shards" />
                  <button class="btn" disabled={shards < price} onClick={() => doBuy(item)}>
                    Buy
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
