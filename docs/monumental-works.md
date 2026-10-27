# Monumental Works (work focus event)

A permanent event on the Events tab that turns focused work into a weekly boss fight. It rewards long, unbroken stretches over scattered minutes, and the boss gets tougher as I win. Input is a **Start** tap and an **End** tap.

**Status:** Built. Phase 1 added focus windows, damage, the ladder (Tiers 1–11), days off, hibernation and weekly rewards; phase 2 added Agony Mode and its modifiers, the one-time rewards (selectors, the "Monument Breaker" and "Agony Unbound" titles and the Monolith theme), the Bestiary and the stats.

Every number lives in `src/config.ts` (`MONUMENTAL`). The rules are in `src/logic/monumental.ts` and the screen is `src/ui/Monumental.tsx`.

## Focus windows

- **Start / End** on the event screen. Starting offers an optional planned length (25, 50 or 90 minutes), shown as a countdown while the app is open. Web apps can't sound an alarm, so the screen suggests pairing it with the iPhone timer.
- **While a window runs,** a slim bar under the top bar on every screen shows the time, any time left and the pending damage. Tapping it opens the event.
- **Timestamps only:** the app stores when a window started and ended and works out the rest, so nothing has to run while the app is closed.
- **3-hour cap:** a window counts for at most 3 hours. If the app is opened with a window running longer (or End is tapped after 3 hours), it asks **"When did you stop?"** with a time picker; anything past the cap is cut.
- **Forgotten Start:** today's windows can be added by hand, adjusted or deleted (today only, up to 3 hours, no overlaps).
- **Any day counts,** weekends included. Logging is off while hibernating, and a window running when hibernation starts ends at that moment.
- **The first boss** (Lethargos, Tier 1) is there straight away, at full HP however late in the week the event starts.

## Damage

| Rule | Effect |
|---|---|
| Base | 1 damage per focused minute |
| Short window (under 15 min) | half damage |
| Chain | a window starting within 15 minutes of the previous one's end continues the chain: 1×, then 1.25×, then 1.5× from the third window on |
| Deep focus crit | a single window of 90 minutes or more deals +25% |

- The multipliers combine, and each window's damage is rounded.
- Damage is worked out from the windows themselves, so adjusting one of today's windows updates its chain and everything after it.
- Chains carry across days but restart at the weekly reset (each boss is a new fight). A window belongs to the day it started.
- Damage lands when a window ends; a running window shows its pending damage.
- **Today's assault marker:** a fifth of the boss's HP, for the day. Display only.
- **The HP bar** has phases at 66% and 33%. The boss is shown **defeated** the moment its HP reaches 0; damage after that counts toward overkill.

## Days off

- Mark a workday (Monday to Friday) as a day off, for that day or ahead. Each one takes a fifth off that week's boss HP. Only this event uses them.
- Not allowed on a day with focus already logged (so a day off can't shave HP off a boss you're about to miss), and no focus can be logged on a day off.
- Days off that haven't passed can be cancelled; past ones stay in the log on the event screen.

## The ladder

