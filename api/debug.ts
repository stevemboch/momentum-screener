import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const pageRes = await fetch(
    'https://www.cashmarket.deutsche-boerse.com/cash-en/Data-Tech/statistics/etf-etp-statistics',
    { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)', 'Accept': 'text/html' } }
  )

  const html = await pageRes.text()

  // Find all download links
  const links = [...html.matchAll(/href="([^"]*\.(csv|xlsx|xls|zip)[^"]*)"/gi)]
    .map(m => m[1])

  // Also find any links mentioning AUM, TER, Fondsvermögen, Kennzahlen
  const relevantLinks = [...html.matchAll(/href="([^"]+)"[^>]*>[^<]*(?:aum|ter|fonds|kennzahl|statistic|etf|etp)[^<]*/gi)]
    .map(m => ({ href: m[1], text: m[0].slice(-50) }))

  // Raw text snippets around key terms
  const snippets = [...html.matchAll(/.{0,100}(?:fondsverm|ter|expense ratio|aum|kennzahl|\.csv|\.xlsx).{0,100}/gi)]
    .map(m => m[0]).slice(0, 15)

  return res.status(200).json({
    status: pageRes.status,
    download_links: links.slice(0, 20),
    relevant_links: relevantLinks.slice(0, 20),
    snippets,
  })
}
