import type { VercelRequest, VercelResponse } from '@vercel/node'

async function findXetraCSVUrl(): Promise<string | null> {
  try {
    const pageUrl = 'https://www.cashmarket.deutsche-boerse.com/cash-en/trading/Tradable-Instruments-Xetra/Downloads'
    const res = await fetch(pageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' },
    })
    if (!res.ok) return null
    const html = await res.text()

    // Find the T7 XETR all tradable instruments CSV link
    const patterns = [
      /href="([^"]*t7[^"]*xetr[^"]*allTradable[^"]*\.csv[^"]*)"/i,
      /href="([^"]*xetra-instruments[^"]*\.csv[^"]*)"/i,
      /href="([^"]*T7.*XETR.*\.csv[^"]*)"/i,
      /"(https?:\/\/[^"]*\.csv[^"]*xetr[^"]*)"/i,
    ]

    for (const pattern of patterns) {
      const match = html.match(pattern)
      if (match) {
        let url = match[1]
        if (url.startsWith('/')) {
          url = 'https://www.cashmarket.deutsche-boerse.com' + url
        }
        return url
      }
    }

    // Fallback: try known URL pattern
    return null
  } catch {
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  // Try to find the current CSV URL from the downloads page
  let csvUrl = await findXetraCSVUrl()

  // Fallback to a known working URL pattern if scraping fails
  if (!csvUrl) {
    // The URL changes daily – use a known recent one as fallback
    csvUrl = 'https://www.cashmarket.deutsche-boerse.com/resource/blob/3374916/a91ce3e4a8bfb60c79e0f7e0b7b80a4c/data/t7-xetr-allTradableInstruments.csv'
  }

  try {
    const csvRes = await fetch(csvUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible)',
        'Accept': 'text/csv,text/plain,*/*',
      },
    })

    if (!csvRes.ok) {
      return res.status(502).json({ error: `Failed to fetch Xetra CSV: HTTP ${csvRes.status}` })
    }

    const csvText = await csvRes.text()

    // Validate it looks like the right file
    if (!csvText.includes('XETR') && !csvText.includes('ISIN')) {
      return res.status(502).json({ error: 'Downloaded file does not look like Xetra instrument list' })
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Cache-Control', 's-maxage=3600') // Cache for 1 hour on Vercel CDN
    return res.status(200).send(csvText)
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
