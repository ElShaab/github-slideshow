# Amputee Research Dashboard

A personal research dashboard for tracking questions and discussions in
amputee / limb-loss communities alongside the related medical literature.
Built for a physician writing a Substack blog on amputee care.

Everything runs from one Node process: an Express API, a SQLite database, a
plain-JS single-page front end, and background poll jobs for each source.

```
dashboard/
├── src/
│   ├── server.js          Express app, static hosting, error handling
│   ├── scheduler.js       Independent per-source poll timers
│   ├── db.js              SQLite connection, schema, seed data
│   ├── config.js          Environment / secrets
│   ├── lib/               keywords, items, matcher, ingest, state, quota, http
│   ├── routes/            /api/keywords, /api/items, /api/settings, /api/sources
│   └── sources/           reddit.js, x.js, youtube.js, pubmed.js, websearch.js
├── public/                index.html, app.js, styles.css
├── test/                  node:test suites (no network required)
└── data/                  SQLite file (gitignored)
```

## Quick start

```bash
cd dashboard
npm install
cp .env.example .env     # optional: nothing is required to boot
npm start                # http://localhost:3000
```

Reddit and PubMed work immediately with no credentials. X and YouTube stay
disabled until you add their keys.

### On Replit

The repo root carries `.replit` and `replit.nix`, so importing the repo and
pressing **Run** installs dependencies and starts the server on port 3000.
Put `X_BEARER_TOKEN` and `YOUTUBE_API_KEY` in the **Secrets** panel rather
than in a file. Replit's filesystem is persistent, so `data/dashboard.db`
survives restarts.

## How it fits together

1. **Keywords** live in SQLite and are read fresh from the database at the
   start of every poll — nothing is hardcoded. Each keyword applies to *all
   sources* or to a specific subset (Reddit, X, YouTube, PubMed). Terms are
   trimmed, internal whitespace is collapsed, and duplicates are rejected
   case-insensitively.
2. **Poll jobs** fetch from each source on its own timer, normalize results,
   and hand them to the ingest pipeline.
3. **Ingest** matches text against the live keyword list, skips anything
   already in the `seen_items` ledger, and writes the rest into `items`.
4. **The feed** shows everything in one chronological list, filterable by
   source, keyword, status and free text, with a New / Reviewed / Used status
   per item.

### Unified item shape

Every source normalizes to the same record:

```json
{
  "source": "reddit",
  "author": "u/someone",
  "text": "Phantom limb pain at night…",
  "url": "https://www.reddit.com/r/amputee/comments/…",
  "timestamp": "2024-06-01T10:00:00.000Z",
  "keyword_matched": "phantom limb pain",
  "keywords_matched": ["phantom limb pain", "prosthetic"],
  "status": "new",
  "kind": "post",
  "origin": "r/amputee"
}
```

### Deduplication

`seen_items (source, external_id)` is the dedup ledger and is written even for
items that matched no keyword. Dismissing an item from the feed deletes the
`items` row but keeps the ledger entry, so a re-poll never resurfaces it.
Because the key includes the source, the same ID appearing on two sources is
still stored twice.

## Sources

### Reddit — no credentials

Reads the public JSON endpoints, `/r/<sub>/new.json` for posts and
`/r/<sub>/comments.json` for new comments. Subreddits are managed in the
Sources tab (seeded with `amputee`, `amputees`, `prosthetics`, `Prosthetist`,
`limbloss`, `disability`, `AskDocs`). Requests are spaced ~1.2s apart and sent
with a descriptive `USER_AGENT`, which is what Reddit asks for on these
endpoints. One private or banned subreddit is reported as a note; if *every*
subreddit fails, the whole poll is marked as an error.

### X (Twitter) — `X_BEARER_TOKEN`

Uses the official API v2 recent-search endpoint
(`GET /2/tweets/search/recent`). Keywords are packed into as few `OR` queries
as the query-length budget allows, `-is:retweet` is appended, and `since_id`
is stored so each poll only asks for tweets newer than the last one seen.

Rate limits are respected two ways: a per-tier floor on the poll interval and
per-tier caps on how many query batches run per poll, plus live handling of
the `x-rate-limit-remaining` / `x-rate-limit-reset` headers, which park the
source behind a backoff when the window is nearly spent. Set your tier in the
Sources tab:

| Tier  | Minimum interval | Query batches / poll | Results / query |
| ----- | ---------------- | -------------------- | --------------- |
| free  | 180 min          | 1                    | 10              |
| basic | 15 min           | 2                    | 100             |
| pro   | 5 min            | 5                    | 100             |

Recent search is not included in X's free tier at all; if you are on free, the
poll will return an authorization error until you upgrade.

### YouTube — `YOUTUBE_API_KEY`

Uses the Data API v3 two ways, both optional and toggled in the Sources tab:

- **New comments** on a configurable list of channel IDs
  (`commentThreads.list` with `allThreadsRelatedToChannelId`, 1 unit/call).
  Add a channel by ID (`UC…`), `@handle` or channel URL — a handle costs one
  extra unit to resolve.
