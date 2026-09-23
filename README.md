# Voice Schedule

[中文](README.zh-CN.md) | **English**

> Say a sentence. It's on your calendar.

A voice-first scheduling app. Say *"明天下午三点半跟老张碰一下，大概一小时"* into your phone and the event is created — no opening a calendar, picking a date, dragging a time slot, typing a title.

**Live app**: https://your-app.example.com/
**User guide**: https://your-app.example.com/use.html
**Public demo**: https://<your-username>.github.io/voice-schedule/demo.html (no account, no backend, opens instantly)

It's a PWA: open the link in Safari, add it to your Home Screen, and it behaves like an installed app — no app store involved.

> **About the app's language**: the interface and the speech parser are both Chinese (Simplified). The demo and the live app are best understood as a working product for Chinese speakers; this README documents the engineering.

> **Two builds**: the live app (first link) has cloud sync — log in and your data follows your account. The demo is a **cloud-free build**: no login, no data sent to any server, everything stays in the visitor's own browser, preloaded with fictional sample events. The demo exists so people can open it and try it immediately; the live app is the one you'd actually use day to day.

---

## Why this exists

Existing calendar apps cost too much per entry. To record "movie, Friday 7pm" you open the app, tap plus, pick a date, scroll to a time, type a title, save — six steps. The cost is high enough that people simply stop bothering, and the calendar stays empty and useless.

But in the moment you actually want to record something, what shows up in your head is **a sentence**, not six form fields. So the trade-off is deliberate: **make "just say it" the default path**, and leave the structuring to the program.

## What it does

| What you want | How you do it |
| --- | --- |
| Create an event | Say "明天下午三点半跟老张碰一下，大概一小时" |
| Create a to-do item | Say "记得买牛奶" — anything without a concrete time lands in the item list |
| Any duration | Type the number directly in the confirm card, then pick minutes / hours / all-day — not limited to fixed presets |
| Recurring events | "每周一三五晚上七点半健身" is recognized automatically, and can be edited to daily / weekly / monthly in the card |
| Time anchors | Instant points like waking up or taking medication get their own toggle — rendered faint, excluded from totals |
| Mark as important | Flip the switch and the entry renders as a full block in month view instead of a small dot |
| Journal | Top-right of the calendar page; hold the mic and talk — a few seconds of pause won't cut you off |
| See your schedule | Day / week / month views, with a continuous date strip along the top you can drag |
| Multi-device sync | Log in and events, items, and journal entries share one cloud dataset |
| Reminders | Export `.ics` into Apple Calendar and let iOS deliver the notifications |

Data is isolated per account: sign in with a different account on the same device and you see that account's schedule. Sharing the link doesn't expose your data.

**The journal** is the second most-used part after the calendar itself: talk through your day, tag it, and search it back later by keyword (search "卧推" — bench press — and every training session comes back ordered by date). It isn't a to-do list; it's a record left for your future self.

## Design trade-offs

**Recognition results never go straight into storage — they land as an editable card first.** Speech recognition will get things wrong, and writing straight to the database turns mistakes into facts. So the flow is *speak → parse → card → human confirms → store*, and errors are caught before they're persisted.

**Only things with a definite time become events; everything else becomes an item.** "下周三上午十点开会" and "记得买牛奶" are both "remember this" in natural language, but they differ completely in how certain the time is. Mixing them onto one calendar makes the calendar unreadable.

**Recurring events are stored as rules, not expanded into instances.** "每周一三五" is one rule, not dozens of rows pushed into the calendar. Editing it means editing one thing, not dozens.

**Empty space matters more than a full schedule.** The app's only job is to record what you explicitly decided to say. No smart scheduling, no proactively filling the table with "suggestions". An over-full calendar is itself a source of stress.

## What broke in production

Once real people were using it, a set of problems surfaced that only real usage exposes. This is the most valuable part of the whole project — **every one of them was spotted by eye, then dug down to a root cause layer by layer, rather than calling it done because it "looks fixed".**

### 1. Only 3 of 14 events reached the cloud

A new device could only pull 3 events. Querying the cloud database confirmed it: the server really did have only 3.

Three independent root causes:

