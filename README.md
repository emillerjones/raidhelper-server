# Horizon: server

Express and PostgreSQL API behind [Horizon](https://raidhelper-client.vercel.app/), a shared raid calendar built from the Raid-Helper posts guilds already make in Discord. It receives events from the [Chrome extension](https://github.com/emillerjones/raidhelper-extension), stores one record per Raid-Helper event, and serves them to the [client](https://github.com/emillerjones/raidhelper-client).

## Data flow

```
Chrome extension ──POST /import──▶ upsert by event_id ──▶ raidhelper_events
                                                            │
client ◀──GET /imported, /stats, /summary───────────────────┘
```

Importing is idempotent: `raidhelper_events.event_id` is unique, and imports use `INSERT … ON CONFLICT (event_id) DO UPDATE`. Re-scanning a post refreshes its details instead of creating a duplicate, and each import reports how many events were inserted versus updated.

## API

All Horizon routes are under `/api/raidhelper`.

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/import` | Upsert a batch of raid events; returns inserted and updated counts |
| `GET` | `/imported` | All tracked events, for the calendar and radar |
| `GET` | `/stats` | Events for the stats page; also logs a page visit when `?page=` names an allowlisted page |
| `GET` | `/summary` | Public counts only (raids, guilds, raids in the next 7 days); cached for 5 minutes, records nothing |
| `POST` | `/visit` | Logs a page view for an allowlisted page name (Horizon and the portfolio site) |
| `POST` | `/extension-scans/start`, `/extension-scans/:id/complete` | Scan telemetry from the extension, when enabled in `app_settings` |
| `POST` | `/extension-feedback` | Bug reports and questions from the extension; validated and rate-limited |
| `GET` | `/events` | Fetches events directly from Raid-Helper's API for the configured key |

## Database

`db/schema.sql` creates:

- `raidhelper_events`: one row per Raid-Helper event, with the parsed fields plus the original `raw_json`
- `calendar_visits`: page-view analytics (page, route, a random per-browser visitor ID, IP address, user agent, referrer)
- `app_settings`: feature switches such as extension telemetry
- `extension_scan_runs`: scan telemetry
- `extension_feedback`: reports submitted from the extension

## Running locally

```bash
npm install
# .env
#   DATABASE_URL=postgres://...      (use a local or development database)
#   RAID_HELPER_API_KEY=...          (only needed for GET /events)
npm run db:schema    # apply db/schema.sql
npm run dev          # http://localhost:3000
```

## Deployment

Render runs the API; PostgreSQL is hosted on Neon. The client is deployed separately on Vercel.

## Also in this repo

`/api/smartish-import` (with `db/migrations/001_add_smartish_import.sql`, `services/smartishCsv.js` and `test/`) is a temporary, standalone CSV import tool, unrelated to Horizon. Its tests run with `npm run test:smartish`.
