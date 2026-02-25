import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ticker = (req.query.ticker as string) || 'EUNL.DE'

  // Test both endpoints
  const [chartRes, quoteRes, quoteV8Res] = await Promise.all([
    fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json' } }
    ),
    fetch(
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=summaryDetail,fundProfile`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json' } }
    ),
    fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d&includePrePost=false&events=div`,
      { headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://finance.yahoo.com',
        } 
      }
    ),
  ])

  const chartData = chartRes.ok ? await chartRes.json() : null
  const quoteData = quoteRes.ok ? await quoteRes.json() : null

  return res.status(200).json({
    chart_status: chartRes.status,
    quote_status: quoteRes.status,
    quote_v8_status: quoteV8Res.status,
    // If chart works, show what meta fields are available (contains some ETF data)
    chart_meta: chartData?.chart?.result?.[0]?.meta ?? null,
    // Quote summary if available
    summaryDetail: quoteData?.quoteSummary?.result?.[0]?.summaryDetail ?? null,
    fundProfile: quoteData?.quoteSummary?.result?.[0]?.fundProfile ?? null,
  })
}
