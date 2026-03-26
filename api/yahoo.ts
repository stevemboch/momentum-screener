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
  sector?: string | null
  industry?: string | null
  error?: string
}

type YahooProfile = 'stock' | 'fund'

const YAHOO_BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible)',
  'Accept-Language': 'en-US,en;q=0.9',
}

const YAHOO_API_HEADERS = {
  ...YAHOO_BASE_HEADERS,
  'Accept': 'application/json',
  'Origin': 'https://finance.yahoo.com',
  'Referer': 'https://finance.yahoo.com/',
}

const YAHOO_SESSION_TTL_MS = 15 * 60 * 1000
const YAHOO_SESSION_RETRY_COOLDOWN_MS = 60 * 1000

const YAHOO_CRUMB_HEADERS = {
  ...YAHOO_BASE_HEADERS,
  'Accept': 'text/plain,*/*;q=0.9',
}

interface YahooSession {
  cookieHeader: string
  crumb: string
  expiresAt: number
}

let yahooSessionCache: YahooSession | null = null
let yahooSessionPromise: Promise<YahooSession | null> | null = null
let yahooSessionRetryAfterTs = 0

function extractCookieHeader(res: Response): string | null {
  const anyHeaders = res.headers as any
  let setCookieValues: string[] = []
  if (typeof anyHeaders.getSetCookie === 'function') {
    const values = anyHeaders.getSetCookie()
    if (Array.isArray(values)) setCookieValues = values
  }
  if (setCookieValues.length === 0) {
    const raw = res.headers.get('set-cookie')
    if (raw) setCookieValues = raw.split(/,(?=[^;,]+=)/)
  }
  const cookiePairs = setCookieValues
    .map((v) => (v || '').split(';')[0]?.trim() || '')
    .filter(Boolean)
  return cookiePairs.length > 0 ? cookiePairs.join('; ') : null
}

async function getYahooSession(forceRefresh = false): Promise<YahooSession | null> {
  const now = Date.now()
  if (!forceRefresh && yahooSessionCache && yahooSessionCache.expiresAt > now) {
    return yahooSessionCache
  }
  if (!forceRefresh && now < yahooSessionRetryAfterTs) return null
  if (yahooSessionPromise) return yahooSessionPromise

  yahooSessionPromise = (async () => {
    try {
      const sessionRes = await fetch('https://fc.yahoo.com', { headers: YAHOO_CRUMB_HEADERS })
      const cookieHeader = extractCookieHeader(sessionRes)
      if (!cookieHeader) {
        yahooSessionRetryAfterTs = Date.now() + YAHOO_SESSION_RETRY_COOLDOWN_MS
        return null
      }

      const crumbUrls = [
        'https://query1.finance.yahoo.com/v1/test/getcrumb',
        'https://query2.finance.yahoo.com/v1/test/getcrumb',
      ]
      for (const url of crumbUrls) {
        try {
          const crumbRes = await fetch(url, { headers: { ...YAHOO_CRUMB_HEADERS, Cookie: cookieHeader } })
          if (!crumbRes.ok) continue
          const crumb = (await crumbRes.text()).trim()
          if (!crumb || crumb.startsWith('{') || /unauthorized|not acceptable/i.test(crumb)) continue
          yahooSessionCache = {
            cookieHeader,
            crumb,
            expiresAt: Date.now() + YAHOO_SESSION_TTL_MS,
          }
          yahooSessionRetryAfterTs = 0
          return yahooSessionCache
        } catch {}
      }
    } catch {}
    yahooSessionRetryAfterTs = Date.now() + YAHOO_SESSION_RETRY_COOLDOWN_MS
    return null
  })().finally(() => {
    yahooSessionPromise = null
  })

  return yahooSessionPromise
}

async function fetchQuoteSummaryWithSession(
  ticker: string,
  quoteModules: string,
  session: YahooSession
): Promise<{ res: Response | null; authFailed: boolean }> {
  const hosts = ['query1', 'query2']
  let authFailed = false
  for (const host of hosts) {
    const url = `https://${host}.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${encodeURIComponent(quoteModules)}&crumb=${encodeURIComponent(session.crumb)}`
    try {
      const res = await fetch(url, { headers: { ...YAHOO_API_HEADERS, Cookie: session.cookieHeader } })
      if (res.ok) return { res, authFailed: false }
      if (res.status === 401 || res.status === 403) authFailed = true
    } catch {}
  }
  return { res: null, authFailed }
}

async function fetchQuoteSummary(ticker: string, quoteModules: string): Promise<Response | null> {
  const session = await getYahooSession(false)
  if (session) {
    const fromSession = await fetchQuoteSummaryWithSession(ticker, quoteModules, session)
    if (fromSession.res) return fromSession.res
    if (fromSession.authFailed) {
      const refreshed = await getYahooSession(true)
      if (refreshed) {
        const fromRefreshed = await fetchQuoteSummaryWithSession(ticker, quoteModules, refreshed)
        if (fromRefreshed.res) return fromRefreshed.res
      }
    }
  }

  // Final fallback: legacy no-crumb calls (kept for compatibility with permissive Yahoo edges)
  const urls = [
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${encodeURIComponent(quoteModules)}`,
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${encodeURIComponent(quoteModules)}`,
  ]
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: YAHOO_API_HEADERS })
      if (r.ok) return r
    } catch {}
  }
  return null
}

async function fetchOneTicker(
  ticker: string,
  options?: { includeWeekly?: boolean; profile?: YahooProfile }
): Promise<PriceResult> {
  const includeWeekly = options?.includeWeekly !== false
  const profile: YahooProfile = options?.profile ?? 'stock'
  const quoteModules =
    profile === 'fund'
      ? 'price,summaryDetail,fundProfile,assetProfile'
      : 'price,defaultKeyStatistics,financialData,summaryDetail,fundProfile,assetProfile'

  const base: PriceResult = {
    ticker, longName: null, currency: null, closes: [], highs: [], lows: [], timestamps: [],
    volumes: [], closesWeekly: [], timestampsWeekly: [], marketCap: null,
    pe: null, pb: null, ebitda: null, enterpriseValue: null,
    returnOnAssets: null, aum: null, ter: null, sector: null, industry: null,
  }

  try {
    const [chartRes, quoteRes, weeklyRes, v7Res] = await Promise.all([
      fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d&includePrePost=false`,
        { headers: YAHOO_API_HEADERS }
      ),
      fetchQuoteSummary(ticker, quoteModules),
      includeWeekly
        ? fetch(
            `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=7y&interval=1wk&includePrePost=false`,
            { headers: YAHOO_API_HEADERS }
          )
        : Promise.resolve(null),
      // v7/finance/quote — works from server IPs, returns sector/industry for stocks
      profile !== 'fund'
        ? fetch(
            `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}&fields=sector,industry,longName`,
            { headers: YAHOO_API_HEADERS }
          ).catch(() => null)
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

    // v7/finance/quote — sector/industry for stocks (works when v10 is blocked)
    if (v7Res?.ok) {
      try {
        const v7Data = await v7Res.json()
        const q = v7Data?.quoteResponse?.result?.[0]
        if (q?.sector) base.sector = q.sector
        if (q?.industry) base.industry = q.industry
      } catch {}
    }

    if (quoteRes?.ok) {
      const quoteData = await quoteRes!.json()
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
        const ap = summary.assetProfile || {}
        // Only overwrite if assetProfile has a value (don't null out v7 result)
        if (ap.sector || ap.sectorDisp) base.sector = ap.sector ?? ap.sectorDisp
        if (ap.industry || ap.industryDisp) base.industry = ap.industry ?? ap.industryDisp
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
