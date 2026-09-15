import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from '../server/auth'
import { getIndexGlobalSnapshot } from '../server/universe'

const GETTEX_WEB_ORIGIN = 'https://www.gettex.de'
const GETTEX_DATA_ORIGIN = 'https://lseg-widgets.financial.com'
const GETTEX_SESSION_INSTRUMENT = 'DE0007664005' // Volkswagen; used only to obtain the website session.
const GETTEX_BATCH_SIZE = 50
const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{10}$/
const EODHD_US_SYMBOLS_URL = 'https://eodhd.com/api/exchange-symbol-list/US'
const DEUTSCHE_BOERSE_EQUITY_SEARCH_URL = 'https://api.live.deutsche-boerse.com/v1/search/equity_search'
const DEUTSCHE_BOERSE_PAGE_SIZE = 300 // The public endpoint caps larger values at 300.
const DEUTSCHE_BOERSE_EQUITY_COUNT = 15_230 // Updated from recordsTotal when a page is fetched.

type IsinResolverRequest = { key: string; ticker?: string; name?: string }
type IsinResolution = { isin: string; source: 'eodhd-us-symbols' | 'eodhd-id-mapping' | 'deutsche-boerse-search' }

let eodhdUsSymbolCache: { expiresAt: number; byTicker: Map<string, string> } | null = null
const EODHD_SYMBOL_CACHE_MS = 24 * 60 * 60 * 1000
type DeutscheBoerseEquity = { isin: string; name: string }
type DeutscheBoersePage = { expiresAt: number; total: number; rows: DeutscheBoerseEquity[] }
const deutscheBoersePages = new Map<number, Promise<DeutscheBoersePage>>()
const DEUTSCHE_BOERSE_PAGE_CACHE_MS = 24 * 60 * 60 * 1000

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

function normalizeIsin(value: unknown): string | null {
  const isin = String(value ?? '').trim().toUpperCase().replace(/[\s-]/g, '')
  return ISIN_RE.test(isin) ? isin : null
}

