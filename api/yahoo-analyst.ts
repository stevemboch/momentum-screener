import type { VercelRequest, VercelResponse } from '@vercel/node'

interface AnalystResult {
  ticker: string
  recommendationMean: number | null
  recommendationKey: string | null
  numberOfAnalystOpinions: number | null
  targetMeanPrice: number | null
  targetLowPrice: number | null
  targetHighPrice: number | null
  currentPrice: number | null
  ebitda?: number | null
  enterpriseValue?: number | null
  returnOnAssets?: number | null
  pe?: number | null
  pb?: number | null
  source?: 'yahoo' | 'marketscreener' | 'optionsanalysissuite'
  error?: string
}

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const analystCache = new Map<string, { ts: number; data: AnalystResult }>()
const oasCooldownUntil = new Map<string, number>()

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function stripTicker(raw: string): string {
  return raw.split(/[.:]/)[0].toLowerCase()
}

function stripTickerUpper(raw: string): string {
  return raw.split(/[.:]/)[0].toUpperCase()
}

function parseMoney(text: string | null): number | null {
  if (!text) return null
  const cleaned = text.replace(/[,$]/g, '').replace(/[A-Za-z]+/g, '').trim()
  const val = Number(cleaned)
  return Number.isFinite(val) ? val : null
}

function parseRatio(text: string | null): number | null {
  if (!text) return null
  const cleaned = text.replace(/[^0-9.+-]/g, '').trim()
  if (!cleaned) return null
  const val = Number(cleaned)
  return Number.isFinite(val) ? val : null
}

function parseNumberWithSuffix(text: string | null): number | null {
  if (!text) return null
  const cleaned = text.replace(/[, ]/g, '').replace(/[$€£]/g, '').trim()
  const match = cleaned.match(/^([+-]?\d+(?:\.\d+)?)([KMBT])?$/i)
  if (!match) return null
  const num = Number(match[1])
  if (!Number.isFinite(num)) return null
  const suffix = match[2]?.toUpperCase()
  const mult = suffix === 'K' ? 1e3 : suffix === 'M' ? 1e6 : suffix === 'B' ? 1e9 : suffix === 'T' ? 1e12 : 1
  return num * mult
}

function getFromPairs(map: Map<string, string>, ...labels: string[]) {
  for (const l of labels) {
    const v = map.get(l)
    if (v != null && v !== '') return v
  }
  return null
}

async function fetchFromOptionAnalysisSuite(ticker: string): Promise<Partial<AnalystResult>> {
  const sym = stripTicker(ticker)
  const url = `https://www.optionsanalysissuite.com/stocks/${encodeURIComponent(sym)}/analyst-ratings`
  const headers = {
    'User-Agent': 'Mozilla/5.0 (compatible)',
    'Accept': 'text/html',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.optionsanalysissuite.com/',
  }
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`OptionsAnalysisSuite error: ${res.status}`)
  const html = await res.text()
  const tickerUpper = sym.toUpperCase()
  if (!html.toUpperCase().includes(tickerUpper)) {
    throw new Error('OptionsAnalysisSuite: ticker not found in page')
  }

  const consensusMatch = html.match(/Consensus:\s*([^<\n]+?)\s+from/i)
  const consensus = consensusMatch ? consensusMatch[1].trim() : null

  const avgMatch = html.match(/Average Target[\s\S]*?\$?([0-9,.]+)/i)
  const highMatch = html.match(/High[\s\S]*?\$?([0-9,.]+)/i)
  const lowMatch = html.match(/Low[\s\S]*?\$?([0-9,.]+)/i)

  return {
    recommendationKey: consensus ? consensus.toLowerCase() : null,
    targetMeanPrice: parseMoney(avgMatch?.[1] ?? null),
    targetHighPrice: parseMoney(highMatch?.[1] ?? null),
    targetLowPrice: parseMoney(lowMatch?.[1] ?? null),
  }
}

