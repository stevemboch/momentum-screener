import type { VercelRequest, VercelResponse } from '@vercel/node'

interface PriceResult {
  ticker: string
  closes: number[]
  timestamps: number[]
  pe: number | null
  pb: number | null
  ebitda: number | null
  enterpriseValue: number | null
  returnOnAssets: number | null
  error?: string
}

async function fetchOneTicker(ticker: string): Promise<PriceResult> {
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
    // Fetch chart + fundamentals in parallel
    const [chartRes, quoteRes] = await Promise.all([
      fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d&includePrePost=false`,
        { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)', 'Accept': 'application/json' } }
      ),
      fetch(
        `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=defaultKeyStatistics,financialData,summaryDetail`,
        { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)', 'Accept': 'application/json' } }
      ),
    ])

    if (chartRes.ok) {
      const chartData = await chartRes.json()
      const result = chartData?.chart?.result?.[0]
      if (result) {
        const timestamps: number[] = result.timestamp || []
        const closes: number[] = result.indicators?.quote?.[0]?.close || []
        const validPairs = timestamps
          .map((t: number, i: number) => ({ t, c: closes[i] }))
          .filter((p) => p.c != null && !isNaN(p.c))
        base.timestamps = validPairs.map((p) => p.t)
        base.closes = validPairs.map((p) => p.c)
      }
    }

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

async function runWithConcurrency<T>(
  items: string[],
  concurrency: number,
  fn: (item: string) => Promise<T>
): Promise<T[]> {
  const results: T[] = new Array(items.length)
  let index = 0

  async function worker() {
    while (index < items.length) {
      const i = index++
      results[i] = await fn(items[i])
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker)
  await Promise.all(workers)
  return results
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const tickers: string[] = req.body?.tickers
  if (!Array.isArray(tickers) || tickers.length === 0) {
    return res.status(400).json({ error: 'tickers array required' })
  }

  // 5 concurrent tickers, each doing 2 parallel HTTP calls
  const results = await runWithConcurrency(tickers, 5, fetchOneTicker)
  return res.status(200).json(results)
}
