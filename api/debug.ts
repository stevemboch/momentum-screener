import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ticker = (req.query.ticker as string) || 'EUNL.DE'

  const quoteRes = await fetch(
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=defaultKeyStatistics,financialData,summaryDetail,fundProfile`,
    { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)', 'Accept': 'application/json' } }
  )

  if (!quoteRes.ok) {
    return res.status(502).json({ error: `Yahoo returned ${quoteRes.status}` })
  }

  const data = await quoteRes.json()
  const summary = data?.quoteSummary?.result?.[0]

  // Return only the relevant fields, not the entire response
  return res.status(200).json({
    ticker,
    defaultKeyStatistics: summary?.defaultKeyStatistics ?? null,
    summaryDetail: summary?.summaryDetail ?? null,
    fundProfile: summary?.fundProfile ?? null,
  })
}