1. Another page (the batch-import page) wrote to local storage with a timestamp but never added those records to the **push queue**. The startup fallback only picked up entries *without* a timestamp, so those 14 could never enter the queue — only the 3 that were later edited by hand made it up.
2. Delete records were synced **without comparing timestamps at all**. Any old tombstone would unconditionally wipe newer local data, and deletes always won. Fixed: when the local version is newer, don't delete — push the record back up to revoke the tombstone instead.
3. Pushes weren't batched: a single failure cleared the entire queue. Fixed: batches of 50, and **only the batch that actually succeeded is cleared**; failed batches stay in the queue for retry.

The sync order was also locked to **pull first, then push**. That order is not optional — pushing first overwrites a delete that just happened in the cloud with a stale local copy. A serial lock makes pull and push queue up properly, instead of relying on every call site to remember to `await`.

### 2. Different every time it opened: sometimes blank, sometimes data popping in

Simulating "open → use for a few seconds → close", ten times in a row, reproduced it:

| Attempt | On open | On close |
| --- | --- | --- |
| 1 | 0 (blank) | 0 |
| 2 | 0 | 0 |
| 3 | 0 → jumps to 14 midway | 14 |
| 4 onwards | 14 | 14 |

The root cause was a **race between rendering and sync**: sync is asynchronous and only started after 1.5 s, while the view had already painted from local data the instant the page opened. A fresh device has an empty container, so it painted blank. Each open/close cut sync off at a different point, so each open showed a different half-finished state.

Fixed: sync now starts at 150 ms with a 20 s throttle; while sync is in flight the UI says "正在从云端同步…" instead of "今天还没有日程"; the view redraws unconditionally when sync completes; events are de-duplicated by id on startup; and static assets are versioned so a new HTML can never load alongside a stale JS.

### 3. Multiple copies in one day, events rendered as thin slivers, dots appearing in month view

Four symptoms that look unrelated — one root cause.

The calendar's initial render goes through an **event source** (FullCalendar refetches it automatically on view change), while the redraw after sync used a different mechanism: per-event `addEvent()`. Events added via `addEvent` count as "personal events" and are **not part of the event source**. With both paths live, every "sync + view change" stacked one more copy on screen.

