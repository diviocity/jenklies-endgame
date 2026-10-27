# Hibernation (app-wide pause)

A vacation mode for travel, illness or anything else that takes me out of my routine. It protects progress and never earns anything: nothing decays, expires, ages or is lost while hibernating, and no rewards of any kind are earned. That keeps it a real pause, never something worth abusing.

The rules are in `src/logic/hibernation.ts`; the page is **More → Hibernation** (also linked from Settings).

## Starting and ending

- **Start now:** starts this moment. Optionally give the last day away; it then ends at 4 AM the morning after.
- **Schedule:** a start day from tomorrow on (it starts at 4 AM that day), with an optional last day.
- **No backdating.** Hibernation can't start in the past, so set it up before leaving. This keeps every hibernated day in a week that hasn't closed yet, so nothing already paid or ranked is ever recalculated.
- **Wake up** any time: the one-tap button on the banner, Today or the Hibernation page. Tasks come back straight away and earn normally for the rest of the day.
- **One at a time.** A scheduled period can be cancelled before it starts.
- **The log** lists every period (dates and length in days). Periods can't be edited or deleted once they've ended.

## Days

- Days are whole app days (4 AM rollover). A day is hibernated if hibernation was on at any point during it, so the day it starts and the day it ends both count.
- Rewards earned earlier on the day it starts are kept.
- An open-ended period counts days as they pass; a period with a last day counts its planned days ahead of time (so this week's prorated target shows straight away).

## While hibernating

- A banner sits under the top bar on every screen, with **Wake up**, and the app is dimmed.
- **Today:** no tasks due. Tasks can't be checked off.
- **Frontier Expedition:** logging is off, and the map doesn't move (it catches up after waking).
- **Contingency Provisions:** no meals are due and prep logging waits; cards filled while away are paid on waking.
- **Salvage Exchange:** stage changes wait until you wake up, so their once-only rewards are never lost or earned while away. Adding and editing items still works.
- **Spending** (pulls, the shop, redeeming, selectors) still works.
- **Weekly report:** held back until you wake. If the latest week was skipped, a short **Welcome back** summary replaces it.

## Effect on weekly resets

| Hibernated days in the week | Frontier Expedition | Salvage Exchange | Contingency Provisions |
|---|---|---|---|
| 0 | normal | normal | normal |
| 1–3 | prorated by active days ÷ 7: decay, the weak-week threshold, weekly reward thresholds and the rank panel's target | normal | supply check as normal; the 85% counts active days only |
| 4 or more | skipped: no RP update, no decay, no weekly reward, weak-week streak unchanged | no weekly mission | no supply check or ration report; held stamps count instead of expiring |

- **Featured lots:** age tags and the 3-day fresh window count only active days. Open slots never refill while hibernating; they fill when you wake up.
- **Expedition rank history** shows skipped weeks as hibernated bars.

## Data

- **Data version 5** (database version 4) adds the `hibernations` store: each period's start, end (null while open-ended) and planned last day.
- Closed weeks record their hibernated days, and whether they were skipped.
- Existing data needs no changes; older backups import with no hibernation. Export/import includes the log and any scheduled period.
