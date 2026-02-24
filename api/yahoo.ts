import type { VercelRequest, VercelResponse } from '@vercel/node'

interface PriceResult {
  ticker: string
  closes: number[]        // daily closing prices, oldest first
  timestamps: number[]    // unix timestamps
  pe: number | null
  pb: number | null
  ebitda: number | null
  enterpriseValue: number | null
  returnOnAssets: number | null
  error?: string
}

async function fetchPrices(ticker: string): Promise<PriceResult> {
  const base: PriceResult = {
    ticker,
    closes: [],
    timestamps: [],
    pe: null,
    pb: null,
    ebitda: null,
    enterpriseValue: null,
    returnOnAssets: null,
  }

  try {
    // Fetch 6 months daily price data
    const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=6mo&interval=1d&includePrePost=false`
    const chartRes = await fetch(chartUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible)',
        'Accept': 'application/json',
      },
    })

    if (chartRes.ok) {
      const chartData = await chartRes.json()
      const result = chartData?.chart?.result?.[0]
      if (result) {
        base.timestamps = result.timestamp || []
        base.closes = result.indicators?.quote?.[0]?.close || []
        // Filter out null values
        const validPairs = base.timestamps
          .map((t: number, i: number) => ({ t, c: base.closes[i] }))
          .filter((p: any) => p.c != null && !isNaN(p.c))
        base.timestamps = validPairs.map((p: any) => p.t)
        base.closes = validPairs.map((p: any) => p.c)
      }
    }

    // Fetch fundamentals
    const quoteUrl = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=defaultKeyStatistics,financialData,summaryDetail`
    const quoteRes = await fetch(quoteUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible)',
        'Accept': 'application/json',
      },
    })

    if (quoteRes.ok) {
      const quoteData = await quoteRes.json()
      const summary = quoteData?.quoteSummary?.result?.[0]
      if (summary) {
        const ks = summary.defaultKeyStatistics || {}
        const fd = summary.financialData || {}
        const sd = summary.summaryDetail || {}

        base.pe = sd.trailingPE?.raw ?? ks.trailingPE?.raw ?? null
        base.pb = ks.priceToBook?.raw ?? null
        base.ebitda = fd.ebitda?.raw ?? null
        base.enterpriseValue = ks.enterpriseValue?.raw ?? null
        base.returnOnAssets = fd.returnOnAssets?.raw ?? null
      }
    }
  } catch (err: any) {
    base.error = err.message
  }

  return base
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const tickers: string[] = req.body?.tickers
  if (!Array.isArray(tickers) || tickers.length === 0) {
    return res.status(400).json({ error: 'tickers array required' })
  }

  const results: PriceResult[] = []

  // Process tickers with small delay to avoid rate limiting
  for (let i = 0; i < tickers.length; i++) {
    const result = await fetchPrices(tickers[i])
    results.push(result)

    // 200ms delay between tickers
    if (i < tickers.length - 1) {
      await new Promise((r) => setTimeout(r, 200))
    }
  }

  return res.status(200).json(results)
}