- A new boss appears at each weekly reset (Monday 4 AM) and the fight runs until the next one.
- **Boss HP:** tier hours × 60, prorated by active workdays ÷ 5 (days off and hibernated workdays aren't active).
- **At the reset:** defeated → next week is one tier up; escaped → same tier; escaped two weeks in a row → down one tier (never below Tier 1).

| Tier | Hours (HP) | Boss |
|---|---|---|
| 1 | 5 (300) | Lethargos |
| 2 | 7 (420) | Akedia Shard |
| 3 | 9 (540) | Distraxis |
| 4 | 11 (660) | Marble Procrastes |
| 5 | 13 (780) | Torpor Colossus |
| 6 | 15 (900) | Oblivane |
| 7 | 17 (1,020) | Entropos |
| 8 | 19 (1,140) | Kronoklast, the Hour-Eater |
| 9 | 21 (1,260) | Dysergia |
| 10 | 23 (1,380) | Hydra of Tabs |
| 11 | 25 (1,500) | Akrasia the Unmoved |

Each boss has a one-line flavor description and an original sigil, drawn in code from its name.

### Agony Mode (Tier 12)

- **Unlocks** on the first defeat of Akrasia: the next week is Agony Mode.
- **Each week** a random boss from Tiers 1–11 appears as its Agony variant (e.g. "Agony Lethargos"), always at 25 hours, with a random modifier. Neither the boss nor the modifier is the same as the week before.
- **Ladder rules still apply:** a defeat keeps Agony Mode; two escapes in a row drop back to Tier 11, and Akrasia has to be beaten again to return.

| Modifier | Effect |
|---|---|
| Enraged | windows under 20 minutes deal no damage |
| Fortified | chains continue only if the gap is 10 minutes or less |
| Dampened | the chain multiplier is capped at 1.25× |
| Regenerating | each workday (not a day off or hibernated) with under 60 damage dealt heals the boss 5% of its max HP at that day's 4 AM rollover. Healing never takes damage below zero, and a defeated boss stays down |
| Exposed | boss HP +15%, but deep-focus crits deal +50% instead of +25% |

Modifiers are a list in `MONUMENTAL.modifiers`; each sets only the rules it changes (`minWindowMinutes`, `chainGapMinutes`, `chainCap`, `critBonus`, `hpMultiplier`, `regen`), so new ones are easy to add.

## Rewards (at the reset)

| Result | Reward |
|---|---|
| Defeated, Tier *t* | 1,000 + 200 × (t − 1) Sparks + 3 + floor((t − 1) ÷ 2) Shards (Tier 1: 1,000 + 3; Tier 11: 3,000 + 8) |
| Overkill (120%+ of HP) | an extra 500 Sparks + 2 Shards |
| Escaped with 75%+ dealt | half the defeat reward |
| Escaped with 50–74% | a quarter |
| Defeated, Agony | 3,000 Sparks + 10 Shards |

Partial rewards round Sparks to the nearest 10 and Shards down. The result shows in the weekly report.

### One-time rewards

| Achievement | Reward |
|---|---|
| First defeat of Tier 3, Tier 6 and Tier 9 | 4★ selector each |
| First defeat of Akrasia (Tier 11) | 5★ selector + "Monument Breaker" title + the Monolith theme (obsidian and crimson) |
| All 11 Agony variants defeated | 5★ selector + "Agony Unbound" title |
| Every 10 Agony victories | 5★ selector |

They're claimed when the result is recorded (at the reset), or on the next open if any were missed. Titles join the shared list in Settings and are shown under the brand straight away; the theme is picked in Settings.

## Bestiary and stats

- **Bestiary:** an entry for each boss and each Agony variant. Each shows a silhouette until its first defeat, then its name, flavor text, first-defeat date and times defeated. Agony variants appear once Agony Mode opens.
- **Stats** (information only): focused hours per week (the last 12), the longest window, the longest chain (windows and minutes) and the average window. The ladder panel lists each recent week's tier, boss, modifier and result.

## Hibernation

- A week with 3 or more hibernated workdays (Mon–Fri) is skipped: no result, no ladder change, and the two-escapes counter is untouched. So is a week with no active workdays left.
- With 1–2 hibernated workdays, HP is prorated by active workdays ÷ 5. See [hibernation.md](hibernation.md).

## Data

- **Data version 7** (database version 6) adds four stores:
  - `focusWindows`: each window's start, end (null while running), day, week, planned length and whether it was added by hand;
  - `daysOff`: one record per day off;
  - `bossWeeks`: one per closed week: tier, boss, Agony modifier, HP, damage, healing, result, when it fell, next tier and reward. This is also the Agony rotation history and the Bestiary's source;
  - `monumental`: the ladder (tier, escapes in a row), this week's boss, and the one-time rewards, titles and themes claimed.
- Existing data needs no changes; older backups import with these empty. Export/import includes everything above, and every reward goes through the currency ledger.