Reproduction: 2 events initially → 3 after sync (`addEvent` ignores the view range and pulled in tomorrow's too) → **6** after cycling through the views.

Hence the four symptoms: multiple copies per day = copies accumulating round by round; thin slivers = two copies in the same slot squeezed side by side, each getting half the width; dots in month view = plain timed events added via `addEvent` get default-rendered as dots; "different every time" = the number of copies depended on when you last opened it and switched views.

Fixed: everything collapses onto the single **event source** path (`refetchEvents()`) — the same path the app already used for everyday create/update/delete, and the one that had been verified.

> One lesson from this third bug: for two rounds I couldn't reproduce it, because my test only simulated "open → sync", whereas the real sequence is "open → sync → **change view**". That missing step was the trigger.

### 4. Recurring events disappeared after a version update

A user reported: "Where did my recurring events go? I had them set up before."

The cause was a **regression**: the read/write path for recurrence rules had been touched repeatedly over several rounds, and the form builder stopped carrying the recurrence field. So "say something with a recurrence" was still recognized, but the "confirm and save" step dropped it. Bugs like this don't throw and don't crash — they silently lose one field on one particular path.

The point of the fix wasn't the missing line; it was treating the **form-field → data-field mapping as a contract that tests must cover**. Any field the parser learns to produce must also appear in the form builder, or it will be silently dropped. The dedicated test suite now asserts, field by field, that `node` (time anchor), `imp` (important), and `recur` (recurrence) actually reach storage.

### 5. The duration input was squeezed into a sliver — it took three rounds

This one best illustrates how unreliable "looks fixed" is.

Round one's requirement was "duration shouldn't be limited to fixed presets". The approach: replace the dropdown with "number input + minute / hour / all-day buttons", **packed into a row that was already split three ways**. All tests green, the feature genuinely worked — and then a screenshot from a real phone showed the input squeezed down to a bare caret, with the unit buttons pushed past the right edge of the screen.

Round two moved the duration onto its own full-width row. Figured that was it. Real-device feedback came back: switching to "minute" made the panel taller and pushed the title out of view; and `type="number"` brings its own up/down steppers on mobile while still accepting a typed minus sign.

Round three finally cleaned it up: the field became plain text (numeric keypad on mobile, no steppers, no minus key on the keyboard), invalid characters are filtered as you type, and saving rejects anything under one minute; the two toggles (time anchor / important) became side-by-side iOS-style switches so neither crowds the other; and the confirm sheet's title is pinned to the top with only the form area scrolling, so no amount of content can push it off.

**The difference across the three rounds wasn't functionality — it was whether you could see it on a real device.** The automated DOM assertions passed throughout, because they check *values*, not *how many pixels this box has left on a 390 px screen*. Since then, every UI change gets one extra step: render it at phone width and look at it before shipping.

## Implementation notes

**Frontend**: a single `index.html` with styles and logic inlined — no build step, no framework, no npm dependencies (FullCalendar is vendored locally rather than pulled from a CDN). Open it and it runs; change a line and refresh.

**Speech parsing** (`parser.js`): turns spoken Chinese into a structured event — time (including relative and recurring expressions like "下周三" and "每周一三五"), title, duration, type (event / item), and a predicted tag. Recurring expressions must be parsed *before* date expressions, or "每周一" gets consumed as "this Monday".

**Data**: localStorage locally, with every field change pushed into a pending-sync queue.

**Cloud sync**: backed by WorkBuddy Cloud Service (Postgres). Each record carries a millisecond timestamp for last-write-wins merging, and deletions propagate as tombstone records. List-type preferences (such as journal tags) must *not* be overwritten wholesale — a newly signed-in device only has default values locally, so overwriting would delete another device's data; they're merged as a union keyed by tag instead.

> The `CLOUD_KEY` in the source is a cloud publishable key (`wbpk_` prefix). It's designed to be public: it only initializes the cloud SDK on the frontend and identifies the app, working alongside server-side row-level security (RLS) for isolation. It contains no privilege-escalating credential. The real security boundary is per-account isolation on the server, not this string.

**Export**: generates `.ics` for Apple Calendar, leaving scheduled reminders to iOS — the app itself never needs to run in the background.

## Repository layout

```
.
├── index.html            Main app (single file: markup + styles + logic)
├── demo.html             Cloud-free demo build (generated from index.html by build_demo.py)
├── build_demo.py         Demo build script (strips cloud SDK / version check, injects sample data)
├── parser.js             Spoken Chinese → structured event
├── fullcalendar.min.js   FullCalendar (vendored)
├── use.html              User guide
├── routine.html          Batch-import page (bulk-add fixed routines)
├── ver.json              Current version string
├── icon-180.png          Home Screen icon
└── tests/
    ├── parse.js          Parser unit tests (time / recurrence / classification)
    ├── acceptance.js     End-to-end acceptance (speak → confirm → store → render → export → reload)
    ├── features.js       Form feature tests (custom duration / time anchors / recurrence / important / invalid input)
    ├── sync.js           Cloud sync tests (queue fallback / tombstone comparison / batched retry)
    └── demo.js           Demo build tests (zero network requests / sample data / reset)
```

> **On `demo.html`**: it's generated from `index.html` by `build_demo.py` and **should not be hand-edited**. After each release of the main app, re-run `python build_demo.py`. The demo has zero backend dependencies — the script self-verifies that the output contains no cloud SDK URL, no production domain, no cloud key, and no `fetch` call whatsoever.

## Running and testing locally

There's no build step; serve the directory and open `index.html`:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

> Cloud login is only enabled on the production domain (there's an origin check in the code). Running locally uses local storage only.

Tests drive the whole page for real under jsdom, asserting against the DOM rather than unit-testing functions in isolation:

```bash
npm install
npm test
```

Individual suites:

```bash
npm run test:parse        # Parser unit tests         18 cases
npm run test:acceptance   # End-to-end acceptance     45 cases
npm run test:features     # Form features             38 cases
npm run test:sync         # Cloud sync                14 cases
npm run test:demo         # Demo build                33 cases
```

## How this project was built

This was made by **one person plus an AI agent**, with an explicit division of labour:

- **Mine**: deciding what problem to solve, the interaction model and information hierarchy, the trade-off behind every feature, judging whether something was *actually* fixed, and driving each next round from problems found in real use.
- **The AI agent's**: turning all of the above into running code.

The five bug stories above show how that division works in practice: the anomalies were spotted by a human eye ("it's different every time I open it"), the root causes were dug out by following that thread downwards (cloud data → sync logic → rendering internals), and every "looks fixed" build had to survive an attempt to falsify it with automated tests. **The scarce part here isn't writing code — it's knowing where to look.**

## License

[MIT License](LICENSE) — free to use, modify, and distribute. Provided "as is", without warranty of any kind.
