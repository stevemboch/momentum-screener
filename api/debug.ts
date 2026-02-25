import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Deutsche Börse publishes ETF statistics including AUM and TER
  // Check what's available on their downloads page
  const pageUrl = 'https://www.cashmarket.deutsche-boerse.com/cash-en/trading/Tradable-Instruments-Xetra/Downloads'
  
  const pageRes = await fetch(pageUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible)', 'Accept': 'text/html' }
  })

  if (!pageRes.ok) {
    return res.status(502).json({ error: `Downloads page returned ${pageRes.status}` })
  }

  const html = await pageRes.text()

  // Find all CSV/Excel download links
  const links = [...html.matchAll(/href="([^"]*\.(csv|xlsx|xls)[^"]*)"/gi)]
    .map(m => m[1])
    .filter(l => l.toLowerCase().includes('xetr') || l.toLowerCase().includes('etf') || l.toLowerCase().includes('stat'))

  // Also look for any "statistics" or "kennzahlen" links
  const statLinks = [...html.matchAll(/href="([^"]*(?:statistic|kennzahl|etf-data|etf_data|fund)[^"]*)"/gi)]
    .map(m => m[1])

  return res.status(200).json({
    page_status: pageRes.status,
    csv_links: links.slice(0, 20),
    stat_links: statLinks.slice(0, 20),
    // Show raw snippet around "statistic" or "AUM" mentions
    aum_mentions: [...html.matchAll(/.{0,80}(?:aum|ter|expense|kennzahl|statistic).{0,80}/gi)]
      .map(m => m[0]).slice(0, 10),
  })
}
