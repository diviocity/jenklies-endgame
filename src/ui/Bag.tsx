import { useState } from 'preact/hooks';
import { SHARDS } from '../config';
import { activeIndulgences, balances, buy, inventory, redeem } from '../logic/actions';
import { sortByOrder } from '../logic/state';
import { play } from '../sound';
import { run, useStore } from '../store';
import type { Indulgence } from '../types';
import { Redemptions } from './History';
import { Amount, confirmDialog, Empty, names, PageTitle, report, Segmented, Stars, toast } from './common';

type View = 'inventory' | 'shop' | 'log';

export function Bag() {
  const [view, setView] = useState<View>('inventory');
  return (
    <div class="page">
      <PageTitle eyebrow="// storage" title="Bag" />
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: 'inventory', label: 'Inventory' },
          { value: 'shop', label: 'Shop' },
          { value: 'log', label: 'Redeemed' },
        ]}
      />
      {view === 'inventory' && <Inventory />}
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
    if (report(await run((s, now) => redeem(s, item.id, now))) !== undefined) toast(`Redeemed: ${item.name}`, 'good');
  };

  if (held.length === 0) return <Empty>Nothing in storage yet. Win indulgences from pulls or buy them in the shop.</Empty>;
  return (
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
    if (report(await run((s, now) => buy(s, item.id, now))) !== undefined) toast(`Bought: ${item.name}`, 'good');
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