async function searchMarketScreener(ticker: string, type: string | null): Promise<string | null> {
  const searchParams = new URLSearchParams({
    page: '1',
    type: type ?? '',
    search: ticker,
    length: '10',
    page_origin: '',
    t: '',
  })
  const searchUrl = `https://www.marketscreener.com/async/search/advanced/instruments?${searchParams.toString()}`
  const headers = {
    'User-Agent': 'Mozilla/5.0 (compatible)',
    'Accept': 'text/html',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.marketscreener.com/',
  }
  const searchRes = await fetch(searchUrl, { headers })
  if (!searchRes.ok) return null
  const searchHtml = await searchRes.text()

  const rows = searchHtml.match(/<tr [\s\S]*?<\/tr>/g) || []
  const candidates = rows
    .filter((r) => r.includes('/quote/stock/'))
    .map((r) => {
      const linkMatch = r.match(/href="(\/quote\/stock\/[^"]+?)"/i)
      const symMatch = r.match(/<td class="table-child--w80[\s\S]*?>\s*([^<]+)\s*<\/td>/i)
      return { path: linkMatch?.[1], symbol: symMatch?.[1]?.trim() || '' }
    })
    .filter((c) => c.path)

  if (candidates.length === 0) return null
  const targetSym = stripTickerUpper(ticker)
  const best = candidates.find((c) => c.symbol.toUpperCase() === targetSym) || candidates[0]
  return best.path || null
}

async function searchMarketScreenerPage(ticker: string): Promise<string | null> {
  const searchUrl = `https://www.marketscreener.com/search/?q=${encodeURIComponent(ticker)}`
  const headers = {
    'User-Agent': 'Mozilla/5.0 (compatible)',
    'Accept': 'text/html',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.marketscreener.com/',
  }
  const res = await fetch(searchUrl, { headers })
  if (!res.ok) return null
  const html = await res.text()
  const linkMatch = html.match(/href="(\/quote\/stock\/[^"]+?)"/i)
  return linkMatch?.[1] || null
}

