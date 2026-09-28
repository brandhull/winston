# Winston

A personal Kindle highlights reader. Amazon's own "notebook" page for browsing
highlights is slow, hard to search, and gives you no way to add your own
thinking to a passage. Winston scrapes your highlights into a database you
own, then gives you a fast web app to search them, comment on them, star ones
worth revisiting, and push favorites out to another tool.

No Readwise, no third party handling your data — just a scraper, a Baserow
table, and a small web app.

## What it does

- **Search & browse** every highlight, grouped by book, filterable by book or
  by whether you've commented on it yet.
- **Comments** — a "note to self" on any highlight, autosaved, synced to
  Baserow.
- **Star + Review** — star anything worth resurfacing. The Review tab shows a
  shuffled daily rotation of your starred highlights (prioritizing ones you
  haven't seen in a while), or the full starred list on demand.
- **Push to Seneca** — send a highlight's quote + author (and your comment) to
  a separate Baserow table. Re-pushing updates the same row instead of
  duplicating it.
- **Manage Books** — hide books you'll never revisit. Hidden books disappear
  from the browse list, search, and Review — and the *scraper* skips them
  too, so they don't waste time or eat into the "recent books" scan below.
- **Sync from anywhere** — a Sync button in the web app (usable from
  Mac/iPad/iPhone) triggers a fast, unattended scrape of your ~10 most
  recently active books, picked up by a small background watcher on your Mac.
- **PIN-gated** — single-user, no account system, just a PIN.

## Architecture

Three pieces:

1. **Baserow** — the single source of truth. One table holds every highlight;
   a second, single-row table holds shared app state (sync status, hidden
   books).
2. **Scraper** (`sync.js` / `sync-lib.js` / `poll-sync.js`, Mac-only) — drives
   a real Chromium browser via Playwright against `read.amazon.com/notebook`
   (there is no official Kindle highlights API). Logs in interactively the
   first time and persists the session; dedupes against Baserow via a
   `sha256(book + location + text)` fingerprint so re-running is always safe.
3. **Web app** (`web/`) — a static page on Cloudflare Pages, backed by Pages
   Functions that proxy Baserow so the API token never reaches the browser.

```
Amazon notebook  --Playwright-->  Baserow  <--REST-->  Cloudflare Pages Functions  <--fetch-->  web/public (browser)
```

### Why two sync paths

Amazon has no incremental/delta API — checking for new highlights always
means walking the book list. Amazon also requires re-authentication on this
page roughly every hour, regardless of cookies, so:

- **`npm run sync`** (manual, on your Mac) does a **full sweep** of your
  library and opens a visible browser if login is needed. Thorough, safe to
  run any time you're physically at your Mac.
- **The Sync button** (any device) just flags a request in Baserow. A
  `launchd` job polls that flag every ~90s and, when set, runs the scraper
  **headless**, capped to your ~10 most recently active (non-hidden) books.
  If your Amazon session happens to be stale, it fails fast with a clear
  message rather than hanging — there's no one there to log in.

## Setup

### 1. Baserow

Create a database with two tables (the Baserow API doesn't support field
creation, so this part is manual, once):

**`Highlights`**

| Field | Type |
|---|---|
| `book_title` | Text (primary) |
| `author` | Text |
| `highlight_text` | Long text |
| `location` | Text |
| `comment` | Long text |
| `source_added_at` | Date |
| `synced_at` | Date |
| `highlight_uid` | Text |
| `starred` | Boolean |
| `last_shown_at` | Date |
| `seneca_row_id` | Text |

**`Sync Status`** (exactly one row)

| Field | Type |
|---|---|
| `label` | Text (primary) |
| `status` | Single select: `idle`, `requested`, `running`, `error` |
| `requested_at` | Date (with time) |
| `last_synced_at` | Date (with time) |
| `last_error` | Text |
| `hidden_books` | Long text (JSON array of book titles) |

### 2. Scraper (Mac only)

```bash
npm install
cp .env.example .env   # fill in your Baserow token + table IDs
npm run sync            # first run: log in to Amazon in the browser that opens
```

- `npm run sync -- --recent=N` — scan only the N most recently active books.
- To enable the in-app Sync button, load `com.brandonhull.winston-poll-sync`
  (a `launchd` LaunchAgent pointed at `poll-sync.js`) so it polls Baserow in
  the background.

### 3. Web app (Cloudflare Pages)

```bash
cd web
npm install
cp .env.example .dev.vars   # fill in PIN + Baserow tokens/table IDs
npx wrangler pages dev public              # local dev
npx wrangler pages deploy public --project-name <your-project>
```

Set the same values as Cloudflare Pages secrets (`PIN`, `BASEROW_TOKEN`,
`BASEROW_TABLE_ID`, `BASEROW_SYNC_TABLE_ID`, `BASEROW_SENECA_TOKEN`,
`BASEROW_SENECA_TABLE_ID`) via `wrangler pages secret put`.

## Known limitations

- Amazon's DOM isn't documented and can drift — selectors live in one place
  at the top of `sync-lib.js` if they ever need updating.
- The hourly re-auth window means the Sync button only works if you're at
  your Mac or were recently — otherwise it fails fast and tells you to run
  `npm run sync` manually.
- Amazon enforces a per-book export cap on some books; the scraper detects
  and logs this rather than trying to work around it.
- Manage Books doesn't retroactively cross-reference an external table like
  Seneca — it only prevents *future* duplicates once you've pushed a
  highlight through the app.