- **New videos** matching keywords (`search.list`, 100 units/call), restricted
  to videos published since the last successful search.

Quota is metered against the 10,000 units/day free tier, bucketed by the
Pacific date the quota actually resets on, and counted *before* each call
(a failed call still costs quota). A configurable reserve (default 500 units)
is held back, and the expensive keyword search is skipped rather than
overspending. `quotaExceeded` from the API backs the whole source off; a
single channel with comments disabled is just reported.

### PubMed — no key required

Uses NCBI E-utilities: `esearch` over `[Title/Abstract]` for every keyword
scoped to `all` or to `pubmed`, then `esummary` for metadata and `efetch` for
abstracts. Requests are paced for the 3 req/s unauthenticated limit (10/s if
you set `PUBMED_API_KEY`). To keep clinical searches separate from community
chatter, add keywords scoped to PubMed only — the Research tab shows the
resulting query and the articles it returned.

### Web search — `BRAVE_SEARCH_API_KEY` *or* `GOOGLE_SEARCH_API_KEY` + `GOOGLE_SEARCH_CX`

Covers communities that have no API of their own — Quora and Inspire are
seeded, and any domain can be added. It asks a licensed search index for
site-scoped matches and stores **only what that search API returns**: title,
snippet and link. The result pages themselves are never fetched, so this does
not scrape a site that prohibits it. You get told which threads are worth
reading and click through to read them in context.

Providers (pick one in the Sources tab):

| Provider | Free tier | Results/query |
| -------- | --------- | ------------- |
| Brave Search API | 2,000 queries/month | 20 |
| Google Programmable Search | 100 queries/day | 10 |

Each query is one keyword against one site, and polls rotate through the
keyword × site matrix, so keyword attribution is exact and the query count is
predictable. At the defaults (every 12 h, 4 queries per poll) that is ~240
queries/month, comfortably inside Brave's free tier. Queries are counted
before they run, metered monthly or daily to match the provider, and the poll
stops early rather than overspending. Results dedup on a normalized URL, with
tracking parameters and fragments stripped, so the same thread never repeats.

Where a result carries no publication date, the item is timestamped at
discovery and `meta.published_known` is `false`.

### Intentionally excluded

There are no scrapers in this project. Quora, Inspire, Facebook groups and X's
web interface all prohibit scraping in their terms and enforce it with bot
protection, and Inspire in particular carries identifiable patient health
discussion. Quora and Inspire are covered through the licensed search index
described above; X is covered through its official API.

## Scheduling

Each source has its own timer that re-reads its interval from the database
after every run, so changing an interval in the UI takes effect without a
restart. Defaults: Reddit 15 min, X 30 min, YouTube 30 min, PubMed 6 h, web
search 12 h.

Failures are isolated. `runSource` never throws: a failing source records its
error and the other timers keep running. A 429 or 503 sets `next_allowed_at`
from the `Retry-After` / rate-limit headers and later polls skip the source
until that passes (clearable from the UI). First runs after a restart are
staggered so every API is not called at once.

## API

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET    | `/api/keywords` | List keywords and the valid source names |
| POST   | `/api/keywords` | Create `{term, scope, sources, notes, enabled}` |
| PUT    | `/api/keywords/:id` | Update any of those fields |
| DELETE | `/api/keywords/:id` | Delete |
| GET    | `/api/items` | Feed; `source`, `keyword`, `status`, `q`, `since`, `limit`, `offset` |
| GET    | `/api/items/summary` | Counts by source/status and keyword totals |
| PATCH  | `/api/items/:id` | `{status: "new" \| "reviewed" \| "used"}` |
| DELETE | `/api/items/:id` | Dismiss (stays deduplicated) |
| GET    | `/api/sources` | Per-source status, config, credentials, recent poll log |
| POST   | `/api/sources/:source/poll` | Poll now (`?force=true` ignores backoff) |
| POST   | `/api/sources/:source/clear-backoff` | Clear a rate-limit backoff |
| GET/PUT| `/api/settings` | Intervals, limits, toggles |
| GET    | `/api/health` | Liveness plus per-source status |

Subreddits live under `/api/sources/reddit/subreddits`, YouTube channels under
`/api/sources/youtube/channels`, and web-search domains under
`/api/sources/websearch/sites` (all support GET/POST/PATCH/DELETE).

## Database

`keywords`, `keyword_sources`, `items`, `item_keywords`, `seen_items`,
`source_state`, `settings`, `subreddits`, `youtube_channels`, `search_sites`,
`api_usage`, `poll_log`. The schema is created on boot by `src/db.js`;
deleting `data/dashboard.db` resets everything.

Databases created before the source list grew are migrated on boot: `items`
and `keyword_sources` are rebuilt without the old `CHECK (source IN …)`
constraint, which SQLite cannot alter in place. Rows and indexes are
preserved.

## Tests

```bash
npm test
```

The suites cover keyword validation and scoping, the matcher's word-boundary
and phrase handling, ingest dedup and status flow, each source's normalization
and rate-limit/quota behaviour (with a mocked transport), scheduler failure
isolation, and the HTTP API. No network access is required.
