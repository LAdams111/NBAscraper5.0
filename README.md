# Scraper-NBA

External NBA player-season scraper for [Hoop Central 5.0](https://github.com/your-org/HoopCentral-5.0). Fetches data from the [balldontlie](https://www.balldontlie.io) API and writes to Hoop Central through the ingestion HTTP API only — **never direct Postgres access**.

```
Scraper-NBA  →  POST /api/ingest/player-season  →  Hoop Central API  →  Postgres
```

## What this repo does

1. Fetches NBA player profiles and season averages from balldontlie
2. Determines the player's primary team for that season (from game logs)
3. Normalizes data into Hoop Central's ingest payload shape
4. POSTs one player-season row at a time (idempotent on re-run)

## What this repo does NOT do (yet)

- Scrape NBA.com directly
- Connect to Postgres
- Run a full league scrape by default (requires explicit `--all-players`)
- Provide birth dates or headshots (balldontlie does not expose these on the player endpoint)

## Requirements

- Node.js 20+
- Hoop Central API running (local or Railway)
- balldontlie API key

## Setup

```bash
cp .env.example .env
# Edit .env with your keys
npm install
```

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `HOOP_CENTRAL_API_URL` | Yes | Hoop Central API base URL (no trailing slash) |
| `INGEST_API_KEY` | No | Sent as `x-ingest-api-key` when set |
| `BALLDONTLIE_API_KEY` | Yes | balldontlie API key |
| `SCRAPE_REQUEST_DELAY_MS` | No | Delay between API calls (default `250`) |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run typecheck` | TypeScript check |
| `npm run build` | Compile to `dist/` |
| `npm run scrape -- --help` | Show CLI options |
| `npm run scrape:dry-run -- --test` | Test transform without POST |
| `npm run scrape -- --test` | Live ingest for 4 test players |

## Local workflow with Hoop Central

**Terminal 1 — Hoop Central**

```bash
cd HoopCentral-5.0
npm install
npm run db:migrate
npm run db:seed
npm run dev   # API :3001, frontend :5173
```

**Terminal 2 — this scraper**

```bash
cp .env.example .env
# HOOP_CENTRAL_API_URL=http://localhost:3001
# BALLDONTLIE_API_KEY=your-key

npm run scrape:dry-run -- --test --season 2024-25   # verify payloads
npm run scrape -- --test --season 2024-25           # POST to Hoop Central
npm run scrape -- --test --season 2024-25           # re-run — should reuse players
```

Verify in Hoop Central:

```bash
curl "http://localhost:3001/api/players?q=LeBron"
# Browse http://localhost:5173
```

## CLI examples

```bash
# Health check
npm run scrape -- --health

# Single player dry-run
npm run scrape:dry-run -- --player-ids 237 --season 2024-25

# Search by name
npm run scrape:dry-run -- --search "Nikola Jokic" --season 2024-25

# Small batch before full league run
npm run scrape:dry-run -- --all-players --limit 10 --season 2024-25

# Full career for one player (every season from draft year)
npm run scrape:dry-run -- --player-ids 1043 --all-seasons --season 2024-25
```

## Identity model

This scraper uses:

```json
{ "source": "balldontlie", "externalId": "237" }
```

balldontlie's native player ID is the stable `externalId`. This is separate from Hoop Central seed identities like `source: "seed", externalId: "2544"` (NBA.com ID for LeBron). Cross-linking those identities is a future Hoop Central feature — until then, balldontlie-ingested players appear as new canonical players.

## Stats stored

Hoop Central's ingest API currently accepts:

- `gamesPlayed`, `pointsPerGame`, `reboundsPerGame`, `assistsPerGame`

balldontlie also provides steals, blocks, shooting splits, etc., but those are not sent until Hoop Central expands the ingest schema.

## Player profile fields

| Field | Source |
|-------|--------|
| displayName | balldontlie first + last name |
| position | balldontlie position |
| heightCm | converted from `"6-9"` format |
| weightKg | converted from pounds |
| hometown | college, or country as fallback |
| birthDate | not available — omitted |
| headshotUrl | not available — omitted |

## Team slugs

Team slugs are generated to match Hoop Central's `nameToSlug` convention (e.g. `los-angeles-lakers`). Primary team for a season is determined by which team the player played the most games for (from game logs).

## Production (Railway)

This is a command-style scraper, not a long-running server.

- Set env vars on Railway: `HOOP_CENTRAL_API_URL`, `INGEST_API_KEY`, `BALLDONTLIE_API_KEY`
- Start command: `npm run scrape -- --all-players --season 2024-25`
- Or schedule via Railway cron / GitHub Actions

**Always test with `--test` or `--limit` before a full league run.**

## Future: all-time NBA players

Use `--all-players` with `--all-seasons` to attempt every player and every season from draft year through the target season. This will take a long time and many API calls — use rate limiting and run incrementally. Some historical players may be missing from balldontlie (e.g. Michael Jordan search returns empty).

## Architecture notes

- No monorepo coupling to Hoop Central
- No axios — native `fetch`
- Sequential POSTs for easier debugging
- Exit code `1` if any ingest fails

See Hoop Central docs: `docs/INGESTION_API.md`, `docs/INGESTION.md`.