async function fetchFromMarketScreener(ticker: string): Promise<Partial<AnalystResult>> {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (compatible)',
    'Accept': 'text/html',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.marketscreener.com/',
  }
  const baseTicker = stripTickerUpper(ticker)
  const quotePath =
    (await searchMarketScreener(baseTicker, 'company')) ||
    (await searchMarketScreener(baseTicker, null)) ||
    (await searchMarketScreenerPage(baseTicker))
  if (!quotePath) throw new Error('MarketScreener: no quote link')

  const consensusUrl = `https://www.marketscreener.com${quotePath}consensus/`
  const consensusRes = await fetch(consensusUrl, { headers })
  if (!consensusRes.ok) throw new Error(`MarketScreener consensus error: ${consensusRes.status}`)
  const html = await consensusRes.text()
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i)
  const title = titleMatch?.[1]?.toUpperCase() || ''
  if (baseTicker) {
    const titleTickerMatch = title.match(/\|\s*([A-Z0-9.\-]{1,12})\s*\|/)
    if (titleTickerMatch && titleTickerMatch[1] && titleTickerMatch[1] !== baseTicker) {
      throw new Error('MarketScreener: ticker mismatch')
    }
  }

  const stripTags = (s: string) => s.replace(/<[^>]+>/g, '').trim()
  const extractPairs = (sourceHtml: string) => {
    const map = new Map<string, string>()
    const gridRe = /<div class="grid[^>]*>\s*<div class="c">([^<]+)<\/div>\s*<div class="c-auto[^>]*>([\s\S]*?)<\/div>/gi
    let m: RegExpExecArray | null
    while ((m = gridRe.exec(sourceHtml))) {
      const label = m[1].trim()
      const value = stripTags(m[2])
      map.set(label, value)
    }
    const trRe = /<tr[^>]*>\s*<t[dh][^>]*>\s*([^<]+)\s*<\/t[dh]>\s*<t[dh][^>]*>\s*([^<]+)\s*<\/t[dh]>\s*<\/tr>/gi
    while ((m = trRe.exec(sourceHtml))) {
      const label = stripTags(m[1])
      const value = stripTags(m[2])
      if (label && value) map.set(label, value)
    }
    return map
  }

  const pairs = extractPairs(html)

  const get = (...labels: string[]) => {
    for (const l of labels) {
      const v = pairs.get(l)
      if (v != null && v !== '') return v
    }
    return null
  }

  const getByIncludes = (needles: string[]) => {
    const n = needles.map((s) => s.toLowerCase())
    for (const [label, value] of pairs.entries()) {
      const l = label.toLowerCase()
      if (n.every((needle) => l.includes(needle))) return value
    }
    return null
  }

  const consensusText = get('Mean consensus', 'Consensus') || getByIncludes(['consensus'])
  const analystText = get('Number of Analysts', 'Number of analysts') || getByIncludes(['analyst'])
  const lastText = get('Last Close Price', 'Last Close') || getByIncludes(['last', 'close'])
  const avgText = get('Average target price', 'Average Target Price') || getByIncludes(['average', 'target'])
  const highText = get('High Price Target', 'High target price', 'Highest target price') || getByIncludes(['high', 'target'])
  const lowText = get('Low Price Target', 'Low target price', 'Lowest target price') || getByIncludes(['low', 'target'])

  // Fetch quote page for fundamentals like P/E and P/B
  let pe: number | null = null
  let pb: number | null = null
  let ebitda: number | null = null
  let enterpriseValue: number | null = null
  let returnOnAssets: number | null = null
  try {
    const quoteRes = await fetch(`https://www.marketscreener.com${quotePath}`, { headers })
    if (quoteRes.ok) {
      const quoteHtml = await quoteRes.text()
      const qPairs = extractPairs(quoteHtml)
      const peText = getFromPairs(qPairs, 'P/E ratio', 'P/E', 'P/E (LTM)', 'P/E (TTM)', 'Price/Earnings')
      const pbText = getFromPairs(qPairs, 'P/B ratio', 'P/B', 'Price/Book', 'P/BV', 'Price / Book')
      const evText = getFromPairs(qPairs, 'Enterprise Value', 'Enterprise value', 'EV')
      pe = parseRatio(peText)
      pb = parseRatio(pbText)
      enterpriseValue = parseNumberWithSuffix(evText)
    }
  } catch {
    // ignore fundamentals fetch errors
  }

  // Fetch ratios page for EBITDA / ROA if available
  try {
    const ratiosRes = await fetch(`https://www.marketscreener.com${quotePath}finances-ratios/`, { headers })
    if (ratiosRes.ok) {
      const ratiosHtml = await ratiosRes.text()
      const rPairs = extractPairs(ratiosHtml)
      const ebitdaText = getFromPairs(rPairs, 'EBITDA', 'EBITDA (LTM)', 'EBITDA (TTM)')
      const roaText = getFromPairs(rPairs, 'Return on Assets', 'ROA', 'Return on assets (ROA)')
      ebitda = parseNumberWithSuffix(ebitdaText)
      returnOnAssets = parseRatio(roaText)
    }
  } catch {
    // ignore ratio fetch errors
  }

  return {
    recommendationKey: consensusText ? consensusText.toLowerCase() : null,
    numberOfAnalystOpinions: analystText ? parseMoney(analystText) : null,
    targetMeanPrice: parseMoney(avgText),
    targetHighPrice: parseMoney(highText),
    targetLowPrice: parseMoney(lowText),
    currentPrice: parseMoney(lastText),
    ebitda,
    enterpriseValue,
    returnOnAssets,
    pe,
    pb,
  }
}

async function fetchFromOptionAnalysisSuiteWithRetry(ticker: string): Promise<Partial<AnalystResult>> {
  const sym = stripTicker(ticker)
  const maxAttempts = 3
  let lastErr: any = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const cooldownUntil = oasCooldownUntil.get(sym)
      if (cooldownUntil && Date.now() < cooldownUntil) {
        throw new Error('OptionsAnalysisSuite: cooldown active')
      }
      return await fetchFromOptionAnalysisSuite(sym)
    } catch (err: any) {
      lastErr = err
      if (String(err?.message || '').includes('OptionsAnalysisSuite error: 429')) {
        // Backoff and set short cooldown
        const backoff = 500 * attempt
        oasCooldownUntil.set(sym, Date.now() + 60_000)
        await sleep(backoff)
        continue
      }
      throw err
    }
  }
  throw lastErr || new Error('OptionsAnalysisSuite error')
}

