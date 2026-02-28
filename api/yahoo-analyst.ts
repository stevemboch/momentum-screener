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
  error?: string
}

function stripTicker(raw: string): string {
  return raw.split(/[.:]/)[0].toLowerCase()
}

function parseMoney(text: string | null): number | null {
  if (!text) return null
  const cleaned = text.replace(/[,$]/g, '').trim()
  const val = Number(cleaned)
  return Number.isFinite(val) ? val : null
}

async function fetchFromOptionAnalysisSuite(ticker: string): Promise<Partial<AnalystResult>> {
  const sym = stripTicker(ticker)
  const url = `https://www.optionsanalysissuite.com/stocks/${encodeURIComponent(sym)}/analyst-ratings`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)', 'Accept': 'text/html' } })
  if (!res.ok) throw new Error(`OptionsAnalysisSuite error: ${res.status}`)
  const html = await res.text()

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

async function fetchFromMarketScreener(query: string): Promise<Partial<AnalystResult>> {
  const searchUrl = `https://www.marketscreener.com/search/?q=${encodeURIComponent(query)}`
  const searchRes = await fetch(searchUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)', 'Accept': 'text/html' } })
  if (!searchRes.ok) throw new Error(`MarketScreener search error: ${searchRes.status}`)
  const searchHtml = await searchRes.text()

  const linkMatch = searchHtml.match(/href="(\/quote\/stock\/[^"]+?)"/i)
  if (!linkMatch) throw new Error('MarketScreener: no quote link')
  const quotePath = linkMatch[1]

  const consensusUrl = `https://www.marketscreener.com${quotePath}consensus/`
  const consensusRes = await fetch(consensusUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)', 'Accept': 'text/html' } })
  if (!consensusRes.ok) throw new Error(`MarketScreener consensus error: ${consensusRes.status}`)
  const html = await consensusRes.text()

  const avgMatch = html.match(/Average target price<\/[^>]+>\s*<[^>]+>\s*([^<]+)/i)
  const highMatch = html.match(/High target price<\/[^>]+>\s*<[^>]+>\s*([^<]+)/i)
  const lowMatch = html.match(/Low target price<\/[^>]+>\s*<[^>]+>\s*([^<]+)/i)
  const lastMatch = html.match(/Last Close<\/[^>]+>\s*<[^>]+>\s*([^<]+)/i)
  const consensusMatch = html.match(/Consensus<\/[^>]+>\s*<[^>]+>\s*([^<]+)/i)
  const analystMatch = html.match(/Number of analysts<\/[^>]+>\s*<[^>]+>\s*([^<]+)/i)

  return {
    recommendationKey: consensusMatch ? consensusMatch[1].trim().toLowerCase() : null,
    numberOfAnalystOpinions: analystMatch ? parseMoney(analystMatch[1]) : null,
    targetMeanPrice: parseMoney(avgMatch?.[1]?.trim() ?? null),
    targetHighPrice: parseMoney(highMatch?.[1]?.trim() ?? null),
    targetLowPrice: parseMoney(lowMatch?.[1]?.trim() ?? null),
    currentPrice: parseMoney(lastMatch?.[1]?.trim() ?? null),
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
  } catch (err: any) {
    // Fallback 1: scrape optionsanalysissuite.com (public HTML)
    try {
      const fallback = await fetchFromOptionAnalysisSuite(ticker)
      return {
        ...base,
        recommendationKey: fallback.recommendationKey ?? null,
        targetMeanPrice: fallback.targetMeanPrice ?? null,
        targetLowPrice: fallback.targetLowPrice ?? null,
        targetHighPrice: fallback.targetHighPrice ?? null,
      }
    } catch (fallbackErr: any) {
      // Fallback 2: MarketScreener (search by ISIN or ticker)
      try {
        const query = isin || ticker
        const ms = await fetchFromMarketScreener(query)
        return {
          ...base,
          recommendationKey: ms.recommendationKey ?? null,
          numberOfAnalystOpinions: ms.numberOfAnalystOpinions ?? null,
          targetMeanPrice: ms.targetMeanPrice ?? null,
          targetLowPrice: ms.targetLowPrice ?? null,
          targetHighPrice: ms.targetHighPrice ?? null,
          currentPrice: ms.currentPrice ?? null,
        }
      } catch (msErr: any) {
        base.error = err?.message || fallbackErr?.message || msErr?.message
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
  const result = await fetchAnalyst(ticker, isin)
  return res.status(200).json(result)
}