/** Search terms, not identity: omit legal forms and share-class boilerplate. */
function nameSearchTerms(value: string | undefined): string {
  return (value ?? '')
    .replace(/[(),.]/g, ' ')
    .replace(/\b(incorporated|inc|corp(?:oration)?|ltd|limited|plc|llc|l\.p|s\.a|ag|se|nv|holdings?|group|class|ordinary|shares?|stock|common|preferred|registered|bearer|dl|usd|eur|o\.n\.|vz|st)\b/gi, ' ')
    .replace(/\b[a-z]\s*class\b|\bclass\s*[a-z]\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tickerKey(value: string | undefined): string {
  return (value ?? '').trim().toUpperCase().replace(/\.[A-Z]{1,5}$/, '')
}

async function getEodhdUsSymbols(apiToken: string): Promise<Map<string, string>> {
  if (eodhdUsSymbolCache && eodhdUsSymbolCache.expiresAt > Date.now()) return eodhdUsSymbolCache.byTicker
  const params = new URLSearchParams({ api_token: apiToken, fmt: 'json' })
  const response = await fetch(`${EODHD_US_SYMBOLS_URL}?${params}`, { headers: { Accept: 'application/json' } })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !Array.isArray(payload)) throw new Error(`EODHD US symbol list unavailable (HTTP ${response.status})`)
  const byTicker = new Map<string, string>()
  for (const row of payload) {
    const ticker = tickerKey(typeof row?.Code === 'string' ? row.Code : row?.code)
    const isin = normalizeIsin(row?.Isin ?? row?.isin)
    if (ticker && isin) byTicker.set(ticker, isin)
  }
  eodhdUsSymbolCache = { expiresAt: Date.now() + EODHD_SYMBOL_CACHE_MS, byTicker }
  return byTicker
}

async function resolveEodhdIdentifier(ticker: string, apiToken: string): Promise<string | null> {
  const cleanTicker = tickerKey(ticker)
  const symbolsToTry = [`${cleanTicker}.US`, cleanTicker]
  for (const sym of symbolsToTry) {
    const params = new URLSearchParams({ 'filter[symbol]': sym, api_token: apiToken, fmt: 'json' })
    const response = await fetch(`https://eodhd.com/api/id-mapping?${params}`, { headers: { Accept: 'application/json' } })
    const payload = await response.json().catch(() => null) as { data?: Array<{ isin?: unknown }> } | null
    if (response.ok) {
      const isin = normalizeIsin(payload?.data?.[0]?.isin)
      if (isin) return isin
    }
  }
  return null
}

function normalizedCompanyName(value: string): string {
  return nameSearchTerms(value)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function companyNameScore(target: string, candidate: string, isin?: string): number {
  const targetTerms = nameSearchTerms(target)
  const candidateTerms = nameSearchTerms(candidate)
  const targetNorm = normalizedCompanyName(targetTerms)
  const candidateNorm = normalizedCompanyName(candidateTerms)

  const targetTokens = targetNorm.split(' ').filter((token) => token.length >= 2)
  const candidateTokens = candidateNorm.split(' ').filter((token) => token.length >= 2)
  if (targetTokens.length === 0 || candidateTokens.length === 0) return 0

  // Guard: First token must match
  if (!candidateTokens.some((token) => token === targetTokens[0] || token.startsWith(targetTokens[0]) || targetTokens[0].startsWith(token))) {
    return 0
  }

  let matches = 0
  for (const t of targetTokens) {
    if (candidateTokens.some((c) => c === t || c.startsWith(t) || t.startsWith(c))) {
      matches += 1
    }
  }

  // Dice / Sorensen similarity coefficient to penalize extra unwanted tokens in candidate
  let score = (2 * matches) / (targetTokens.length + candidateTokens.length)

  // Exact full normalized string match bonus
  if (targetNorm === candidateNorm) score += 0.5

  // Penalize ADR / CDR / secondary certificate derivatives if target did not specify ADR/CDR
  const isTargetAdr = /\b(adr|cdr|gdr|nvdr)\b/i.test(target)
  const isCandidateAdr = /\b(adr|adrs|cdr|cdrs|cdi|cdis|gdr|gdrs|nvdr|unsp|warrant|zertifikat)\b/i.test(candidate)
  if (!isTargetAdr && isCandidateAdr) {
    score -= 0.3
  }

  // If candidate ISIN matches German origin for German stocks, slight tie-breaker
  if (isin && isin.startsWith('DE') && /\b(ag|se|gmbh|kgaa)\b/i.test(candidate)) {
    score += 0.05
  }

  return score
}

async function getDeutscheBoerseEquityPage(pageNumber: number): Promise<DeutscheBoersePage> {
  const cached = deutscheBoersePages.get(pageNumber)
  if (cached) {
    const page = await cached
    if (page.expiresAt > Date.now()) return page
    deutscheBoersePages.delete(pageNumber)
  }
  const loading = (async (): Promise<DeutscheBoersePage> => {
    const response = await fetch(DEUTSCHE_BOERSE_EQUITY_SEARCH_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Origin: 'https://live.deutsche-boerse.com' },
      body: JSON.stringify({ lang: 'de', offset: pageNumber * DEUTSCHE_BOERSE_PAGE_SIZE, limit: DEUTSCHE_BOERSE_PAGE_SIZE, sorting: 'NAME', sortOrder: 'ASC' }),
    })
    const payload = await response.json().catch(() => null) as { recordsTotal?: unknown; data?: Array<{ isin?: unknown; name?: { originalValue?: unknown } }> } | null
    if (!response.ok || !Array.isArray(payload?.data)) throw new Error(`Deutsche Börse equity search unavailable (HTTP ${response.status})`)
    return {
      expiresAt: Date.now() + DEUTSCHE_BOERSE_PAGE_CACHE_MS,
      total: typeof payload.recordsTotal === 'number' ? payload.recordsTotal : DEUTSCHE_BOERSE_EQUITY_COUNT,
      rows: payload.data.flatMap((row) => {
        const isin = normalizeIsin(row?.isin)
        const name = typeof row?.name?.originalValue === 'string' ? row.name.originalValue : ''
        return isin && name ? [{ isin, name }] : []
      }),
    }
  })()
  deutscheBoersePages.set(pageNumber, loading)
  try { return await loading } catch (error) { deutscheBoersePages.delete(pageNumber); throw error }
}

/**
 * Public website fallback, intentionally best effort: this is not a documented
 * Deutsche-Börse API. The site's text-search endpoint is not usable from a
 * server, so use its working equity-search endpoint, navigate its alphabetical
 * result pages, and retain those pages in an in-memory 24-hour cache.
 */
