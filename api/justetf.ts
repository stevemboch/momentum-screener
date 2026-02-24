import type { VercelRequest, VercelResponse } from '@vercel/node'

interface JustETFResult {
  isin: string
  aum: number | null       // raw EUR value e.g. 111477000000
  ter: number | null       // decimal percentage e.g. 0.2 = 0.20%
  name: string | null
  error?: string
}

function findInObject(obj: any, keys: string[]): any {
  if (!obj || typeof obj !== 'object') return undefined
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key]
  }
  for (const val of Object.values(obj)) {
    const found = findInObject(val, keys)
    if (found !== undefined) return found
  }
  return undefined
}

async function scrapeJustETF(isin: string): Promise<JustETFResult> {
  const url = `https://www.justetf.com/en/etf-profile.html?isin=${isin}`

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    })

    if (!response.ok) {
      return { isin, aum: null, ter: null, name: null, error: `HTTP ${response.status}` }
    }

    const html = await response.text()

    // Extract __NEXT_DATA__ JSON blob
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/)
    if (!match) {
      return { isin, aum: null, ter: null, name: null, error: 'No __NEXT_DATA__ found' }
    }

    let nextData: any
    try {
      nextData = JSON.parse(match[1])
    } catch {
      return { isin, aum: null, ter: null, name: null, error: 'JSON parse failed' }
    }

    // Detect homepage redirect (justETF blocks some requests)
    const pageTitle = findInObject(nextData, ['title', 'pageTitle'])
    if (typeof pageTitle === 'string' && pageTitle.toLowerCase().includes('etf screener')) {
      return { isin, aum: null, ter: null, name: null, error: 'Redirected to homepage' }
    }

    // Extract fields by searching recursively
    const aum = findInObject(nextData, ['fundSize', 'aum', 'totalAssets', 'fundVolume'])
    const ter = findInObject(nextData, ['ter', 'totalExpenseRatio', 'ongoingCharges', 'managementFee'])
    const name = findInObject(nextData, ['instrumentName', 'name', 'shortName', 'longName', 'fundName'])

    // Validate: AUM should be a large number (>0), TER should be small (0-5)
    const validAum = typeof aum === 'number' && aum > 0 ? aum : null
    const validTer = typeof ter === 'number' && ter >= 0 && ter <= 5 ? ter : null
    // TER is already a percentage (0.2 = 0.20%), do NOT multiply by 100
    const validName = typeof name === 'string' && name.length > 2 && !name.toLowerCase().includes('etf screener')
      ? name : null

    return { isin, aum: validAum, ter: validTer, name: validName }
  } catch (err: any) {
    return { isin, aum: null, ter: null, name: null, error: err.message }
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const isins: string[] = req.body?.isins
  if (!Array.isArray(isins) || isins.length === 0) {
    return res.status(400).json({ error: 'isins array required' })
  }

  // Process with 1 second delay between requests to avoid rate limiting
  // Max 30 per batch (enforced on client side, but we handle it here too)
  const results: JustETFResult[] = []

  for (let i = 0; i < Math.min(isins.length, 30); i++) {
    const result = await scrapeJustETF(isins[i])
    results.push(result)

    // 1 second delay between requests
    if (i < isins.length - 1) {
      await new Promise((r) => setTimeout(r, 1100))
    }
  }

  return res.status(200).json(results)
}
