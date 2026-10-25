# Frontier Expedition (fitness event)

A permanent event on the Events tab that builds the habit of training consistently every week.

- **Rank (1–20)** measures recent consistency. It rises and falls.
- **The expedition map** measures total effort. Its progress is permanent.

**Status:** Phase 1 is built: navigation, fitness tagging and logging, rank math, the weekly reset and the rank panel. Phase 2 adds the map, rewards, selectors and the weekly report. Phase 3 is map polish.

Every number lives in `src/config.ts` (`FITNESS`, `RANK`). The rank math is in `src/logic/rank.ts`, and the event state and weekly reset are in `src/logic/event.ts`.

## Fitness points

| Type | Points | Notes |
|---|---|---|
| CrossFit | 100 | |
| Shoulder PT | 50 | |
| Other workout | 75 | logged by hand |
| Activity (dog walk, extra walk, …) | 10 | only the first 7 per week count |

- **Tagged tasks:** template tasks can have a fitness type (set in the template editor). Checking one off logs its points automatically, and undoing the task removes them. The starting template tags CrossFit, Shoulder PT and Dog walk.
- **Manual logs:** "Log activity" on the event screen records anything outside the schedule. Manual entries can be undone the same day.
- **Where they're recorded:** fitness points have their own log (History → Fitness), not the currency ledger.

## Rank

The week runs Monday 4:00 AM to Monday 4:00 AM. At each reset:

- `RP = RP × (1 − decay) + this week's points`
- `Rank = floor(20 × RP / RP_max)`, between 1 and 20
- `RP_max = 0.9 × (target week points ÷ 0.10)`
- **Target week:** set in Settings. The default is 3 CrossFit + 3 PT + 7 activities = 520 points, so RP_max is 4,680. Changing the target rescales your rank immediately, so Rank 20 always means "doing my full routine consistently".
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

## Expedition map (phase 2)

| Region | Minimum rank | Length (points) |
|---|---|---|
| 1. Outskirts | 1 | 1,500 |
| 2. Badlands | 5 | 1,600 |
| 3. Deep Frontier | 10 | 2,600 |
| 4. The Wall | 15 | 4,200 |
| 5. Endgame | 20 | 3,600 (possibly ~5,100, see below) |

- **Rank gates:** moving forward inside a region needs your current rank at or above its minimum.
- **Carry-over (decided):** points earned while a gate is closed are banked, and the map catches up once your rank meets the gate. Progress is never lost or undone. Simulated at target pace, regions finish around weeks 3, 6, 11, 20 and 26.
- **Endgame length (still open):** with carry-over, the Endgame takes about 4 weeks at Rank 20 rather than 7. Lengthening it to about 5,100 points would restore about 7 weeks. To be confirmed before phase 2.
- **Nodes:** spaced evenly within each region, about every 260 points (≈51 in all).
  - **Regular node:** 250 Sparks.
  - **Every 4th node across the map (Cache):** 1,000 Sparks + 5 Shards.
  - **End of regions 1–2:** a 4★ selector plus a title, replacing the node's Sparks.
  - **End of regions 3–4:** a 5★ selector plus a title, replacing the node's Sparks.
  - **End of the Endgame:** a 5★ selector, an exclusive UI theme and a completion record (date, peak rank, total sessions, weeks taken).
- **Selectors** go into the Bag until used.
- **Titles:** shown under the brand and on the Events screen, with a picker in Settings.
- **The theme:** a Settings switch once unlocked.

## Weekly rewards (phase 2)

At each reset, based on the week that ended:

| Week result | Reward |
|---|---|
| ≥ 50% of target points | 500 Sparks + 2 Shards |
| ≥ 100% of target points | 1,500 Sparks + 5 Shards (instead of the 50% reward) |
| Holding Rank 20 at reset | +5 Shards |

A short weekly report appears on the first open after a reset: points, rank change, rewards and map progress.

At target pace, map plus weekly rewards come to roughly 2,000–2,500 Sparks a week (4–5 pulls). That's on top of the base 46–80 pulls from tasks.

## Data

- **Data version 2** adds four stores:
  - `fitness`: the fitness log;
  - `events`: the event state (RP, rank, weak-week streak, peak rank, current week);
  - `eventWeeks`: one record per closed week, which is both the rank history and the weekly report;
  - `selectors`: for phase 2.
- **Fitness tags:** template and day tasks gain an optional `fitness` type.
- **Upgrading version-1 data:**
  - tags the CrossFit, Shoulder PT and Dog walk template tasks, and the same tasks in today's snapshot;
  - logs fitness for any of them already done today;
  - adds the default target week.
- **Old backups:** importing a version-1 backup runs the same upgrade.
- **Export/import** includes all event data.
