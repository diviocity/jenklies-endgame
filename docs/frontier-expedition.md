# Frontier Expedition (fitness event)

A permanent event on the Events tab that builds the habit of training consistently every week.

- **Rank (1–20)** measures recent consistency. It rises and falls.
- **The expedition map** measures total effort. Its progress is permanent.

**Status:** All three phases are built: navigation, fitness tagging and logging, rank and the weekly reset, the expedition map with gates and rewards, selectors, titles, weekly rewards, the weekly report, the drawn frontier map and the Endgame theme.

Every number lives in `src/config.ts` (`FITNESS`, `RANK`, `EXPEDITION`, `WEEKLY_REWARDS`). The rank math is in `src/logic/rank.ts`; the event state, weekly reset and weekly rewards are in `src/logic/event.ts`; and the map is in `src/logic/expedition.ts`.

## Fitness points

| Type | Points | Notes |
|---|---|---|
| Major activity (e.g. CrossFit) | 100 | |
| Other workout | 75 | |
| Moderate activity (e.g. shoulder PT) | 50 | |
| Minor activity (e.g. dog walk, extra walk) | 10 | only the first 7 per week count |

The types are named by effort rather than by a specific workout, so the routine can change without renaming anything. In the saved data they keep their original codes (`crossfit`, `workout`, `pt`, `activity`), so renaming them needed no data upgrade.

- **Tagged tasks:** template tasks can have a fitness type (set in the template editor). Checking one off logs its points automatically, and undoing the task removes them. The starting template tags CrossFit as Major, Shoulder PT as Moderate and Dog walk as Minor.
- **Manual logs:** "Log activity" on the event screen records anything outside the schedule. Manual entries can be undone the same day.
- **Where they're recorded:** fitness points have their own log (History → Fitness), not the currency ledger.

## Rank

The week runs Monday 4:00 AM to Monday 4:00 AM. At each reset:

- `RP = RP × (1 − decay) + this week's points`
- `Rank = floor(20 × RP / RP_max)`, between 1 and 20
- `RP_max = 0.9 × (target week points ÷ 0.10)`
- **Target week:** set in Settings. The default is 3 Major + 3 Moderate + 7 Minor = 520 points, so RP_max is 4,680. Changing the target rescales your rank immediately, so Rank 20 always means "doing my full routine consistently".
- **Decay:** 10% normally. A week is **weak** if its points are below RP × 10%. Consecutive weak weeks decay 10%, then 15%, then 25% from the third week on. One non-weak week resets decay to normal. There are no rank floors.
- **Missed weeks:** weeks you don't open the app are processed when you next open it, as zero-point weeks.

Checked by unit tests (`tests/rank.test.ts`):

- **Steady target weeks from zero:** ranks 2, 4, 6, 7, 9, 10… with Rank 20 at week 22.
- **Typical weeks settle at:**

  | Typical week | Settles at |
  |---|---|
  | 2 CrossFit + 3 PT + 7 walks | Rank 17 |
  | 1 CrossFit + 1 PT + 7 walks | Rank 9 |
  | Walks only | Rank 2 |

- **From Rank 20 with zero activity:** 19, 16, 12, 9, 6 with RP around 5,000, after months at target pace. Just after first reaching Rank 20 (RP about 4,690), the drop is 18, 15, 11, 8, 6.

**The rank panel** shows:
- your rank, and your projected rank at the next reset;
- a progress bar: amber while this week's points don't yet hold your rank, then toward the next rank;
- this week's points;
- the extra points needed this week to hold your rank and to reach the next one;
- the last few weeks' ranks.

## Expedition map

| Region | Minimum rank | Length (points) |
|---|---|---|
| 1. Outskirts | 1 | 1,500 |
| 2. Badlands | 5 | 1,600 |
| 3. Deep Frontier | 10 | 2,600 |
| 4. The Wall | 15 | 4,200 |
| 5. Endgame | 20 | 3,600 |

