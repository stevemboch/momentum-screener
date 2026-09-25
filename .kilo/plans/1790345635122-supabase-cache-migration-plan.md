# Supabase Cache Migration Plan

## Goal
Add a persistent server-side cache (Supabase Postgres) for the momentum-screener universe and price data, reducing live API calls. Read-Through strategy in existing Vercel Functions preserves live fallback. No new Vercel Functions created (12-function limit preserved).

## Repository Context (verified)
- **12 API functions** in `api/`: ai-filter.ts, auth/[action].ts, claude-context.ts, claude-portfolio.ts, frankfurt.ts, openfigi.ts, portfolio-briefing.ts, tfa-catalyst.ts, xetra-stats.ts, xetra.ts, yahoo-analyst.ts, yahoo.ts
- **Key already-exported functions**: `getIndexGlobalSnapshot()` in `server/universe.ts:456`, `fetchOpenFigiBatch()` in `api/openfigi.ts:43`, `parseXetraCSV()` + `xetraRowToInstrument()` in `src/utils/parsers.ts:21/74`
- **Key NOT-yet-exported functions**: `fetchOneTicker()` (api/yahoo.ts:195), `resolveYahooSymbolByIsin()` (api/yahoo.ts:361), `getStatsMap()` (api/xetra-stats.ts:201), `findXetraCSVUrl()` (api/xetra.ts:465)
- **Browser globals**: None in `src/utils/dedup.ts` or `src/utils/calculations.ts` — safe for Node import
- **Missing dependencies**: `@supabase/supabase-js` (not installed), `ts-node` (not in devDependencies)
- **No existing** `.github/`, `scripts/`, `supabase/`, or `lib/` directories
- `vercel.json` configures `maxDuration`: xetra.ts=60s, xetra-stats.ts=60s, yahoo-analyst.ts=30s; yahoo.ts and xetra.ts are NOT listed (default 10s)

## Resolved Design Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | GET `/api/xetra` returns JSON from Supabase (not raw CSV) | CSV parsing already lives in `src/utils/parsers.ts`; `usePipeline.ts:apiXetra()` updated to consume JSON array instead of CSV text — minimal, well-isolated frontend change |
| 2 | `instrument_quote` table includes analyst fields as JSONB | `fetchOneTicker` returns analyst data in same response; ingestion stores it all; cache hits return complete `PriceResult` shape |
| 3 | Use `@supabase/supabase-js` with service role key in CI | Consistent with anon-key read / service-key write model; native upsert with `onConflict` |

## Corrected Claims from Original Concept
- `getStatsMap()` DOES have a TTL (6 hours: `CACHE_TTL = 6 * 60 * 60 * 1000`) — concept's claim of "no TTL" was wrong
- CSV parsing is in `src/utils/parsers.ts`, NOT in `api/xetra.ts` — extraction is only for the **fetch** logic (`findXetraCSVUrl` + CSV download)
- `api/universe.ts` / `api/quotes.ts` are NOT created — Read-Through goes into existing `api/xetra.ts`, `api/yahoo.ts`, `api/xetra-stats.ts`

## Ordered Task List

### Phase 0 — Dependencies & Supabase Setup
1. Add `@supabase/supabase-js` to `package.json` dependencies, `ts-node` to devDependencies
2. Run `npm install`
3. Create Supabase project (external step)
4. Create `supabase/migrations/0001_init.sql` with corrected schema (see Data Model below)
5. Create `lib/supabase.ts` with `supabaseAdmin` (service role, write) and `supabasePublic` (anon, read)

### Phase 1 — Export Core Functions (no behavior change)
1. Add `export` to `fetchOneTicker` in `api/yahoo.ts:195`
2. Add `export` to `resolveYahooSymbolByIsin` in `api/yahoo.ts:361`
3. Add `export` to `getStatsMap` in `api/xetra-stats.ts:201`
4. Add `export` to `findXetraCSVUrl` in `api/xetra.ts:465`
5. Verify `npm run build` passes (no API contract change)

