import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from '../server/auth'

async function findFrankfurtCSVUrl(): Promise<string | null> {
  try {
    const pageUrl = 'https://www.cashmarket.deutsche-boerse.com/cash-en/trading/Tradable-Instruments-Frankfurt/Downloads'
    const res = await fetch(pageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' },
    })
    if (!res.ok) return null
    const html = await res.text()

    // Find the T7 XFRA all tradable instruments CSV link
    const patterns = [
      /href="([^"]*t7[^"]*xfra[^"]*allTradable[^"]*\.csv[^"]*)"/i,
      /href="([^"]*frankfurt-instruments[^"]*\.csv[^"]*)"/i,
      /href="([^"]*T7.*XFRA.*\.csv[^"]*)"/i,
      /"(https?:\/\/[^"]*\.csv[^"]*xfra[^"]*)"/i,
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

    return null
  } catch {
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!requireAuth(req, res)) return

  // Try to find the current CSV URL from the downloads page
  let csvUrl = await findFrankfurtCSVUrl()

  // Fallback to a known working URL pattern if scraping fails
  if (!csvUrl) {
    csvUrl = 'https://www.cashmarket.deutsche-boerse.com/resource/blob/2289108/56273336b3d6bf87fa3d1b0cc641e3d9/data/t7-xfra-BF-allTradableInstruments.csv'
  }

  try {
    const csvRes = await fetch(csvUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible)',
        'Accept': 'text/csv,text/plain,*/*',
      },
    })

    if (!csvRes.ok) {
      return res.status(502).json({ error: `Failed to fetch Frankfurt CSV: HTTP ${csvRes.status}` })
    }

    const csvText = await csvRes.text()

    // Validate it looks like the right file
    if (!csvText.includes('XFRA') && !csvText.includes('ISIN')) {
      return res.status(502).json({ error: 'Downloaded file does not look like Frankfurt instrument list' })
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Cache-Control', 's-maxage=86400') // Cache for 24 hours on Vercel CDN
    return res.status(200).send(csvText)
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}
