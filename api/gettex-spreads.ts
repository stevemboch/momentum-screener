import type { VercelRequest, VercelResponse } from '@vercel/node'
import { gunzipSync } from 'zlib'
import { requireAuth } from '../server/auth'

const PRETRADE_PAGE = 'https://www.gettex.de/handel/delayed-data/pretrade-data/'
const CACHE_SECONDS = 15 * 60

type Quote = { bid: number; ask: number; spreadPct: number; time: string; currency: string }

function readRequestedIsins(body: unknown): string[] {
  const candidate = (body as { isins?: unknown })?.isins
  if (!Array.isArray(candidate)) return []
  return [...new Set(candidate
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toUpperCase())
    .filter((value) => /^[A-Z]{2}[A-Z0-9]{10}$/.test(value)))]
    .slice(0, 60)
}

async function findLatestMuncFile(): Promise<string> {
  const response = await fetch(PRETRADE_PAGE, { headers: { 'User-Agent': 'Momentum-Screener/1.0' } })
  if (!response.ok) throw new Error(`Gettex index unavailable (HTTP ${response.status})`)
  const html = await response.text()
  // MUNC is the compact Gettex cash-market file. MUND also contains the much
  // larger derivatives universe and is intentionally not fetched here. Use
  // only the 17:00 snapshot; the page lists newest files first, so the first
  // match is today's export or otherwise the most recent trading day's one.
  const match = html.match(/href="(https:\/\/erdk\.bayerische-boerse\.de:8000\/[^\"]*pretrade\.\d{8}\.17\.00\.munc\.csv\.gz)"/i)
  if (!match) throw new Error('No Gettex MUNC pre-trade snapshot for 17:00 found')
  return match[1]
}

function parseQuotes(csv: string, wanted: Set<string>): Record<string, Quote> {
  const quotes: Record<string, Quote> = {}
  for (const line of csv.split(/\r?\n/)) {
    const [isin, time, currency, bidRaw, , askRaw] = line.split(',')
    if (!isin || !wanted.has(isin)) continue
    const bid = Number(bidRaw)
    const ask = Number(askRaw)
    const mid = (bid + ask) / 2
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask < bid || mid <= 0) continue
    // The file can have more than one update per instrument; retain the last.
    quotes[isin] = { bid, ask, spreadPct: ((ask - bid) / mid) * 100, time, currency }
  }
  return quotes
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!requireAuth(req, res)) return

  const isins = readRequestedIsins(req.body)
  if (isins.length === 0) return res.status(400).json({ error: 'Provide at least one valid ISIN' })

  try {
    const fileUrl = await findLatestMuncFile()
    const response = await fetch(fileUrl, { headers: { 'User-Agent': 'Momentum-Screener/1.0' } })
    if (!response.ok) throw new Error(`Gettex pre-trade file unavailable (HTTP ${response.status})`)
    const compressed = Buffer.from(await response.arrayBuffer())
    const csv = gunzipSync(compressed).toString('utf8')
    const quotes = parseQuotes(csv, new Set(isins))
    res.setHeader('Cache-Control', `private, max-age=${CACHE_SECONDS}`)
    return res.status(200).json({ quotes, source: 'gettex-pretrade', fetchedAt: Date.now() })
  } catch (error: any) {
    return res.status(502).json({ error: error?.message ?? 'Gettex pre-trade data unavailable' })
  }
}
