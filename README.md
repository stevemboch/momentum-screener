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
