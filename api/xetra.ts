import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from '../server/auth'
import { getIndexGlobalSnapshot } from '../server/universe'

const GETTEX_WEB_ORIGIN = 'https://www.gettex.de'
const GETTEX_DATA_ORIGIN = 'https://lseg-widgets.financial.com'
const GETTEX_SESSION_INSTRUMENT = 'DE0007664005' // Volkswagen; used only to obtain the website session.
const GETTEX_BATCH_SIZE = 50

type GettexQuote = { bid: number; ask: number; spreadPct: number; time: string; currency: string }

function readRequestedGettexIsins(body: unknown): string[] {
  const candidate = (body as { isins?: unknown })?.isins
  if (!Array.isArray(candidate)) return []
  return [...new Set(candidate
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toUpperCase())
    .filter((value) => /^[A-Z]{2}[A-Z0-9]{10}$/.test(value)))]
    .slice(0, 100)
}

/** Obtain the short-lived session used by Gettex's own ISIN detail pages. */
async function getGettexWebToken(): Promise<string> {
  const page = await fetch(`${GETTEX_WEB_ORIGIN}/aktie/${GETTEX_SESSION_INSTRUMENT}/`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Momentum-Screener/1.0)' },
  })
  if (!page.ok) throw new Error(`Gettex instrument page unavailable (HTTP ${page.status})`)
  const html = await page.text()
  const saml = html.match(/const samlRequest=`([\s\S]*?)`;/)?.[1]
  if (!saml) throw new Error('Gettex website session was not found')

  const response = await fetch(`${GETTEX_DATA_ORIGIN}/auth/api/v1/sessions/samllogin?fetchToken=true`, {
    method: 'POST',
    headers: { Accept: '*/*', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `SAMLResponse=${encodeURIComponent(Buffer.from(saml).toString('base64'))}`,
  })
  const payload = await response.json().catch(() => null) as { token?: unknown } | null
  if (!response.ok || typeof payload?.token !== 'string') throw new Error(`Gettex quote session unavailable (HTTP ${response.status})`)
  return payload.token
}

async function fetchGettexWebQuotes(isins: string[]): Promise<Record<string, GettexQuote>> {
  const token = await getGettexWebToken()
  const quotes: Record<string, GettexQuote> = {}
  const time = new Date().toISOString()
  for (let index = 0; index < isins.length; index += GETTEX_BATCH_SIZE) {
    const search = isins.slice(index, index + GETTEX_BATCH_SIZE).join(',')
    const params = new URLSearchParams({
      fids: 'x._ISIN,q._BID,q._ASK', search, searchFor: 'ISIN', exchanges: 'GTX',
      pageSize: String(GETTEX_BATCH_SIZE), pageNo: '0',
    })
    const response = await fetch(`${GETTEX_DATA_ORIGIN}/rest/api/find/securities?${params}`, { headers: { jwt: token } })
    const payload = await response.json().catch(() => null) as { data?: Array<Record<string, unknown>> } | null
    if (!response.ok || !Array.isArray(payload?.data)) throw new Error(`Gettex quote lookup unavailable (HTTP ${response.status})`)
    for (const row of payload.data) {
      const isin = typeof row['x._ISIN'] === 'string' ? row['x._ISIN'].trim().toUpperCase() : ''
      const bid = Number(row['q._BID'])
      const ask = Number(row['q._ASK'])
      const mid = (bid + ask) / 2
      if (!isins.includes(isin) || !Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask < bid || mid <= 0) continue
      quotes[isin] = { bid, ask, spreadPct: ((ask - bid) / mid) * 100, time, currency: 'unknown' }
    }
  }
  return quotes
}

async function handleGettexSpreads(req: VercelRequest, res: VercelResponse) {
   const isins = readRequestedGettexIsins(req.body)
   if (isins.length === 0) return res.status(400).json({ error: 'Provide at least one valid ISIN' })
   try {
     const quotes = await fetchGettexWebQuotes(isins)
     res.setHeader('Cache-Control', 'private, max-age=60')
     return res.status(200).json({ quotes, source: 'gettex-web-isin-quote', fetchedAt: Date.now() })
   } catch (error: any) {
     return res.status(502).json({ error: error?.message ?? 'Gettex ISIN quotes unavailable' })
   }
 }

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
  if (!requireAuth(req, res)) return

  // Kept in this multi-purpose function to stay within Vercel Hobby's
  // serverless-function limit.
  if (req.query.gettexSpreads === '1') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    return handleGettexSpreads(req, res)
  }
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  // Keep the public Xetra endpoint and the global index universe in one
  // serverless function so the Hobby plan's 12-function limit is respected.
  if (req.query.universe === 'index_global') {
    try {
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400')
      return res.status(200).json(await getIndexGlobalSnapshot())
    } catch (error: any) {
      return res.status(502).json({ error: `Index universe import failed: ${error?.message ?? 'unknown error'}` })
    }
  }

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