async function resolveDeutscheBoerseSearch(name: string): Promise<string | null> {
  const terms = nameSearchTerms(name)
  if (!terms) return null
  const normalizedTerms = normalizedCompanyName(terms)
  let low = 0
  let high = Math.ceil(DEUTSCHE_BOERSE_EQUITY_COUNT / DEUTSCHE_BOERSE_PAGE_SIZE) - 1
  let page: DeutscheBoersePage | null = null
  let locatedPageNumber = 0
  // A binary search locates the alphabetical page in at most six requests.
  // Adjacent pages cover abbreviations and the few boundary cases.
  for (let attempt = 0; attempt < 6 && low <= high; attempt += 1) {
    const pageNumber = Math.floor((low + high) / 2)
    const candidate = await getDeutscheBoerseEquityPage(pageNumber)
    locatedPageNumber = pageNumber
    const first = normalizedCompanyName(candidate.rows[0]?.name ?? '')
    const last = normalizedCompanyName(candidate.rows.at(-1)?.name ?? '')
    page = candidate
    if (normalizedTerms < first) high = pageNumber - 1
    else if (normalizedTerms > last) low = pageNumber + 1
    else break
  }
  if (!page) return null
  const pages = await Promise.all([locatedPageNumber - 1, locatedPageNumber, locatedPageNumber + 1]
    .filter((number) => number >= 0 && number <= Math.ceil(page.total / DEUTSCHE_BOERSE_PAGE_SIZE) - 1)
    .map((number) => getDeutscheBoerseEquityPage(number)))
  const ranked = pages.flatMap((candidate) => candidate.rows)
    .map((candidate) => ({ ...candidate, score: companyNameScore(terms, candidate.name, candidate.isin) }))
    .sort((left, right) => right.score - left.score)
  const minimumScore = 0.5
  return ranked[0]?.score >= minimumScore ? ranked[0].isin : null
}

function readIsinResolverRequests(body: unknown): IsinResolverRequest[] {
  const entries = (body as { instruments?: unknown })?.instruments
  if (!Array.isArray(entries)) return []
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const row = entry as Record<string, unknown>
    return typeof row.key === 'string' && row.key.length > 0
      ? [{ key: row.key, ticker: typeof row.ticker === 'string' ? row.ticker : undefined, name: typeof row.name === 'string' ? row.name : undefined }]
      : []
  }).slice(0, 100)
}

async function handleIsinResolver(req: VercelRequest, res: VercelResponse) {
  const requests = readIsinResolverRequests(req.body)
  if (requests.length === 0) return res.status(400).json({ error: 'Provide instruments to resolve' })
  const resolutions: Record<string, IsinResolution> = {}
  const apiToken = process.env.EODHD_API_TOKEN
  let eodhdSymbols: Map<string, string> | null = null
  if (apiToken) {
    try { eodhdSymbols = await getEodhdUsSymbols(apiToken) } catch (error) { console.warn('EODHD symbol list failed:', error) }
  }

  const resolveOne = async (request: IsinResolverRequest) => {
    const ticker = tickerKey(request.ticker)
    const bulkIsin = ticker ? eodhdSymbols?.get(ticker) : null
    if (bulkIsin) {
      resolutions[request.key] = { isin: bulkIsin, source: 'eodhd-us-symbols' }
      return
    }
    if (apiToken && ticker) {
      try {
        const isin = await resolveEodhdIdentifier(ticker, apiToken)
        if (isin) {
          resolutions[request.key] = { isin, source: 'eodhd-id-mapping' }
          return
        }
      } catch (error) { console.warn('EODHD identifier lookup failed:', error) }
    }
    if (request.name) {
      try {
        const isin = await resolveDeutscheBoerseSearch(request.name)
        if (isin) {
          resolutions[request.key] = { isin, source: 'deutsche-boerse-search' }
          return
        }
      } catch (error) { console.warn('Deutsche Börse search fallback failed:', error) }
    }
  }

  // Process requests with bounded concurrency (8 parallel workers)
  let index = 0
  const concurrency = Math.min(8, requests.length)
  const workers = Array.from({ length: concurrency }, async () => {
    while (index < requests.length) {
      const current = requests[index++]
      await resolveOne(current)
    }
  })
  await Promise.all(workers)

  res.setHeader('Cache-Control', 'private, max-age=300')
  return res.status(200).json({ resolutions })
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
  if (req.query.resolveIsins === '1') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    return handleIsinResolver(req, res)
  }
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  // Keep the public Xetra endpoint and the global index universe in one
  // serverless function so the Hobby plan's 12-function limit is respected.
  if (req.query.universe === 'index_global') {
    try {
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400')
      const nasdaqVariant = req.query.nasdaq === 'composite' ? 'composite' : '100'
      return res.status(200).json(await getIndexGlobalSnapshot(nasdaqVariant))
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
