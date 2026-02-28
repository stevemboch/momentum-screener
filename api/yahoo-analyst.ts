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

async function fetchAnalyst(ticker: string): Promise<AnalystResult> {
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
    base.error = err.message
  }

  return base
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const ticker: string | undefined = req.body?.ticker
  if (!ticker) return res.status(400).json({ error: 'ticker required' })
  const result = await fetchAnalyst(ticker)
  return res.status(200).json(result)
}
