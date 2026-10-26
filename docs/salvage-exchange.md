# Salvage Exchange (selling event)

A permanent event on the Events tab that gets my backlog of things to sell out of the house. Listing is the step I put off most, so the event keeps my attention on two items at a time and pays the most for listing. It never nags, never blocks anything and has no "skip" button.

It works with any platform: eBay, Facebook Marketplace, Facebook groups, Discord selling servers, or anything I add.

**Status:** Phase 1 is built: the catalog, stages, platforms, featured lots, per-item rewards, the weekly mission and the listing prompt. Phase 2 adds lifetime milestones (selectors, titles and the Market theme) and the money record.

Every number lives in `src/config.ts` (`DEPOT`). The rules are in `src/logic/depot.ts` and the screen is `src/ui/Salvage.tsx`.

## Items and stages

- **Adding:** "+ Add item" takes a name, optional notes (condition, details, price ideas) and an optional category. Any item can be worked on at any time; featuring never locks anything.
- **Stages:** Cataloged → Photographed → Listed → Sold → Handed off (shipped, picked up or delivered).
- **Later stages complete earlier ones:** listing an item that was never marked photographed marks it photographed too, and marking an unlisted item sold lists it on the platform it sold on. The rewards for the skipped stages are paid as well.
- **Undo:** the latest stage change can be undone the same day (4 AM days), and whatever it paid is taken back. As on Today, undo is blocked if those Sparks or Shards have already been spent.
- **Platforms:** a listing records every platform it's on. The four defaults can be joined by my own, added from the listing sheet. "Platforms" on a listed item changes them without paying anything.
- **Taken down:** an item can come off the market without selling. It goes back to unlisted. Relisting it pays nothing, and it's never featured again, since it has already been listed once.
- **Sold:** records the price, the platform it sold on and optional fees, in US dollars. If the buyer backs out before the hand-off, "Sale fell through" puts it back on the market on the same platforms.
- **Delete:** in the item's Edit sheet, for items added by mistake or sold outside the app. It pays nothing and doesn't count as cleared; rewards already earned are kept. If it was a featured lot, the slot stays open until the reset.
- **Copy listing prompt:** copies a ready-to-paste prompt with the item's name, category and notes. It asks an AI assistant for a title, a description, condition notes and a price range, based on photos I attach in that chat. The app doesn't store photos.

## Featured lots

- **Two slots.** Featured lots are the items I'm nudged to list next.
- **Filling:** open slots are filled at the weekly reset (Monday 4 AM). The pick order is:
  1. photographed but never listed, oldest photo first;
  2. then cataloged, oldest first.
- **First use:** a slot that has never held a lot fills as soon as an item exists, so the first two items I add are featured straight away.
- **Leaving a slot:** only by being listed (or deleted). The slot then stays open until the reset; "Up next" shows what will fill it.
- **Carry-over:** a lot that's still unlisted at the reset stays featured, however many weeks it takes. There's no skip and no "what's blocking you?".
- **Age tags,** by whole weeks in the slot: **New** (green), **1 week** (yellow), **2 weeks** (orange), **3+ weeks** (red).
- **Other items** can be listed at any time for their base rewards, and they leave the queue.

## Rewards

Each is paid once per item, ever, and logged in the currency ledger.

| Step | Reward |
|---|---|
| Cataloged | nothing |
| Photographed | 100 Sparks |
| Listed | 500 Sparks |
| + it was a featured lot when listed | +250 Sparks |
| + listed within 3 days of being photographed | +250 Sparks |
| Handed off | 500 Sparks + 2 Shards |

- **Fresh window:** counted in calendar days on the app's 4 AM days. Photographed on Monday, listed by the end of Thursday (before 4 AM Friday) counts. Marking both at the same time counts too.
- **The listing button** shows what listing would pay right now, and the listing sheet breaks it down.

### Weekly mission

- **List every featured lot of the week before the reset:** 500 Sparks + 5 Shards, paid at the reset.
- The lots that count are every lot that was featured at any point that week, deleted ones excepted. With one slot filled, listing that one completes it. With no featured lots there's no mission.
- The result appears in the weekly report on the first open after the reset.

**Pace:** listing both featured lots fresh, photographing two items and handing off two sales comes to about 3,700 Sparks and 9 Shards a week (7–8 pulls). It tapers off as the backlog clears.

## Data

- **Data version 4** (database version 3) adds four stores:
  - `saleItems`: each item with its stage timestamps, platforms, sale record, which rewards it has paid, and today's stage changes (for undo);
  - `featuredSlots`: one record per stint in a slot (item, slot, start, end, and whether it left by being listed or deleted). This is the slot history;
  - `depotWeeks`: one record per closed week with its mission result and reward;
  - `depot`: the event state (current week, my own platforms, and lifetime listed and handed-off counts, which deleting never lowers).
- **Upgrading:** existing data needs no changes; the new stores start empty. Older backups import with them empty.
- **Export/import** includes all Salvage Exchange data.
