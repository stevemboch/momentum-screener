import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createGunzip, gunzipSync } from 'zlib'
import { Readable } from 'stream'
import { requireAuth } from '../server/auth'
import { getIndexGlobalSnapshot } from '../server/universe'

const GETTEX_PRETRADE_PAGE = 'https://www.gettex.de/handel/delayed-data/pretrade-data/'
// Shares occur at the beginning of the MUND snapshot (Apple, for example, is
// around line 145k). A hard cap prevents one unavailable ISIN from forcing a
// full multi-hundred-megabyte download and timing out the whole batch.
const GETTEX_MUND_MAX_LINES = 500_000

type GettexQuote = { bid: number; ask: number; spreadPct: number; time: string; currency: string }

function readRequestedGettexIsins(body: unknown): string[] {
  const candidate = (body as { isins?: unknown })?.isins
  if (!Array.isArray(candidate)) return []
  return [...new Set(candidate
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toUpperCase())
    .filter((value) => /^[A-Z]{2}[A-Z0-9]{10}$/.test(value)))]
    .slice(0, 60)
}

async function findGettex1700MuncFile(): Promise<string> {
  const response = await fetch(GETTEX_PRETRADE_PAGE, { headers: { 'User-Agent': 'Momentum-Screener/1.0' } })
  if (!response.ok) throw new Error(`Gettex index unavailable (HTTP ${response.status})`)
  const html = await response.text()
  const match = html.match(/href="(https:\/\/erdk\.bayerische-boerse\.de:8000\/[^\"]*pretrade\.\d{8}\.17\.00\.munc\.csv\.gz)"/i)
  if (!match) throw new Error('No Gettex MUNC pre-trade snapshot for 17:00 found')
  return match[1]
}

async function findGettex1700MundFile(): Promise<string> {
  const response = await fetch(GETTEX_PRETRADE_PAGE, { headers: { 'User-Agent': 'Momentum-Screener/1.0' } })
  if (!response.ok) throw new Error(`Gettex index unavailable (HTTP ${response.status})`)
  const html = await response.text()
  const match = html.match(/href="(https:\/\/erdk\.bayerische-boerse\.de:8000\/[^\"]*pretrade\.\d{8}\.17\.00\.mund\.csv\.gz)"/i)
  if (!match) throw new Error('No Gettex MUND pre-trade snapshot for 17:00 found')
  return match[1]
}

function parseGettexQuotes(csv: string, wanted: Set<string>): Record<string, GettexQuote> {
  const quotes: Record<string, GettexQuote> = {}
  for (const line of csv.split(/\r?\n/)) {
    const [isin, time, currency, bidRaw, , askRaw] = line.split(',')
    if (!isin || !wanted.has(isin)) continue
    const bid = Number(bidRaw)
    const ask = Number(askRaw)
    const mid = (bid + ask) / 2
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask < bid || mid <= 0) continue
    quotes[isin] = { bid, ask, spreadPct: ((ask - bid) / mid) * 100, time, currency }
  }
  return quotes
}

/**
 * MUND is the complete pre-trade feed (including international shares), but
 * can be very large. Read it as a stream and stop as soon as every missing
 * BOTSI ISIN has been found; never buffer or decompress the complete file.
 */
async function streamGettexMundQuotes(fileUrl: string, wanted: Set<string>): Promise<Record<string, GettexQuote>> {
  const response = await fetch(fileUrl, { headers: { 'User-Agent': 'Momentum-Screener/1.0' } })
  if (!response.ok || !response.body) throw new Error(`Gettex complete pre-trade file unavailable (HTTP ${response.status})`)

  const source = Readable.fromWeb(response.body as any)
  const gunzip = createGunzip()
  source.pipe(gunzip)
  const quotes: Record<string, GettexQuote> = {}
  let remainder = ''
  let processedLines = 0

  try {
    for await (const chunk of gunzip) {
      remainder += chunk.toString('utf8')
      const lines = remainder.split(/\r?\n/)
      remainder = lines.pop() ?? ''
      for (const line of lines) {
        processedLines += 1
        if (processedLines > GETTEX_MUND_MAX_LINES) return quotes
        const [isin, time, currency, bidRaw, , askRaw] = line.split(',')
        if (!isin || !wanted.has(isin)) continue
        const bid = Number(bidRaw)
        const ask = Number(askRaw)
        const mid = (bid + ask) / 2
        if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask < bid || mid <= 0) continue
        quotes[isin] = { bid, ask, spreadPct: ((ask - bid) / mid) * 100, time, currency }
        if (Object.keys(quotes).length === wanted.size) return quotes
      }
    }
    return quotes
  } finally {
    // Closing both streams also cancels an unfinished upstream download.
    source.destroy()
    gunzip.destroy()
  }
}

async function handleGettexSpreads(req: VercelRequest, res: VercelResponse) {
  const isins = readRequestedGettexIsins(req.body)
  if (isins.length === 0) return res.status(400).json({ error: 'Provide at least one valid ISIN' })
  try {
    const fileUrl = await findGettex1700MuncFile()
    const response = await fetch(fileUrl, { headers: { 'User-Agent': 'Momentum-Screener/1.0' } })
    if (!response.ok) throw new Error(`Gettex pre-trade file unavailable (HTTP ${response.status})`)
    const csv = gunzipSync(Buffer.from(await response.arrayBuffer())).toString('utf8')
    const quotes = parseGettexQuotes(csv, new Set(isins))
    const missingIsins = isins.filter((isin) => !quotes[isin])
    if (missingIsins.length > 0) {
      const completeFileUrl = await findGettex1700MundFile()
      Object.assign(quotes, await streamGettexMundQuotes(completeFileUrl, new Set(missingIsins)))
    }
    res.setHeader('Cache-Control', 'private, max-age=900')
    return res.status(200).json({ quotes, source: 'gettex-pretrade', fetchedAt: Date.now() })
  } catch (error: any) {
    return res.status(502).json({ error: error?.message ?? 'Gettex pre-trade data unavailable' })
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
