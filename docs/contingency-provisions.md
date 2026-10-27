# Contingency Provisions (diet event)

A permanent event on the Events tab that tracks whether I'm eating right **consistently**, with no meal logging or calorie counting. It's built around the two keystone habits my diet depends on, **grocery shopping and Sunday meal prep**. Input stays at one tap per meal, on meal tasks I already check off.

**Status:** Built. Phase 1 added meal and prep tags, ratings, the supply line, stamps, cards, the ration report and hibernation; phase 2 added lifetime milestones (selectors, titles and the Field Kitchen theme) and the stats.

Every number lives in `src/config.ts` (`PROVISIONS`). The rules are in `src/logic/provisions.ts` and the screen is `src/ui/Provisions.tsx`.

## Meals and stamps

- **Meal tasks:** template tasks can be tagged **Meal** (in the template editor). The starting template tags breakfast, the lunch smoothie and dinner on every day: 21 meals a week. Planned treats, like Saturday's order-out dinner, are normal meals.
- **Rating:** a normal tick is **On plan**. Unchecked meals have a small **Off plan** button that checks them off as off plan. Once checked, a chip on the row flips the rating, the same day only.
- **Task Sparks are unchanged:** an off-plan meal still pays its task reward. The rating only affects stamps.
- **Skipped meals** (never checked off) get no stamp, and count as not on plan.
- **Stamps:** each on-plan meal earns **1 stamp**, or **2** in a week whose supply line went up on time.

## The supply line (the prep gate)

- **Prep tasks:** template tasks can be tagged **Shopping** or **Cooking**. The starting template tags the Meijer run as Shopping and the Sunday meal prep as Cooking ("Prep chicken" is left untagged). Ticking one logs that step; undoing it takes the log back.
- **"I shopped" / "I cooked"** on the event screen log a step on any day, for prep done off-schedule. Today's logs made here can be undone.
- **Which week a log supplies:** Friday–Sunday logs supply the **next** week; Monday–Thursday logs supply the **current** week.

| Status | When | Effect |
|---|---|---|
| **Up on time** | Both shopping and cooking logged before the week's Monday 4 AM reset | All that week's stamps count double |
| **Up late** | Both logged during the week | Held stamps are released at single value; new stamps count normally |
| **Down** | Either still missing | Stamps are earned but held (grayed out), and expire at the reset |

- **Both steps are required.** Shopping without cooking is still down.
- **While down:** a banner tops the event screen ("Supply line down: Shopping ✓ · Cooking ✗") and the Events tab shows a badge.
- **Spoilage reminder:** shopping more than 2 days ago (active days) with no cooking since shows "You shopped [day] and haven't cooked yet."
- **At the reset,** a week still down loses its held stamps and its ration report.

## Rewards

- **Cards:** 21 stamps fill a card: **1,000 Sparks + 3 Shards**. Cards aren't tied to weeks, and extra stamps carry over. The screen shows the current card as a stamp grid, with held stamps grayed out. A card fills the moment its 21st stamp counts. A same-day undo or rating change that unfills it takes the reward back (refused if it's already been spent).
- **Weekly ration report:** at each reset, **85% or more** of the week's scheduled meals on plan **and** the supply line up (on time or late) pays **500 Sparks + 5 Shards**. It appears in the weekly report.
  - Scheduled meals are counted on active days only, from the event's first day. A day the app was never opened still counts its template meals, as missed.

### Lifetime milestones (cards filled)

| Cards filled | Reward |
|---|---|
| 1 | 1,000 Sparks + "Well Supplied" title |
| 5 | 4★ selector |
| 10 | 5★ selector |
| 25 | "Provisioner" title + the Field Kitchen theme |
| 50, 75, 100… | 5★ selector each |

- **When they pay:** with the card that reaches them, with a message saying what you got. Selectors go into the Bag.
- **Undo:** a same-day change that unfills that card takes the milestone back too (its Sparks, selector, title and theme). If the selector has already been opened, the change is refused instead.
- **Titles** join the shared list in Settings, and a new one is shown under the brand straight away.
- **The Field Kitchen theme:** olive green and amber, picked in Settings next to the other themes.
- **Catch-up:** cards filled before milestones existed claim theirs on the next open.

**Pace:**

| Kind of week | Stamps | Cards | Pulls (approx.) |
|---|---|---|---|
| About 80% on plan, prep on time | ~34 | ~1.6 | ~3 |
| Perfect | 42 | 2 (+ ration) | ~5 |
| Prep done late | ~17 | ~0.8 | ~1.5 |

Missing prep is the most expensive mistake by far.

## Stats (information only)

- **On plan by week:** a bar chart of each week's on-plan percentage (the last 11 closed weeks plus this week so far), colored by that week's supply line (on time, late, down or hibernated), with the 85% line.
- **Supply line history:** how many recent weeks were on time, late or down.
- **Lifetime:** stamps counted, cards filled and stamps expired.

## Hibernation

- Hibernated days have no meals due and aren't counted in the 85%. Checking off tasks and logging prep wait until you wake.
- A week with 4 or more hibernated days skips the supply check and the ration report; its held stamps count at single value instead of expiring.
- Partly hibernated weeks run the supply check normally, with the percentage over active days only.
- Cards filled while hibernating are paid when you wake. See [hibernation.md](hibernation.md).

## Data

- **Data version 6** (database version 5) adds four stores:
  - `prepLogs`: each shopping or cooking step, the week it supplies, and whether it came from a task or by hand;
  - `stamps`: one per on-plan meal. While its week is open, it counts or is held according to the supply line; when the week closes, it's marked counted (with its value) or expired;
  - `provisionWeeks`: one per closed week: supply status, meals scheduled and on plan, stamps counted and expired, and the ration reward;
  - `provisions`: the event state (first day, current week, cards filled, and the milestones, titles and themes earned).
- Meal ratings live on the day's tasks; template and day tasks gain `meal` and `prep` tags.
- **Upgrading:** tags the meal and prep tasks in the template and today's tasks, and stamps or logs any already done today. Older backups import the same way.
- **Export/import** includes everything above. Every reward goes through the currency ledger.
