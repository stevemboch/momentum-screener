import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from '../server/auth'

interface PriceResult {
  ticker: string
  longName: string | null
  currency: string | null
  closes: number[]
  highs: number[]
  lows: number[]
  volumes: number[]
  timestamps: number[]
  closesWeekly: number[]
  timestampsWeekly: number[]
  marketCap: number | null
  pe: number | null
  pb: number | null
  ebitda: number | null
  enterpriseValue: number | null
  returnOnAssets: number | null
  aum: number | null
  ter: number | null
  error?: string
}

type YahooProfile = 'stock' | 'fund'

async function fetchOneTicker(
  ticker: string,
  options?: { includeWeekly?: boolean; profile?: YahooProfile }
): Promise<PriceResult> {
  const includeWeekly = options?.includeWeekly !== false
  const profile: YahooProfile = options?.profile ?? 'stock'
  const quoteModules =
    profile === 'fund'
      ? 'price,summaryDetail,fundProfile'
      : 'price,defaultKeyStatistics,financialData,summaryDetail,fundProfile'

  const base: PriceResult = {
    ticker, longName: null, currency: null, closes: [], highs: [], lows: [], timestamps: [],
    volumes: [], closesWeekly: [], timestampsWeekly: [], marketCap: null,
    pe: null, pb: null, ebitda: null, enterpriseValue: null,
    returnOnAssets: null, aum: null, ter: null,
  }

  try {
    const [chartRes, quoteRes, weeklyRes] = await Promise.all([
      fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d&includePrePost=false`,
        { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)', 'Accept': 'application/json' } }
      ),
      fetch(
        `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${encodeURIComponent(quoteModules)}`,
        { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)', 'Accept': 'application/json' } }
      ),
      includeWeekly
        ? fetch(
            `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=7y&interval=1wk&includePrePost=false`,
            { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)', 'Accept': 'application/json' } }
          )
        : Promise.resolve(null),
    ])

    if (chartRes.ok) {
      const chartData = await chartRes.json()
      const result = chartData?.chart?.result?.[0]
      if (result) {
        const metaCurrency = result?.meta?.currency
        if (metaCurrency) base.currency = metaCurrency
        const timestamps: number[] = result.timestamp || []
        const quote = result.indicators?.quote?.[0] || {}
        const closesRaw: (number | null)[] = quote.close || []
        const highsRaw: (number | null)[]  = quote.high  || []
        const lowsRaw: (number | null)[]   = quote.low   || []
        const volumesRaw: (number | null)[] = quote.volume || []

        // Filter to rows where close is valid
        const validIdxs = timestamps
          .map((t: number, i: number) => ({ t, i }))
          .filter(({ i }) => closesRaw[i] != null && !isNaN(closesRaw[i]!))

        base.timestamps = validIdxs.map(({ t }) => t)
        base.closes     = validIdxs.map(({ i }) => closesRaw[i]!)
        base.highs      = validIdxs.map(({ i }) => highsRaw[i] ?? closesRaw[i]!)
        base.lows       = validIdxs.map(({ i }) => lowsRaw[i]  ?? closesRaw[i]!)
        base.volumes    = validIdxs.map(({ i }) => volumesRaw[i] ?? 0)
      }
    }

    if (weeklyRes?.ok) {
      const weeklyData = await weeklyRes.json()
      const result = weeklyData?.chart?.result?.[0]
      if (result) {
        const timestamps: number[] = result.timestamp || []
        const quote = result.indicators?.quote?.[0] || {}
        const closesRaw: (number | null)[] = quote.close || []

        const validIdxs = timestamps
          .map((t: number, i: number) => ({ t, i }))
          .filter(({ i }) => closesRaw[i] != null && !isNaN(closesRaw[i]!))

        base.timestampsWeekly = validIdxs.map(({ t }) => t)
        base.closesWeekly = validIdxs.map(({ i }) => closesRaw[i]!)
      }
    }

    if (quoteRes.ok) {
      const quoteData = await quoteRes.json()
      const summary = quoteData?.quoteSummary?.result?.[0]
      if (summary) {
        const price = summary.price || {}
        const ks = summary.defaultKeyStatistics || {}
        const fd = summary.financialData || {}
        const sd = summary.summaryDetail || {}
        const fp = summary.fundProfile || {}
        base.longName = price.longName ?? price.shortName ?? base.longName
        base.marketCap = price.marketCap?.raw ?? null
        base.pe = sd.trailingPE?.raw ?? ks.trailingPE?.raw ?? null
        base.pb = ks.priceToBook?.raw ?? null
        base.ebitda = fd.ebitda?.raw ?? null
        base.enterpriseValue = ks.enterpriseValue?.raw ?? null
        base.returnOnAssets = fd.returnOnAssets?.raw ?? null
        base.aum = sd.totalAssets?.raw ?? ks.totalAssets?.raw ?? null
        base.ter = fp.annualReportExpenseRatio?.raw ?? null
      }
    }
  } catch (err: any) {
    base.error = err.message
  }

  return base
}

async function runWithConcurrency<T>(
  items: string[], concurrency: number, fn: (item: string) => Promise<T>
): Promise<T[]> {
  const results: T[] = new Array(items.length)
  let index = 0
  async function worker() {
    while (index < items.length) {
      const i = index++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!requireAuth(req, res)) return
  const tickers: string[] = req.body?.tickers
  const includeWeekly = req.body?.includeWeekly !== false
  const profile: YahooProfile = req.body?.profile === 'fund' ? 'fund' : 'stock'
  if (!Array.isArray(tickers) || tickers.length === 0)
    return res.status(400).json({ error: 'tickers array required' })

  const concurrency = profile === 'fund' ? 10 : 8
  const results = await runWithConcurrency(
    tickers,
    concurrency,
    (ticker) => fetchOneTicker(ticker, { includeWeekly, profile })
  )
  return res.status(200).json(results)
}
