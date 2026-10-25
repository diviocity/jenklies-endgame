# Jenklies: Endgame

A personal iPhone web app that turns my daily schedule into a gacha game. I complete my tasks, earn currency (with a bonus for doing them on time), and spend it on pulls. Rare pulls give **indulgences**: treats I've defined for myself and redeem in my free time. Common pulls give collectible **positive affirmations**. It's for me only: no accounts, no server, no monetization.

**Status:** Phases 1 (the core loop) and 2 (the pull animation) are built. The **Frontier Expedition** fitness event is built; see [docs/frontier-expedition.md](docs/frontier-expedition.md). Streaks, stats and the calendar come later.

- [Using it](#using-it) · [Development](#development) · [Design decisions](#design-decisions) · [Project brief](#project-brief)

## Using it

1. Open the GitHub Pages URL in Safari on the iPhone.
2. Share → **Add to Home Screen**. Launch it from the icon; it runs full screen and works offline.
3. Your data lives only on that device. Export a backup from **More → Backup** regularly (the app nags after 7 days). Keep the file in Files or iCloud Drive.

## Development

```sh
npm install
npm run dev        # local dev server
npm test           # unit tests (gacha odds, pity, reward math, actions, backup)
npm run build      # typecheck + production build into dist/
```

Stack: Vite, TypeScript and Preact, with IndexedDB through `idb`, and `vite-plugin-pwa` for the manifest and service worker.

- `src/config.ts`: every economy number in one place.
- `src/logic/`: the game rules as plain functions with no UI or browser dependencies (time, rewards, gacha, actions, backup). Each action returns a list of changes that is saved in a single IndexedDB transaction.
- `src/store.ts` and `src/db.ts`: in-memory state, saving and loading.
- `src/ui/`: the screens.

**Deploying:** `.github/workflows/deploy.yml` tests, builds and publishes `dist/` to GitHub Pages on every push to `main`. One-time setup: repo **Settings → Pages → Source: GitHub Actions**. The site is served from `/jenklies-endgame/`; set `BASE_PATH` when building for a different path. Other hosting options (private repo, Cloudflare Pages, Namecheap cPanel) are written up in [docs/hosting.md](docs/hosting.md).

## Design decisions

These fill gaps in the brief:

1. **A 5★ does not reset the 4★ counter.** That matches the brief's "a 4★ about every 8" (resetting would give about 8.5). A 5★ still counts as the "4★ or higher" for the 10-pull guarantee.
2. **Undo is blocked if those Sparks are already spent** (the balance never goes negative). Undoing a task in a cleared bucket also takes back that bucket's bonuses.
3. **Each template task is either a weekday task or a weekend task**, because the bucket names differ. A task that happens every day has one entry for weekdays and one for the weekend.
4. **One-off tasks** have weight 1, are valued at that day's rate, don't count toward the weekly total, and don't affect bucket bonuses.
5. **Six example indulgences** are seeded so pulling works from day one. Edit or retire them.
6. **Smallest task value:** base is never below 10. The on-time bonus is 20% of the rounded base.
7. **Days are locked in on first open:** the first time the app sees a day, it takes a snapshot of that day's tasks, values and deadlines. Template and deadline edits apply from the next day.
8. **Deadlines before 4:00 AM** are treated as after midnight, the end of the same game day.
9. **The pull animation** runs uplink → pod drop → rarity flash → reveal, about 2.7 s (3.5 s when a 5★ drops). The flash takes the color of the best result in the batch (3★ blue, 4★ purple, 5★ gold), and nothing before it hints at the rarity. Pulls are saved before the animation starts, so closing the app mid-animation loses nothing. With reduced motion turned on in iOS, the animation and flash are skipped and the results appear straight away.
10. **Bucket bonuses are paid** the moment the bucket's last task is checked off, any time that day. "On time" for the perfect bonus means each task met its own deadline. On Saturdays the perfect bonus only needs every task done that day. Like other values, this is fixed when the day starts. Days saved before bucket bonuses existed keep their old values (240 + 120 per task, no bucket bonus).

---

## Project brief

### Platform

- Static web app hosted on GitHub Pages and installed to the iPhone Home Screen as a PWA (manifest, icon, standalone display).
- Works fully offline (service worker). No backend and no accounts.
- iPhone-first portrait layout that respects safe areas. It should also work in a desktop browser.
- Data stays on the device (IndexedDB preferred). Ask the browser for persistent storage.
- Export / import: export all data to a JSON file, and import it back (with a confirmation step, replacing current data). Show a "last backup" date somewhere visible.
- No haptics (iOS web can't vibrate). Sound only after a tap.

### The daily loop

#### Days and buckets

- A new day starts at **4:00 AM**. Anything done before 4:00 AM counts for the previous day.
- Weekdays (Mon–Fri) have three buckets, each with a bonus deadline:
  - Morning, by 9:00 AM
  - Afternoon, by 5:00 PM
  - Evening, by 9:30 PM
- Weekends (Sat–Sun) have two buckets:
  - 1st Half, by 1:00 PM
  - 2nd Half, by 9:30 PM
- All deadlines are configurable in Settings. An individual task can also override its bucket's deadline.

#### Tasks

- Tasks come from an editable weekly template. Each task has:
  - name
  - which days it appears
  - bucket
  - optional deadline override
  - reward weight (default 1)
- The template can be edited from inside the app: add, edit, remove and reorder tasks.
- One-off tasks can also be added to just today.
- A starting template based on my current schedule is built into the app (`src/logic/seed.ts`), so a fresh install starts with it.
- Completing a task:
  - Any time during the day earns the base reward.
  - Before the bucket's deadline also earns the on-time bonus.
  - After the deadline, it earns base only.
  - Completions can be undone the same day, which reverses the currency.
- Once a day ends (4:00 AM), it's locked and can no longer be edited.

### Economy

All numbers live in one config so they're easy to tune.

#### Earning (base currency, placeholder name "Sparks")

*Revised after Phase 2: most of the value now comes from clearing whole buckets.*

- A **perfect week** (every task done, every task and bucket on time) earns **40,000 Sparks** (80 pulls).
- **Buckets are 75% of a perfect day; individual tasks are 25%.**
- **Tasks:** each task has a base value, plus a small on-time bonus of **20% of its base**.
- **Buckets:** clearing every task in a bucket pays a **clear bonus**. If every one of those tasks was on time, it pays the **same amount again** as a perfect bonus. Half of a bucket's value is locked behind a perfect bucket.
- A bucket's bonus scales with the total weight of its tasks, so bigger buckets are worth more.
- One-off tasks are worth a weight-1 task at that day's rate (100 + 20 with the starting template). They don't count toward a bucket's bonus, so adding one never puts a bonus at risk.
- Values are recalculated whenever the template changes. Each day's values are fixed when the day starts, so editing the template mid-day doesn't change today.
- With the starting template (83 tasks a week), each task is worth **100 + 20 on time**. The bucket bonuses (clear / perfect) are:

  | Bucket | Tasks | Clear | Perfect | Perfect bucket in total |
  |---|---|---|---|---|
  | Weekday Morning | 5 | 900 | +900 | 2,400 |
  | Weekday Afternoon | 4 | 720 | +720 | 1,920 |
  | Weekday Evening | 3 | 540 | +540 | 1,440 |
  | Saturday 1st Half | 8 | 1,450 | +1,450 | 3,860 |
  | Saturday 2nd Half | 3 | 540 | +540 | 1,440 |
  | Sunday 1st Half | 6 | 1,080 | +1,080 | 2,880 |
  | Sunday 2nd Half | 6 | 1,080 | +1,080 | 2,880 |

- **Saturdays are relaxed:** a Saturday bucket pays its perfect bonus as soon as every task in it is done that day, on time or not. Each task's own on-time bonus still needs its deadline. The days this applies to are set in `src/config.ts` (`perfectAnyTimeDays`).
- That gives about **39,860** for a perfect week (rounding puts it just under 80 pulls) and about **25,240** (50 pulls) with every task done but nothing on time. A perfect weekday is 5,760; with everything done but late it's 3,360.
- Pace: a perfect week gives about 2.4 five-stars (about 1.4 from pulls, plus about 1 bought with Shards) and hard pity about once a week. This is deliberately generous; most weeks won't be perfect while the habits form.

#### Pulls

- One pull costs **500 Sparks**, and a 10-pull costs **5,000**.
- 5★ odds:
  - 0.6% base rate.
  - From pull 66 onward, the 5★ chance rises by 6 percentage points per pull.
  - A 5★ is guaranteed by pull 80.
- 4★ odds: 5.1% base rate, and at least one 4★ or higher is guaranteed every 10 pulls.
- Pity counters carry across sessions and across single and 10-pulls, and reset when that rarity drops. Show "pulls since last 5★" in the UI.
- What each rarity gives:
  - A 3★ is always an affirmation (see below).
  - A 4★ or 5★ is an indulgence, picked at random among the active indulgences of that rarity.
  - If the 4★ or 5★ pool has no active indulgences, or the affirmation list is empty, block pulling with a clear message.
- Simulated averages with these rules: a 5★ about every 57 pulls, and a 4★ about every 8.

#### Secondary currency and shop (placeholder name "Shards")

- Every pull also gives Shards: 3★ = 1, 4★ = 2, 5★ = 10. A 3★ gives its Shard every time, including the first time an affirmation is collected. That averages about 103 Shards per 80 pulls, which is about one 5★ purchase per 80 pulls.
- The shop sells any active indulgence directly: 4★ for **20 Shards**, 5★ for **100 Shards**.
- Shop purchases don't give Shards and don't affect pity.

### Indulgences (4★ and 5★)

- An editable list that I define, edited from inside the app. Each indulgence has:
  - name
  - rarity (4★ or 5★)
  - optional emoji or icon
  - optional note
  - active/retired toggle (retiring keeps it in history but removes it from pulls and the shop)
- Inventory: won and bought indulgences stack. A Redeem screen uses one up and logs when it was redeemed. The app doesn't manage when I redeem them.

### Affirmations (3★)

- 3★ results are short positive affirmations: encouraging words reminding me that I'm capable of finishing what I start. They are not inventory items and can't be redeemed or bought.
- An editable list, edited from inside the app like indulgences. Seed it with about 40 original starter affirmations in a warm, direct, non-cheesy voice that I can edit or replace.
- Affirmation Collection screen:
  - Shows each affirmation once it has been pulled at least once.
  - Uncollected ones appear as locked placeholders, with a "collected X of Y" counter.
  - Shows how many times each one has been pulled.
- First pull of an affirmation: the reveal shows the full text with a "NEW" tag, and it's added to the Collection.
- Repeat pulls: the affirmation is still shown briefly, but it only gives its Shard.
- Editing the list: removing an affirmation keeps it in pull history. New affirmations start out uncollected.

### History and records

- Pull history: time, result, rarity, pity count at the time of the pull, and single vs 10-pull.
- Currency ledger: every Spark and Shard earned or spent, and from what.
- Redemption log.

### Look and feel

- Sleek sci-fi gacha UI with industrial accents, inspired by the overall vibe of *Arknights: Endfield*.
- Original visuals only: no copied logos, character art, or UI assets.

### Build order

1. **Phase 1, the core loop:**
   - today view with buckets and task check-off
   - currencies and the ledger
   - gacha logic with pity, plus a simple placeholder pull reveal
   - inventory, redeem, shop, Affirmation Collection and history
   - template, indulgence and affirmation editors, settings
   - export/import, offline support and installability
   - unit tests for the gacha odds, pity and reward math
2. **Phase 2, the pull animation:**
   - an elaborate pull sequence that hints at the rarity near the end with a colored flash (3★ blue, 4★ purple, 5★ gold)
   - a skip button and a 10-pull results grid
   - respect reduced-motion settings
3. **Later (don't build yet):** streaks, stats, calendar/history view.