async function fetchAnalyst(ticker: string, isin?: string): Promise<AnalystResult> {
  const base: AnalystResult = {
    ticker,
    recommendationMean: null,
    recommendationKey: null,
    numberOfAnalystOpinions: null,
    targetMeanPrice: null,
    targetLowPrice: null,
    targetHighPrice: null,
    currentPrice: null,
  }

  try {
    const urlBase = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=financialData,recommendationTrend`
    const headers = {
      'User-Agent': 'Mozilla/5.0 (compatible)',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'Origin': 'https://finance.yahoo.com',
      'Referer': 'https://finance.yahoo.com/',
    }

    let res = await fetch(urlBase, { headers })
    if (res.status === 401 || res.status === 403) {
      // Fallback to query2 host if query1 blocks
      res = await fetch(urlBase.replace('query1.', 'query2.'), { headers })
    }
    if (!res.ok) throw new Error(`Yahoo API error: ${res.status}`)
    const data = await res.json()
    const summary = data?.quoteSummary?.result?.[0]
    if (!summary) return base

    const fd = summary.financialData || {}
    const rt = summary.recommendationTrend || {}
    const trend0 = Array.isArray(rt.trend) ? rt.trend[0] : null

    base.recommendationMean = fd.recommendationMean?.raw ?? null
    base.recommendationKey = fd.recommendationKey ?? trend0?.trend ?? null
    base.numberOfAnalystOpinions = fd.numberOfAnalystOpinions?.raw ?? null
    base.targetMeanPrice = fd.targetMeanPrice?.raw ?? null
    base.targetLowPrice = fd.targetLowPrice?.raw ?? null
    base.targetHighPrice = fd.targetHighPrice?.raw ?? null
    base.currentPrice = fd.currentPrice?.raw ?? null
    base.source = 'yahoo'
  } catch (err: any) {
    // Fallback 1: MarketScreener (search by ticker)
    try {
      const ms = await fetchFromMarketScreener(ticker)
      const hasData =
        ms.recommendationKey != null ||
        ms.numberOfAnalystOpinions != null ||
        ms.targetMeanPrice != null ||
        ms.targetLowPrice != null ||
        ms.targetHighPrice != null ||
        ms.currentPrice != null ||
        ms.pe != null ||
        ms.pb != null ||
        ms.ebitda != null ||
        ms.enterpriseValue != null ||
        ms.returnOnAssets != null
      if (!hasData) throw new Error('MarketScreener: empty data')
      return {
        ...base,
        recommendationKey: ms.recommendationKey ?? null,
        numberOfAnalystOpinions: ms.numberOfAnalystOpinions ?? null,
        targetMeanPrice: ms.targetMeanPrice ?? null,
        targetLowPrice: ms.targetLowPrice ?? null,
        targetHighPrice: ms.targetHighPrice ?? null,
        currentPrice: ms.currentPrice ?? null,
        pe: ms.pe ?? null,
        pb: ms.pb ?? null,
        ebitda: ms.ebitda ?? null,
        enterpriseValue: ms.enterpriseValue ?? null,
        returnOnAssets: ms.returnOnAssets ?? null,
        source: 'marketscreener',
      }
    } catch (msErr: any) {
      // Fallback 2: OptionsAnalysisSuite (public HTML)
      try {
        const fallback = await fetchFromOptionAnalysisSuiteWithRetry(ticker)
        return {
          ...base,
          recommendationKey: fallback.recommendationKey ?? null,
          targetMeanPrice: fallback.targetMeanPrice ?? null,
          targetLowPrice: fallback.targetLowPrice ?? null,
          targetHighPrice: fallback.targetHighPrice ?? null,
          source: 'optionsanalysissuite',
        }
      } catch (fallbackErr: any) {
        base.error = [err?.message, msErr?.message, fallbackErr?.message].filter(Boolean).join(' | ')
      }
    }
  }

  return base
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const ticker: string | undefined = req.body?.ticker
  const isin: string | undefined = req.body?.isin
  if (!ticker) return res.status(400).json({ error: 'ticker required' })
  const cacheKey = `${ticker}`
  const cached = analystCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return res.status(200).json(cached.data)
  }
  const result = await fetchAnalyst(ticker, isin)
  analystCache.set(cacheKey, { ts: Date.now(), data: result })
  return res.status(200).json(result)
}