- **Rank gates:** moving forward inside a region needs your current rank at or above its minimum.
- **Carry-over:** points earned while a gate is closed are banked, and the map catches up once your rank meets the gate. The map only moves forward, so a rank drop, or undoing a session after the map moved, never takes anything back, and points that return after an undo don't pay twice.
- **Pace:** at target pace, regions finish at weeks 3, 6, 11, 20 and 26 (checked by a test that runs the real code for 30 weeks). The Endgame takes about 4 weeks at Rank 20, which was decided as fine.
- **Live movement:** the map moves as you log sessions, and the app announces each node you reach.
- **The drawing:** one tall map you scroll inside a window, opening at your position. The route climbs from the Outskirts at the bottom to a beacon at the top of the Endgame. The stretch you've covered glows; the rest is dashed. Each region has its own original, procedurally placed terrain:
  - Outskirts: hills and outposts;
  - Badlands: mesas and cracks;
  - Deep Frontier: pine ridges;
  - The Wall: cliff strata;
  - Endgame: crystal spires.

  A pulsing marker shows where you are, and the next locked rank gate is a hazard-striped barrier across the route. Tap any node for its reward and distance.
- **Nodes:** spaced evenly within each region, about every 260 points (52 in all, 11 of them Caches).
  - **Regular node:** 250 Sparks.
  - **Every 4th node across the map (Cache):** 1,000 Sparks + 5 Shards.
  - **End of regions 1–2:** a 4★ selector plus a title, replacing the node's Sparks.
  - **End of regions 3–4:** a 5★ selector plus a title, replacing the node's Sparks.
  - **End of the Endgame:** a 5★ selector, an exclusive UI theme and a completion record (date, peak rank, total sessions, weeks taken).
- **Selectors** go into the Bag (top of Indulgences) until used. Choosing one adds that indulgence to your inventory.
- **Titles:** a newly earned title is shown straight away, under the brand and on the event screen. You can change or hide it in Settings.
- **The Endgame theme:** picked in Settings once unlocked (alongside the Salvage Exchange's Market theme). It's midnight blue and gold, with a gold glow across the app, gold-edged panels and a gold brand mark.

## Hibernation

Weeks with 4 or more hibernated days are skipped at the reset (no RP update, no decay, no weekly reward, the weak-week streak unchanged). Weeks with 1–3 are prorated by active days ÷ 7: the decay, the weak threshold, the weekly reward thresholds and the rank panel's target. Logging is off while hibernating, and the map waits until you wake. See [hibernation.md](hibernation.md).

## Weekly rewards

At each reset, based on the week that ended:

| Week result | Reward |
|---|---|
| ≥ 50% of target points | 500 Sparks + 2 Shards |
| ≥ 100% of target points | 1,500 Sparks + 5 Shards (instead of the 50% reward) |
| Holding Rank 20 at reset | +5 Shards |

A short weekly report appears on the first open after a reset: points, rank change, rewards and map progress. After a long break, earlier weeks are summed up in one line. Weeks that closed under phase 1 had their weekly reward paid by the version 3 upgrade.

At target pace, map plus weekly rewards come to roughly 2,000–2,500 Sparks a week (4–5 pulls), checked by a test. That's on top of the base 46–80 pulls from tasks.

## Data

- **Data version 2** adds four stores:
  - `fitness`: the fitness log;
  - `events`: the event state (RP, rank, weak-week streak, peak rank, current week);
  - `eventWeeks`: one record per closed week, which is both the rank history and the weekly report;
  - `selectors`: 4★/5★ selectors, unopened or used.
- **Fitness tags:** template and day tasks gain an optional `fitness` type.
- **Upgrading version-1 data:**
  - tags the CrossFit, Shoulder PT and Dog walk template tasks, and the same tasks in today's snapshot;
  - logs fitness for any of them already done today;
  - adds the default target week.
- **Data version 3** adds map progress, titles, themes and the completion record to the event state, and each closed week's rewards and map position. The upgrade pays weekly rewards for weeks closed before version 3, and the map catches up on the next open.
- **Old backups:** importing an older backup runs the same upgrades.
- **Export/import** includes all event data.
