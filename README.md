# Momentum Screener

A web app that ranks ETFs and stocks from Xetra by momentum score, with deduplication, justETF fundamentals, and Yahoo Finance price data.

---

## Deploy (no terminal needed)

### 1. GitHub – Upload the code

1. Go to [github.com](https://github.com) → create a free account if needed
2. Click **"New repository"** → name it `momentum-screener` → **Create repository**
3. On the next page click **"uploading an existing file"**
4. Drag and drop the entire contents of this ZIP (unzipped) into the upload area
5. Click **"Commit changes"**

### 2. Vercel – Connect and deploy

1. Go to [vercel.com](https://vercel.com) → create a free account
2. Click **"Add New Project"** → **"Import Git Repository"**
3. Select your `momentum-screener` repo
4. Under **Environment Variables**, add:
   - Name: `OPENFIGI_API_KEY`
   - Value: your OpenFIGI key (get one free at [openfigi.com](https://openfigi.com))
5. Click **Deploy**

Your app will be live at `https://momentum-screener-xxx.vercel.app` in ~2 minutes.

---

## Get your OpenFIGI API key

1. Go to [openfigi.com](https://openfigi.com)
2. Click **"API"** → **"Get API key"**
3. Register with email
4. Copy the key and paste into Vercel environment variables

---

## Local development (optional)

Requires Node.js 18+:

```bash
npm install
npm run dev
```

Create a `.env.local` file:
```
OPENFIGI_API_KEY=your_key_here
```

---

## How it works

**Two input paths, one table:**

- **Manual input:** paste tickers / ISINs / WKNs or upload CSV → enriched via OpenFIGI → prices via Yahoo Finance
- **Xetra universe:** loads ~3,000 ETFs from Deutsche Börse, deduplicates to best-in-class per exposure, fetches TER + AUM from justETF

### Universe profiles

- **Index Global (default):** a union of STOXX Europe 600, S&P 500, MSCI Japan and MSCI Emerging Markets. Constituents are keyed by source ISIN when available, otherwise by an exchange-bound OpenFIGI identity; a title in more than one benchmark is emitted once with every membership retained.
- **Legacy Xetra:** preserves the existing T7/Xetra path as a separate listing-based universe. It is never an automatic fallback for an index screen.

Index Global imports use publicly accessible, versioned CSV holdings files that are configured at deployment. This makes their use explicit: an ETF holdings file is an `ETF_HOLDINGS_PROXY`, not an assertion that it is an official index constituent file. Use a physically replicating fund that names the intended benchmark, and verify its terms before automated use.

The importer ships with tested iShares Holdings endpoints for the four start
benchmarks. They provide ticker, name, sector, location and exchange, but not
consistently an ISIN. The server resolves each holding through OpenFIGI using
`ticker + exchange`. Since that API often omits ISINs for ticker mappings, a
candidate is accepted when it has either an ISIN or exactly one exchange-bound
equity FIGI. The server also derives the Yahoo ticker from that same exchange
(for example `7203.T`), so a later ticker-only lookup cannot change the listing.

These environment variables are optional overrides, for example when a
licensed or an ISIN-complete source becomes available:

```text
UNIVERSE_STOXX_EUROPE_600_CSV_URL=
UNIVERSE_SP_500_CSV_URL=
UNIVERSE_MSCI_JAPAN_CSV_URL=
UNIVERSE_MSCI_EM_CSV_URL=
```

The importer accepts `ISIN` when provided, otherwise `Ticker`/`Emittententicker`, `Name`, `Sector`, `Exchange`/`Börse`, `Country`/`Standort`, `Weight`, and `Asset Class`/`Anlageklasse`. It rejects files whose exact equity identity (ISIN or exchange-bound FIGI) resolution rate falls below 95%, or whose valid member count is outside the expected range. The browser stores the last successful, version-hashed snapshot; if an import fails, that exact snapshot is loaded with a visible `STALE fallback` status. If no prior snapshot exists, loading fails rather than silently switching to Xetra.

`Sector` is normalized to GICS for filtering. The original provider label is kept as `sourceSector`; generic source-country fields are never misrepresented as primary listing country. Region, primary-listing country, and GICS sector are independent filters in the UI.

**Scores:**
- **Momentum:** weighted return score across 1M / 3M / 6M (configurable weights)
- **Sharpe:** momentum score ÷ annualised volatility

Both scores shown as absolute value with rank in brackets, e.g. `0.124 (3)`.

---

## Data sources

| Source | Used for | Notes |
|---|---|---|
| Deutsche Börse / Xetra | Instrument universe | ~4,400 instruments, updated daily |
| OpenFIGI | Long names, instrument type | Free, 250 req/min with key |
| justETF | TER, AUM | Scraped from profile pages, server-side |
| Yahoo Finance | Prices, P/E, P/B, fundamentals | Free, no key needed |
