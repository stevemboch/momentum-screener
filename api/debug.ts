import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ticker = (req.query.ticker as string) || 'EUNL.DE'

  const [v7Res, v11Res] = await Promise.all([
    fetch(
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json', 'Referer': 'https://finance.yahoo.com' } }
    ),
    fetch(
      `https://query1.finance.yahoo.com/v11/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=summaryDetail,fundProfile,defaultKeyStatistics`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json', 'Referer': 'https://finance.yahoo.com' } }
    ),
  ])

  const v7Data = v7Res.ok ? await v7Res.json() : null
  const v11Data = v11Res.ok ? await v11Res.json() : null

  return res.status(200).json({
    v7_status: v7Res.status,
    v11_status: v11Res.status,
    v7_quote: v7Data?.quoteResponse?.result?.[0] ?? null,
    v11_summary: v11Data?.quoteSummary?.result?.[0] ?? null,
  })
}
