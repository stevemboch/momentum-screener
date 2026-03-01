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
  source?: 'yahoo' | 'marketscreener' | 'optionsanalysissuite'
  error?: string
}

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const analystCache = new Map<string, { ts: number; data: AnalystResult }>()

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

async function fetchFromMarketScreener(ticker: string): Promise<Partial<AnalystResult>> {
  const searchParams = new URLSearchParams({
    page: '1',
    type: 'company',
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
  if (!searchRes.ok) throw new Error(`MarketScreener search error: ${searchRes.status}`)
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

  if (candidates.length === 0) throw new Error('MarketScreener: no quote link')
  const targetSym = stripTickerUpper(ticker)
  const best = candidates.find((c) => c.symbol.toUpperCase() === targetSym) || candidates[0]
  const quotePath = best.path!

  const consensusUrl = `https://www.marketscreener.com${quotePath}consensus/`
  const consensusRes = await fetch(consensusUrl, { headers })
  if (!consensusRes.ok) throw new Error(`MarketScreener consensus error: ${consensusRes.status}`)
  const html = await consensusRes.text()

  const stripTags = (s: string) => s.replace(/<[^>]+>/g, '').trim()
  const pairs = new Map<string, string>()
  const rowRe = /<div class="grid[^>]*>\s*<div class="c">([^<]+)<\/div>\s*<div class="c-auto[^>]*>([\s\S]*?)<\/div>/gi
  let match: RegExpExecArray | null
  while ((match = rowRe.exec(html))) {
    const label = match[1].trim()
    const value = stripTags(match[2])
    pairs.set(label, value)
  }

  const get = (...labels: string[]) => {
    for (const l of labels) {
      const v = pairs.get(l)
      if (v != null && v !== '') return v
    }
    return null
  }

  const consensusText = get('Mean consensus', 'Consensus')
  const analystText = get('Number of Analysts', 'Number of analysts')
  const lastText = get('Last Close Price', 'Last Close')
  const avgText = get('Average target price', 'Average Target Price')
  const highText = get('High Price Target', 'High target price', 'Highest target price')
  const lowText = get('Low Price Target', 'Low target price', 'Lowest target price')

  return {
    recommendationKey: consensusText ? consensusText.toLowerCase() : null,
    numberOfAnalystOpinions: analystText ? parseMoney(analystText) : null,
    targetMeanPrice: parseMoney(avgText),
    targetHighPrice: parseMoney(highText),
    targetLowPrice: parseMoney(lowText),
    currentPrice: parseMoney(lastText),
  }
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
      const hasData = ms.recommendationKey != null || ms.numberOfAnalystOpinions != null ||
        ms.targetMeanPrice != null || ms.targetLowPrice != null || ms.targetHighPrice != null || ms.currentPrice != null
      if (!hasData) throw new Error('MarketScreener: empty data')
      return {
        ...base,
        recommendationKey: ms.recommendationKey ?? null,
        numberOfAnalystOpinions: ms.numberOfAnalystOpinions ?? null,
        targetMeanPrice: ms.targetMeanPrice ?? null,
        targetLowPrice: ms.targetLowPrice ?? null,
        targetHighPrice: ms.targetHighPrice ?? null,
        currentPrice: ms.currentPrice ?? null,
        source: 'marketscreener',
      }
    } catch (msErr: any) {
      // Fallback 2: OptionsAnalysisSuite (public HTML)
      try {
        const fallback = await fetchFromOptionAnalysisSuite(ticker)
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