### Phase 2 — Ingestion Scripts (pure Node CLI)
1. Create `scripts/ingest/universe-index.ts` — calls `getIndexGlobalSnapshot()`, upserts into `universe_snapshot` + `universe_constituent`, cleans old snapshots >30 days
2. Create `scripts/ingest/universe-legacy-xetra.ts` — calls `findXetraCSVUrl()`, downloads CSV, uses `parseXetraCSV` + `xetraRowToInstrument` from `src/utils/parsers.ts`, upserts into `universe_constituent`
3. Create `scripts/ingest/quotes.ts` — unions tickers from both snapshots + dedup winners + URTH + SPY/IEUR/EEM, calls `fetchOneTicker` per ticker, upserts into `instrument_quote`. Fixed concurrency 4 (stocks) / 6 (funds), 150-250ms between batches, p-retry with backoff (max 3 attempts), per-ticker error collection
4. Create `scripts/ingest/etf-stats.ts` — calls `getStatsMap()`, upserts into `etf_stats`, filters to ETF/ETC ISINs from current snapshots

### Phase 3 — GitHub Actions Workflows
1. Create `.github/workflows/ingest-universe.yml` — weekly cron `'17 4 * * 1'`, `concurrency: ingest-universe`, runs universe-index.ts + universe-legacy-xetra.ts
2. Create `.github/workflows/ingest-quotes.yml` — daily cron `'13 5 * * *'`, `concurrency: ingest-quotes`, `timeout-minutes: 180`, runs quotes.ts + etf-stats.ts
3. Create `.github/workflows/keepalive.yml` — daily cron `'41 3 * * *'`, pings Supabase REST to prevent 7-day pause
4. Create `INGESTION.md` documenting 5 required repo secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENFIGI_API_KEY`, `EODHD_API_TOKEN`, `SUPABASE_ANON_KEY`
5. Set repo secrets in GitHub (manual step)

### Phase 4 — Read-Through Cache in Vercel Functions
1. **`lib/supabase.ts`** — `supabasePublic` client using `SUPABASE_ANON_KEY` (server-only, never bundled to client)
2. **`api/xetra.ts`** GET `?universe=index_global` — behind `USE_SUPABASE_CACHE` flag: query `universe_snapshot` + `universe_constituent` by `(universe_code, nasdaq_variant, is_current=true)`, reconstruct `UniverseSnapshot` shape, `502` on 0 rows (preserves existing frontend stale-fallback)
3. **`api/xetra.ts`** GET (no query) — behind flag: query `universe_constituent` where `universe_code='legacy_xetra'` and `xetra_group IS NOT NULL`, return JSON array of `{isin, ticker, name, xetraGroup, ...}` (mappable to `parseXetraCSV` + `xetraRowToInstrument` output)
4. **`api/yahoo.ts`** POST ticker-batch — behind flag: group tickers by `yahoo_ticker`, batch-query `instrument_quote` in Supabase, merge with live fallback for cache misses. Live path unchanged.
5. **`api/xetra-stats.ts`** POST — behind flag: query `etf_stats` by ISIN array, live `getStatsMap()` fallback for misses only

### Phase 5 — Frontend Read-Through Adaptation
1. **`src/hooks/usePipeline.ts`** — `apiXetra()`: replace `apiFetchText('/api/xetra')` + `parseXetraCSV()` with `apiFetchJson('/api/xetra')` returning `Instrument[]`-compatible shape (when `USE_SUPABASE_CACHE` is on; server returns JSON). Keep CSV fallback when flag is off.
2. `apiIndexUniverse()` — no change needed (response shape unchanged)
3. `apiYahooBatch()` — no change needed (response shape unchanged)
4. `apiStats()` — no change needed (response shape unchanged)

### Phase 6 — Manual Refresh (Optional)
1. Add `?ingestionStatus=1` GET branch to `api/xetra.ts` (behind `requireAuth`)
2. Add `GITHUB_DISPATCH_TOKEN` Vercel secret (PAT with `actions:read`)
3. Add "Refresh Data" button in UI calling the status endpoint + GitHub dispatch API

### Phase 7 — Tests & Rollout
1. `npm run build` + `npx ts-node test-dedup.ts` after Phases 1, 4
2. Dry-run ingestion scripts against Supabase test project
3. RLS verification: anon key can SELECT, cannot INSERT/UPDATE/DELETE
4. End-to-end: empty localStorage + cache active → verify no live fetch delay
5. Fallback: pause Supabase → verify `readCachedSnapshot()` stale fallback works
6. Activate `USE_SUPABASE_CACHE` in Vercel Production
7. Monitor `ingestion_run` table + Vercel logs for 1-2 weeks

## Data Model (Corrected Schema)

```sql
-- universe_snapshot + universe_constituent: same as concept §4
-- instrument_quote: ADD analyst fields as JSONB
create table instrument_quote (
  yahoo_ticker      text primary key,
  isin              text,
  currency          text,
  long_name         text,
  closes            jsonb, highs jsonb, lows jsonb, volumes jsonb, timestamps jsonb,
  closes_weekly     jsonb, timestamps_weekly jsonb,
  market_cap        numeric, pe numeric, pb numeric, ebitda numeric,
  enterprise_value  numeric, return_on_assets numeric,
  aum               numeric, ter numeric,
  sector            text, industry text, profile text check (profile in ('stock','fund')),
  analyst_data      jsonb,          -- {rating, ratingKey, opinions, targetPrice, targetLow, targetHigh, currency, currentPrice, source}
  fetch_error       text,
  updated_at        timestamptz default now()
);
```

## Data Flow
```
GitHub Actions (daily/weekly cron)
  → scripts/ingest/*.ts
  → @supabase/supabase-js (service role key)
  → Supabase Postgres (upsert into 5 tables)

Browser
  → /api/* (cookie-authed Vercel Functions)
  → @supabase/supabase-js (anon key, server-side only)
  ← JSON (read-through, cache miss → live fallback)

Browser localStorage cache (keys: cache:yahoo:v5:*, cache:analyst:v7:*, universe:snapshot:index_global:v4)
  acts as L2 cache on top of Supabase L1
```

## Failure Modes & Mitigation

| Failure | Mitigation |
|---------|------------|
| Supabase paused after 7 days | keepalive.yml + daily ingestion job generates activity |
| Yahoo rate-limits from single CI IP | Fixed concurrency 4/6, 150-250ms delays, p-retry backoff, per-ticker error isolation |
| GitHub Actions scheduled delay (up to 60min) | Daily job is tolerant of 1h delay for momentum tool; offset cron from :00 |
| 12 Function limit exceeded | No new files — all Read-Through in existing handlers |
| Missing ingestion data (first deploy) | Read-Through returns 0 rows → API responds 502 → frontend stale-fallback (`readCachedSnapshot()`) activates |
| Ingestion data corruption | All data reproducible from external sources; next ingestion run overwrites via upsert |
| `fetchOneTicker` profile mismatch (stock vs fund) | `instrument_quote` stores both stock + fund fields in same row; `profile` column included to preserve fetch path metadata |

## Scopes NOT Cached (by design)
- Frankfurt/T7 universe (`api/frankfurt.ts`) — on-demand, low frequency
- Analyst enrichment (`api/yahoo-analyst.ts`, Leeway, Marketscreener) — per-instrument on-demand
- Gettex spreads/ISIN resolution — 60-300s volatility, too rapid
- TFA catalyst, KI-Filter, Portfolio Briefing, Claude Context — user-specific, on-demand
- Manual CSV/Ticker input — user-specific

## Validation Commands
```bash
npm install                          # after adding deps
npm run build                        # tsc + vite build — typecheck
npx ts-node test-dedup.ts            # dedup test unchanged
npx ts-node scripts/ingest/universe-index.ts --dry-run
npx ts-node scripts/ingest/quotes.ts --dry-run
```
