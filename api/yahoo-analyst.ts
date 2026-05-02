import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth } from '../server/auth'

interface AnalystResult {
  ticker: string
  recommendationMean: number | null
  recommendationKey: string | null
  numberOfAnalystOpinions: number | null
  targetMeanPrice: number | null
  targetLowPrice: number | null
  targetHighPrice: number | null
  currentPrice: number | null
  currency?: string | null
  financialCurrency?: string | null
  fxRate?: number | null
  fxBaseCurrency?: string | null
  fxTargetCurrency?: string | null
  ebitda?: number | null
  enterpriseValue?: number | null
  returnOnAssets?: number | null
  pe?: number | null
  pb?: number | null
  marketCap?: number | null
  resolvedTicker?: string | null
  targetOrigin?: 'yahoo' | 'leeway' | 'marketscreener' | 'optionsanalysissuite' | null
  currentOrigin?: 'yahoo' | 'leeway' | 'marketscreener' | 'optionsanalysissuite' | null
  source?: 'yahoo' | 'marketscreener' | 'optionsanalysissuite' | 'leeway'
  leewayUsed?: boolean
  error?: string
}

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const EMPTY_RESULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000
const analystCache = new Map<string, { ts: number; data: AnalystResult }>()
const oasCooldownUntil = new Map<string, number>()
const YAHOO_SESSION_TTL_MS = 15 * 60 * 1000
const YAHOO_SESSION_RETRY_COOLDOWN_MS = 60 * 1000
const YAHOO_REQUEST_TIMEOUT_MS = 6000

const YAHOO_BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible)',
  'Accept-Language': 'en-US,en;q=0.9',
}

const YAHOO_API_HEADERS = {
  ...YAHOO_BASE_HEADERS,
  'Accept': 'application/json',
  'Origin': 'https://finance.yahoo.com',
  'Referer': 'https://finance.yahoo.com/',
}

const YAHOO_CRUMB_HEADERS = {
  ...YAHOO_BASE_HEADERS,
  'Accept': 'text/plain,*/*;q=0.9',
}

interface YahooSession {
  cookieHeader: string
  crumb: string
  expiresAt: number
}

let yahooSessionCache: YahooSession | null = null
let yahooSessionPromise: Promise<YahooSession | null> | null = null
let yahooSessionRetryAfterTs = 0

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = YAHOO_REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function extractCookieHeader(res: Response): string | null {
  const anyHeaders = res.headers as any
  let setCookieValues: string[] = []
  if (typeof anyHeaders.getSetCookie === 'function') {
    const values = anyHeaders.getSetCookie()
    if (Array.isArray(values)) setCookieValues = values
  }
  if (setCookieValues.length === 0) {
    const raw = res.headers.get('set-cookie')
    if (raw) setCookieValues = raw.split(/,(?=[^;,]+=)/)
  }
  const cookiePairs = setCookieValues
    .map((v) => (v || '').split(';')[0]?.trim() || '')
    .filter(Boolean)
  return cookiePairs.length > 0 ? cookiePairs.join('; ') : null
}

async function getYahooSession(forceRefresh = false): Promise<YahooSession | null> {
  const now = Date.now()
  if (!forceRefresh && yahooSessionCache && yahooSessionCache.expiresAt > now) {
    return yahooSessionCache
  }
  if (!forceRefresh && now < yahooSessionRetryAfterTs) return null
  if (yahooSessionPromise) return yahooSessionPromise

  yahooSessionPromise = (async () => {
    try {
      const sessionRes = await fetchWithTimeout('https://fc.yahoo.com', { headers: YAHOO_CRUMB_HEADERS })
      const cookieHeader = extractCookieHeader(sessionRes)
      if (!cookieHeader) {
        yahooSessionRetryAfterTs = Date.now() + YAHOO_SESSION_RETRY_COOLDOWN_MS
        return null
      }

      const crumbUrls = [
        'https://query1.finance.yahoo.com/v1/test/getcrumb',
        'https://query2.finance.yahoo.com/v1/test/getcrumb',
      ]
      for (const url of crumbUrls) {
        try {
          const crumbRes = await fetchWithTimeout(url, { headers: { ...YAHOO_CRUMB_HEADERS, Cookie: cookieHeader } })
          if (!crumbRes.ok) continue
          const crumb = (await crumbRes.text()).trim()
          if (!crumb || crumb.startsWith('{') || /unauthorized|not acceptable/i.test(crumb)) continue
          yahooSessionCache = {
            cookieHeader,
            crumb,
            expiresAt: Date.now() + YAHOO_SESSION_TTL_MS,
          }
          yahooSessionRetryAfterTs = 0
          return yahooSessionCache
        } catch {}
      }
    } catch {}
    yahooSessionRetryAfterTs = Date.now() + YAHOO_SESSION_RETRY_COOLDOWN_MS
    return null
  })().finally(() => {
    yahooSessionPromise = null
  })

  return yahooSessionPromise
}

async function fetchYahooQuoteSummaryWithSession(
  ticker: string,
  modules: string,
  session: YahooSession
): Promise<{ res: Response | null; authFailed: boolean }> {
  const hosts = ['query1', 'query2']
  let authFailed = false
  for (const host of hosts) {
    const url = `https://${host}.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${encodeURIComponent(modules)}&crumb=${encodeURIComponent(session.crumb)}`
    try {
      const res = await fetchWithTimeout(url, { headers: { ...YAHOO_API_HEADERS, Cookie: session.cookieHeader } })
      if (res.ok) return { res, authFailed: false }
      if (res.status === 401 || res.status === 403) authFailed = true
    } catch {}
  }
  return { res: null, authFailed }
}

async function fetchYahooQuoteSummary(ticker: string, modules: string): Promise<Response | null> {
  const session = await getYahooSession(false)
  if (session) {
    const fromSession = await fetchYahooQuoteSummaryWithSession(ticker, modules, session)
    if (fromSession.res) return fromSession.res
    if (fromSession.authFailed) {
      const refreshed = await getYahooSession(true)
      if (refreshed) {
        const fromRefreshed = await fetchYahooQuoteSummaryWithSession(ticker, modules, refreshed)
        if (fromRefreshed.res) return fromRefreshed.res
      }
    }
  }

  const urls = [
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${encodeURIComponent(modules)}`,
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${encodeURIComponent(modules)}`,
  ]
  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url, { headers: YAHOO_API_HEADERS })
      if (res.ok) return res
    } catch {}
  }

  return null
}

function stripTicker(raw: string): string {
  return raw.split(/[.:]/)[0].toLowerCase()
}

function stripTickerUpper(raw: string): string {
  return raw.split(/[.:]/)[0].toUpperCase()
}

function normalizeMnemonic(raw?: string): string | null {
  if (!raw || typeof raw !== 'string') return null
  const normalized = raw.trim().toUpperCase()
  return normalized.length > 0 ? normalized : null
}

function buildAnalystCacheKey(ticker: string, mnemonic?: string, isin?: string, targetCurrency?: string): string {
  const normalizedTicker = ticker.trim().toUpperCase()
  const normalizedMnemonic = normalizeMnemonic(mnemonic)
  const mnemonicPart = normalizedMnemonic ?? '__NO_MNEMONIC__'
  const isinPart = (isin ?? '').trim().toUpperCase() || '__NO_ISIN__'
  const targetCurrencyPart = (targetCurrency ?? '').trim().toUpperCase() || '__NO_TARGET_CCY__'
  return `v2::${normalizedTicker}::${mnemonicPart}::${isinPart}::${targetCurrencyPart}`
}

function normalizeNameForMatch(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(inc|corp|corporation|ag|sa|plc|nv|holdings?|group|the|class)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isEntityNameMatch(expectedName: string | null | undefined, candidateName: string | null | undefined): boolean {
  const expected = normalizeNameForMatch(expectedName)
  const candidate = normalizeNameForMatch(candidateName)
  if (!expected || !candidate) return true
  if (expected === candidate) return true
  if (expected.includes(candidate) || candidate.includes(expected)) return true
  const expectedTokens = new Set(expected.split(' ').filter((t) => t.length >= 3))
  const candidateTokens = candidate.split(' ').filter((t) => t.length >= 3)
  if (expectedTokens.size === 0 || candidateTokens.length === 0) return true
  let overlap = 0
  for (const token of candidateTokens) if (expectedTokens.has(token)) overlap++
  return overlap >= Math.min(2, Math.max(1, Math.floor(Math.min(expectedTokens.size, candidateTokens.length) * 0.5)))
}

async function searchYahooSymbols(query: string): Promise<string[]> {
  const q = query.trim()
  if (!q) return []
  const urls = [
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`,
    `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`,
  ]
  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url, { headers: YAHOO_API_HEADERS })
      if (!res.ok) continue
      const data = await res.json()
      const quotes = Array.isArray(data?.quotes) ? data.quotes : []
      const symbols = quotes
        .map((item: any) => (typeof item?.symbol === 'string' ? item.symbol.trim() : ''))
        .filter((symbol: string) => symbol.length > 0)
      if (symbols.length > 0) return symbols
    } catch {}
  }
  return []
}

async function buildTickerCandidates(ticker: string, isin?: string, mnemonic?: string): Promise<string[]> {
  const ordered = new Set<string>()
  const add = (value: string | null | undefined) => {
    if (!value) return
    const symbol = value.trim().toUpperCase()
    if (symbol) ordered.add(symbol)
  }

  add(ticker)
  const base = stripTickerUpper(ticker)
  add(base)

  const m = normalizeMnemonic(mnemonic)
  if (m) {
    add(`${m}.DE`)
    add(m)
  }
  if (isin && isin.trim().length >= 6) {
    const byIsin = await searchYahooSymbols(isin.trim())
    byIsin.forEach(add)
  }
  if (m) {
    const byMnemonic = await searchYahooSymbols(m)
    byMnemonic.forEach(add)
  }
  if (base) {
    const byBase = await searchYahooSymbols(base)
    byBase.forEach(add)
  }
  return Array.from(ordered)
}

function parseMoney(text: string | null): number | null {
  if (!text) return null
  const raw = text.trim()
  if (!raw) return null

  // Keep digits + separators only (drop currency words/symbols around the value).
  let cleaned = raw.replace(/[^0-9.,+\-]/g, '')
  if (!cleaned) return null

  const hasDot = cleaned.includes('.')
  const hasComma = cleaned.includes(',')

  if (hasDot && hasComma) {
    // Mixed separators: last separator is assumed decimal mark.
    const lastDot = cleaned.lastIndexOf('.')
    const lastComma = cleaned.lastIndexOf(',')
    if (lastComma > lastDot) {
      // EU style: 1.234,56 -> 1234.56
      cleaned = cleaned.replace(/\./g, '').replace(',', '.')
    } else {
      // US style: 1,234.56 -> 1234.56
      cleaned = cleaned.replace(/,/g, '')
    }
  } else if (hasComma && !hasDot) {
    const parts = cleaned.split(',')
    const trailing = parts[parts.length - 1] ?? ''
    const integerPart = parts[0]?.replace(/[+\-]/g, '') ?? ''

    if (parts.length > 2) {
      // Repeated commas are most likely thousands grouping.
      cleaned = cleaned.replace(/,/g, '')
    } else if (trailing.length === 0) {
      cleaned = cleaned.replace(/,/g, '')
    } else if (trailing.length <= 2) {
      // Decimal comma (e.g. 111,00)
      cleaned = cleaned.replace(',', '.')
    } else if (trailing.length === 3 && integerPart.length <= 2) {
      // Common analyst quote style for sub-unit stocks (e.g. 1,110)
      cleaned = cleaned.replace(',', '.')
    } else {
      // Fallback: treat as thousands separator.
      cleaned = cleaned.replace(/,/g, '')
    }
  } else if (hasDot && !hasComma) {
    // Dot-only values are kept as-is (decimal or plain integer).
  }

  const val = Number(cleaned)
  return Number.isFinite(val) ? val : null
}

function parseRatio(text: string | null): number | null {
  if (!text) return null
  const cleaned = text.replace(/[^0-9.+-]/g, '').trim()
  if (!cleaned) return null
  const val = Number(cleaned)
  return Number.isFinite(val) ? val : null
}

function parseNumberWithSuffix(text: string | null): number | null {
  if (!text) return null
  const cleaned = text.replace(/[, ]/g, '').replace(/[$€£]/g, '').trim()
  const match = cleaned.match(/^([+-]?\d+(?:\.\d+)?)([KMBT])?$/i)
  if (!match) return null
  const num = Number(match[1])
  if (!Number.isFinite(num)) return null
  const suffix = match[2]?.toUpperCase()
  const mult = suffix === 'K' ? 1e3 : suffix === 'M' ? 1e6 : suffix === 'B' ? 1e9 : suffix === 'T' ? 1e12 : 1
  return num * mult
}

function inferCurrency(text: string | null): string | null {
  if (!text) return null
  const codeMatch = text.match(/\b[A-Z]{3}\b/)
  if (codeMatch) return codeMatch[0].toUpperCase()
  if (text.includes('€')) return 'EUR'
  if (text.includes('$')) return 'USD'
  if (text.includes('£')) return 'GBP'
  return null
}

type NormalizedCurrencyUnit = {
  code: string
  unitFactorToMajor: number
}

function normalizeCurrencyUnit(raw: string | null | undefined): NormalizedCurrencyUnit | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  // Keep common subunit notations case-sensitive before upper-casing.
  if (trimmed === 'GBp' || trimmed.toUpperCase() === 'GBX') return { code: 'GBP', unitFactorToMajor: 0.01 }
  if (trimmed === 'ZAc' || trimmed.toUpperCase() === 'ZAC') return { code: 'ZAR', unitFactorToMajor: 0.01 }
  const code = trimmed.toUpperCase()
  if (!code) return null
  return { code, unitFactorToMajor: 1 }
}

async function fetchYahooFxRateDirect(fromCode: string, toCode: string): Promise<number | null> {
  const directPair = `${fromCode}${toCode}=X`
  const inversePair = `${toCode}${fromCode}=X`
  const pairs: Array<{ symbol: string; invert: boolean }> = [
    { symbol: directPair, invert: false },
    { symbol: inversePair, invert: true },
  ]

  for (const { symbol, invert } of pairs) {
    const chartUrls = [
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d&includePrePost=false`,
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d&includePrePost=false`,
    ]
    for (const url of chartUrls) {
      try {
        const res = await fetchWithTimeout(url, { headers: YAHOO_API_HEADERS })
        if (!res.ok) continue
        const data = await res.json()
        const result = data?.chart?.result?.[0]
        const quote = result?.indicators?.quote?.[0]
        const close = Array.isArray(quote?.close)
          ? quote.close.filter((v: any) => v != null && !isNaN(v)).pop()
          : null
        if (typeof close === 'number' && Number.isFinite(close) && close > 0) {
          return invert ? 1 / close : close
        }
      } catch {}
    }

    const quoteUrls = [
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`,
      `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`,
    ]
    for (const url of quoteUrls) {
      try {
        const res = await fetchWithTimeout(url, { headers: YAHOO_API_HEADERS })
        if (!res.ok) continue
        const data = await res.json()
        const q = data?.quoteResponse?.result?.[0]
        const px = q?.regularMarketPrice
        if (typeof px === 'number' && Number.isFinite(px) && px > 0) {
          return invert ? 1 / px : px
        }
      } catch {}
    }
  }

  return null
}

async function fetchFrankfurterFxRate(fromCode: string, toCode: string): Promise<number | null> {
  const urls = [
    `https://api.frankfurter.app/latest?from=${encodeURIComponent(fromCode)}&to=${encodeURIComponent(toCode)}`,
    `https://api.frankfurter.app/latest?from=${encodeURIComponent(toCode)}&to=${encodeURIComponent(fromCode)}`,
  ]
  for (let i = 0; i < urls.length; i++) {
    const invert = i === 1
    try {
      const res = await fetchWithTimeout(urls[i], { headers: { Accept: 'application/json' } }, 5000)
      if (!res.ok) continue
      const data = await res.json()
      const rate = data?.rates?.[invert ? fromCode : toCode]
      if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
        return invert ? 1 / rate : rate
      }
    } catch {}
  }
  return null
}

async function deriveFxRate(fromCurrency: string | null | undefined, toCurrency: string | null | undefined): Promise<number | null> {
  const from = normalizeCurrencyUnit(fromCurrency)
  const to = normalizeCurrencyUnit(toCurrency)
  if (!from || !to) return null
  if (from.code === to.code) {
    return from.unitFactorToMajor / to.unitFactorToMajor
  }
  let marketRate = await fetchYahooFxRateDirect(from.code, to.code)
  if (marketRate == null) {
    marketRate = await fetchFrankfurterFxRate(from.code, to.code)
  }
  if (marketRate == null || !Number.isFinite(marketRate) || marketRate <= 0) return null
  // Convert from source quote unit into target quote unit.
  return marketRate * (from.unitFactorToMajor / to.unitFactorToMajor)
}

function hasAnalystSignal(result: Partial<AnalystResult> | null | undefined): boolean {
  if (!result) return false
  return (
    result.targetMeanPrice != null ||
    result.targetLowPrice != null ||
    result.targetHighPrice != null ||
    result.numberOfAnalystOpinions != null ||
    result.recommendationMean != null ||
    result.recommendationKey != null
  )
}

function hasTargetSignal(result: Partial<AnalystResult> | null | undefined): boolean {
  if (!result) return false
  return (
    result.targetMeanPrice != null ||
    result.targetLowPrice != null ||
    result.targetHighPrice != null
  )
}

function getFromPairs(map: Map<string, string>, ...labels: string[]) {
  for (const l of labels) {
    const v = map.get(l)
    if (v != null && v !== '') return v
  }
  return null
}

function stripHtml(text: string) {
  return text.replace(/<[^>]+>/g, '').replace(/\u00a0/g, ' ').trim()
}

function extractTableRowValues(html: string, labelRegex: RegExp): string[] | null {
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || []
  for (const row of rows) {
    const cells = row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi)
    if (!cells || cells.length < 2) continue
    const cellTexts = cells.map((c) => stripHtml(c))
    const label = cellTexts[0] || ''
    if (labelRegex.test(label)) {
      return cellTexts.slice(1).filter(Boolean)
    }
  }
  return null
}

function getByIncludes(map: Map<string, string>, needles: string[]) {
  const n = needles.map((s) => s.toLowerCase())
  for (const [label, value] of map.entries()) {
    const l = label.toLowerCase()
    if (n.every((needle) => l.includes(needle))) return value
  }
  return null
}

async function fetchFromOptionAnalysisSuite(ticker: string): Promise<Partial<AnalystResult>> {
  const sym = stripTicker(ticker)
  const url = `https://www.optionsanalysissuite.com/stocks/${encodeURIComponent(sym)}/analyst-ratings`
  const headers = {
    'User-Agent': 'Mozilla/5.0 (compatible)',
    'Accept': 'text/html',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.optionsanalysissuite.com/',
  }
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`OptionsAnalysisSuite error: ${res.status}`)
  const html = await res.text()
  const tickerUpper = sym.toUpperCase()
  if (!html.toUpperCase().includes(tickerUpper)) {
    throw new Error('OptionsAnalysisSuite: ticker not found in page')
  }

  const consensusMatch = html.match(/Consensus:\s*([^<\n]+?)\s+from/i)
  const consensus = consensusMatch ? consensusMatch[1].trim() : null

  const avgMatch = html.match(/Average Target[\s\S]*?\$?([0-9,.]+)/i)
  const highMatch = html.match(/High[\s\S]*?\$?([0-9,.]+)/i)
  const lowMatch = html.match(/Low[\s\S]*?\$?([0-9,.]+)/i)

  return {
    recommendationKey: consensus ? consensus.toLowerCase() : null,
    targetMeanPrice: parseMoney(avgMatch?.[1] ?? null),
    targetHighPrice: parseMoney(highMatch?.[1] ?? null),
    targetLowPrice: parseMoney(lowMatch?.[1] ?? null),
  }
}

async function searchMarketScreener(ticker: string, type: string | null): Promise<string | null> {
  const searchParams = new URLSearchParams({
    page: '1',
    type: type ?? '',
    search: ticker,
    length: '10',
    page_origin: '',
    t: '',
  })
  const searchUrl = `https://www.marketscreener.com/async/search/advanced/instruments?${searchParams.toString()}`
  const headers = {
    'User-Agent': 'Mozilla/5.0 (compatible)',
    'Accept': 'text/html',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.marketscreener.com/',
  }
  const searchRes = await fetch(searchUrl, { headers })
  if (!searchRes.ok) return null
  const searchHtml = await searchRes.text()

  const rows = searchHtml.match(/<tr [\s\S]*?<\/tr>/g) || []
  const candidates = rows
    .filter((r) => r.includes('/quote/stock/'))
    .map((r) => {
      const linkMatch = r.match(/href="(\/quote\/stock\/[^"]+?)"/i)
      const symMatch = r.match(/<td class="table-child--w80[\s\S]*?>\s*([^<]+)\s*<\/td>/i)
      return { path: linkMatch?.[1], symbol: symMatch?.[1]?.trim() || '' }
    })
    .filter((c) => c.path)

  if (candidates.length === 0) return null
  const targetSym = stripTickerUpper(ticker)
  const best = candidates.find((c) => c.symbol.toUpperCase() === targetSym) || candidates[0]
  return best.path || null
}

async function searchMarketScreenerPage(ticker: string): Promise<string | null> {
  const searchUrl = `https://www.marketscreener.com/search/?q=${encodeURIComponent(ticker)}`
  const headers = {
    'User-Agent': 'Mozilla/5.0 (compatible)',
    'Accept': 'text/html',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.marketscreener.com/',
  }
  const res = await fetch(searchUrl, { headers })
  if (!res.ok) return null
  const html = await res.text()
  const linkMatch = html.match(/href="(\/quote\/stock\/[^"]+?)"/i)
  return linkMatch?.[1] || null
}

async function fetchFromMarketScreener(ticker: string): Promise<Partial<AnalystResult>> {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (compatible)',
    'Accept': 'text/html',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.marketscreener.com/',
  }
  const baseTicker = stripTickerUpper(ticker)
  const quotePath =
    (await searchMarketScreener(baseTicker, 'company')) ||
    (await searchMarketScreener(baseTicker, null)) ||
    (await searchMarketScreenerPage(baseTicker))
  if (!quotePath) throw new Error('MarketScreener: no quote link')

  const consensusUrl = `https://www.marketscreener.com${quotePath}consensus/`
  const consensusRes = await fetch(consensusUrl, { headers })
  if (!consensusRes.ok) throw new Error(`MarketScreener consensus error: ${consensusRes.status}`)
  const html = await consensusRes.text()
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i)
  const title = titleMatch?.[1]?.toUpperCase() || ''
  if (baseTicker) {
    const titleTickerMatch = title.match(/\|\s*([A-Z0-9.\-]{1,12})\s*\|/)
    if (titleTickerMatch && titleTickerMatch[1] && titleTickerMatch[1] !== baseTicker) {
      throw new Error('MarketScreener: ticker mismatch')
    }
  }

  const stripTags = (s: string) => s.replace(/<[^>]+>/g, '').trim()
  const extractPairs = (sourceHtml: string) => {
    const map = new Map<string, string>()
    const gridRe = /<div class="grid[^>]*>\s*<div class="c">([^<]+)<\/div>\s*<div class="c-auto[^>]*>([\s\S]*?)<\/div>/gi
    let m: RegExpExecArray | null
    while ((m = gridRe.exec(sourceHtml))) {
      const label = m[1].trim()
      const value = stripTags(m[2])
      map.set(label, value)
    }
    const trRe = /<tr[^>]*>\s*<t[dh][^>]*>\s*([^<]+)\s*<\/t[dh]>\s*<t[dh][^>]*>\s*([^<]+)\s*<\/t[dh]>\s*<\/tr>/gi
    while ((m = trRe.exec(sourceHtml))) {
      const label = stripTags(m[1])
      const value = stripTags(m[2])
      if (label && value) map.set(label, value)
    }
    return map
  }

  const pairs = extractPairs(html)

  const get = (...labels: string[]) => {
    for (const l of labels) {
      const v = pairs.get(l)
      if (v != null && v !== '') return v
    }
    return null
  }

  const getByIncludesInPairs = (needles: string[]) => {
    const n = needles.map((s) => s.toLowerCase())
    for (const [label, value] of pairs.entries()) {
      const l = label.toLowerCase()
      if (n.every((needle) => l.includes(needle))) return value
    }
    return null
  }

  const consensusText = get('Mean consensus', 'Consensus') || getByIncludesInPairs(['consensus'])
  const analystText = get('Number of Analysts', 'Number of analysts') || getByIncludesInPairs(['analyst'])
  const lastText = get('Last Close Price', 'Last Close') || getByIncludesInPairs(['last', 'close'])
  const avgText = get('Average target price', 'Average Target Price') || getByIncludesInPairs(['average', 'target'])
  const highText = get('High Price Target', 'High target price', 'Highest target price') || getByIncludesInPairs(['high', 'target'])
  const lowText = get('Low Price Target', 'Low target price', 'Lowest target price') || getByIncludesInPairs(['low', 'target'])

  // Fetch quote page for fundamentals like P/E and P/B
  let pe: number | null = null
  let pb: number | null = null
  let ebitda: number | null = null
  let enterpriseValue: number | null = null
  let returnOnAssets: number | null = null
  let evToEbitda: number | null = null
  try {
    const quoteRes = await fetch(`https://www.marketscreener.com${quotePath}`, { headers })
    if (quoteRes.ok) {
      const quoteHtml = await quoteRes.text()
      const qPairs = extractPairs(quoteHtml)
      const peText = getFromPairs(qPairs, 'P/E ratio', 'P/E', 'P/E (LTM)', 'P/E (TTM)', 'Price/Earnings')
      const pbText = getFromPairs(qPairs, 'P/B ratio', 'P/B', 'Price/Book', 'P/BV', 'Price / Book')
      const evText = getFromPairs(qPairs, 'Enterprise Value', 'Enterprise value', 'EV')
      pe = parseRatio(peText)
      pb = parseRatio(pbText)
      enterpriseValue = parseNumberWithSuffix(evText)
    }
  } catch {
    // ignore fundamentals fetch errors
  }

  // Fetch valuation page for P/E, P/B, EV if not available
  try {
    const valuationRes = await fetch(`https://www.marketscreener.com${quotePath}valuation/`, { headers })
    if (valuationRes.ok) {
      const valuationHtml = await valuationRes.text()
      if (pe == null) {
        const peRow = extractTableRowValues(valuationHtml, /^P\/?E/i)
        pe = parseRatio(peRow?.[0] ?? null)
      }
      if (pb == null) {
        const pbRow = extractTableRowValues(valuationHtml, /price\s*to\s*book|p\/?b/i)
        pb = parseRatio(pbRow?.[0] ?? null)
      }
      if (enterpriseValue == null) {
        const evRow = extractTableRowValues(valuationHtml, /enterprise\s+value|EV\b/i)
        enterpriseValue = parseNumberWithSuffix(evRow?.[0] ?? null)
      }
      if (evToEbitda == null) {
        const evEbitdaRow = extractTableRowValues(valuationHtml, /EV\s*\/\s*EBITDA/i)
        evToEbitda = parseRatio(evEbitdaRow?.[0] ?? null)
      }
    }
  } catch {
    // ignore valuation fetch errors
  }

  // Fetch ratios page for EBITDA / ROA if available
  try {
    const ratiosRes = await fetch(`https://www.marketscreener.com${quotePath}finances-ratios/`, { headers })
    if (ratiosRes.ok) {
      const ratiosHtml = await ratiosRes.text()
      const rPairs = extractPairs(ratiosHtml)
      const ebitdaText = getFromPairs(rPairs, 'EBITDA', 'EBITDA (LTM)', 'EBITDA (TTM)') ||
        getByIncludes(rPairs, ['ebitda'])
      const roaText = getFromPairs(rPairs, 'Return on Assets', 'ROA', 'Return on assets (ROA)') ||
        getByIncludes(rPairs, ['return', 'assets']) ||
        getByIncludes(rPairs, ['roa'])
      ebitda = parseNumberWithSuffix(ebitdaText)
      returnOnAssets = parseRatio(roaText)
    }
  } catch {
    // ignore ratio fetch errors
  }

  // Derive EBITDA from EV and EV/EBITDA if needed
  if (ebitda == null && enterpriseValue != null && evToEbitda != null && evToEbitda !== 0) {
    ebitda = enterpriseValue / evToEbitda
  }

  return {
    recommendationKey: consensusText ? consensusText.toLowerCase() : null,
    numberOfAnalystOpinions: analystText ? parseMoney(analystText) : null,
    targetMeanPrice: parseMoney(avgText),
    targetHighPrice: parseMoney(highText),
    targetLowPrice: parseMoney(lowText),
    currentPrice: parseMoney(lastText),
    currency: inferCurrency(lastText) || inferCurrency(avgText) || inferCurrency(highText) || inferCurrency(lowText),
    financialCurrency: inferCurrency(lastText) || inferCurrency(avgText) || inferCurrency(highText) || inferCurrency(lowText),
    ebitda,
    enterpriseValue,
    returnOnAssets,
    pe,
    pb,
  }
}

async function fetchFromOptionAnalysisSuiteWithRetry(ticker: string): Promise<Partial<AnalystResult>> {
  const sym = stripTicker(ticker)
  const maxAttempts = 3
  let lastErr: any = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const cooldownUntil = oasCooldownUntil.get(sym)
      if (cooldownUntil && Date.now() < cooldownUntil) {
        throw new Error('OptionsAnalysisSuite: cooldown active')
      }
      return await fetchFromOptionAnalysisSuite(sym)
    } catch (err: any) {
      lastErr = err
      if (String(err?.message || '').includes('OptionsAnalysisSuite error: 429')) {
        // Backoff and set short cooldown
        const backoff = 500 * attempt
        oasCooldownUntil.set(sym, Date.now() + 60_000)
        await sleep(backoff)
        continue
      }
      throw err
    }
  }
  throw lastErr || new Error('OptionsAnalysisSuite error')
}

async function fetchFromLeeway(mnemonic: string): Promise<Partial<AnalystResult>> {
  const apiToken = process.env.LEEWAY_API_TOKEN
  if (!apiToken) throw new Error('LEEWAY_API_TOKEN not configured')

  const ticker = `${mnemonic.toUpperCase()}.XETRA`
  const url = `https://api.leeway.tech/api/v1/public/fundamentals/${encodeURIComponent(ticker)}?apitoken=${apiToken}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (res.status === 404) throw new Error(`Leeway: ${ticker} not found`)
  if (!res.ok) throw new Error(`Leeway error: ${res.status}`)

  const data = await res.json()
  const h = data?.Highlights ?? data?.highlights ?? {}

  const num = (v: any): number | null =>
    v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null

  const latestYearly = (section: any, ...fields: string[]): number | null => {
    if (!section || typeof section !== 'object') return null
    const keys = Object.keys(section).sort().reverse()
    for (const k of keys) {
      for (const f of fields) {
        const v = section[k]?.[f]
        if (v != null && v !== '' && Number.isFinite(Number(v))) return Number(v)
      }
    }
    return null
  }

  const incomeYearly = data?.Financials?.Income_Statement?.yearly
    ?? data?.financials?.income_statement?.yearly
    ?? {}

  const pe = num(h.PERatio ?? h.peRatio ?? h.PriceEarningsTTM ?? h.pe_ratio)
  const pb = num(h.PriceBookMRQ ?? h.priceBook ?? h.PriceBook ?? h.price_book)
  const marketCap = num(h.MarketCapitalization ?? h.marketCap ?? h.market_cap)
  const ebitda = num(h.EBITDA ?? h.ebitda) ?? latestYearly(incomeYearly, 'ebitda', 'EBITDA')
  const enterpriseValue = num(h.EnterpriseValue ?? h.enterpriseValue ?? h.enterprise_value)
  const returnOnAssets = num(h.ReturnOnAssetsTTM ?? h.returnOnAssets ?? h.return_on_assets)

  const analystData = data?.AnalystRatings ?? data?.analystRatings ?? h
  const strongBuy = num(analystData?.StrongBuy ?? analystData?.strong_buy) ?? 0
  const buy = num(analystData?.Buy ?? analystData?.buy) ?? 0
  const hold = num(analystData?.Hold ?? analystData?.hold) ?? 0
  const sell = num(analystData?.Sell ?? analystData?.sell) ?? 0
  const strongSell = num(analystData?.StrongSell ?? analystData?.strong_sell) ?? 0
  const total = strongBuy + buy + hold + sell + strongSell

  const recommendationMean = total > 0
    ? (strongBuy * 1 + buy * 2 + hold * 3 + sell * 4 + strongSell * 5) / total
    : null

  const recommendationKey = recommendationMean == null ? null
    : recommendationMean <= 1.5 ? 'strongbuy'
    : recommendationMean <= 2.5 ? 'buy'
    : recommendationMean <= 3.5 ? 'hold'
    : recommendationMean <= 4.5 ? 'sell'
    : 'strongsell'

  const targetMeanPrice = num(
    analystData?.TargetPrice
    ?? analystData?.targetPrice
    ?? analystData?.target_price
    ?? h.AnalystTargetPrice
    ?? h.analystTargetPrice
  )

  const result: Partial<AnalystResult> = {
    leewayUsed: true,
    source: 'leeway',
  }
  if (pe != null) result.pe = pe
  if (pb != null) result.pb = pb
  if (marketCap != null) result.marketCap = marketCap
  if (ebitda != null) result.ebitda = ebitda
  if (enterpriseValue != null) result.enterpriseValue = enterpriseValue
  if (returnOnAssets != null) result.returnOnAssets = returnOnAssets
  if (recommendationMean != null) result.recommendationMean = recommendationMean
  if (recommendationKey != null) result.recommendationKey = recommendationKey
  if (total > 0) result.numberOfAnalystOpinions = total
  if (targetMeanPrice != null) {
    result.targetMeanPrice = targetMeanPrice
    result.targetOrigin = 'leeway'
  }

  const hasUsefulData = pe != null || pb != null || marketCap != null || ebitda != null ||
    enterpriseValue != null || returnOnAssets != null ||
    recommendationMean != null || targetMeanPrice != null
  if (!hasUsefulData) throw new Error('Leeway: keine verwertbaren Daten in der Antwort')

  return result
}

async function applyFxRateForTarget(
  result: AnalystResult,
  targetCurrency: string | undefined,
): Promise<AnalystResult> {
  const normalizedTarget = typeof targetCurrency === 'string' ? targetCurrency.trim().toUpperCase() : ''
  if (!normalizedTarget || !result.financialCurrency) return result
  try {
    const fxRate = await deriveFxRate(result.financialCurrency, normalizedTarget)
    if (fxRate != null && Number.isFinite(fxRate) && fxRate > 0) {
      return {
        ...result,
        fxRate,
        fxBaseCurrency: result.financialCurrency.trim().toUpperCase(),
        fxTargetCurrency: normalizedTarget,
      }
    }
  } catch {
    // ignore FX fetch errors
  }
  return result
}

async function fetchAnalyst(
  ticker: string,
  isin?: string,
  mnemonic?: string,
  expectedName?: string,
  targetCurrency?: string,
): Promise<AnalystResult> {
  const base: AnalystResult = {
    ticker,
    recommendationMean: null,
    recommendationKey: null,
    numberOfAnalystOpinions: null,
    targetMeanPrice: null,
    targetLowPrice: null,
    targetHighPrice: null,
    currentPrice: null,
    currency: null,
    financialCurrency: null,
    fxRate: null,
    fxBaseCurrency: null,
    fxTargetCurrency: null,
    resolvedTicker: null,
    targetOrigin: null,
    currentOrigin: null,
  }

  // Leeway zuerst versuchen — liefert oft bessere Fundamentals + Analyst-Konsens.
  if (mnemonic) {
    try {
      const leeway = await fetchFromLeeway(mnemonic)
      Object.assign(base, leeway)
    } catch {
      // Leeway-Fehler still ignorieren, reguläre Fallback-Kette läuft weiter.
    }
  }

  try {
    const candidates = await buildTickerCandidates(ticker, isin, mnemonic)
    let yahooSuccess = false
    let lastYahooErr: any = null

    for (const candidateTicker of candidates) {
      try {
        const res = await fetchYahooQuoteSummary(candidateTicker, 'financialData,recommendationTrend,price')
        if (!res) throw new Error('Yahoo API unavailable')
        const data = await res.json()
        const summary = data?.quoteSummary?.result?.[0]
        if (!summary) throw new Error('Yahoo summary empty')

        const fd = summary.financialData || {}
        const price = summary.price || {}
        const rt = summary.recommendationTrend || {}
        const trend0 = Array.isArray(rt.trend) ? rt.trend[0] : null
        const quoteCurrency = typeof price.currency === 'string' ? price.currency.trim() : null
        const financialCurrency = typeof fd.financialCurrency === 'string' ? fd.financialCurrency.trim() : null
        const quoteUnit = normalizeCurrencyUnit(quoteCurrency)
        const financialUnit = normalizeCurrencyUnit(financialCurrency)
        const yahooValueScale =
          quoteUnit &&
          financialUnit &&
          quoteUnit.code === financialUnit.code &&
          quoteUnit.unitFactorToMajor > 0 &&
          financialUnit.unitFactorToMajor > 0
            ? (quoteUnit.unitFactorToMajor / financialUnit.unitFactorToMajor)
            : 1
        const scaleYahooValue = (v: any): number | null => {
          const raw = typeof v === 'number' ? v : null
          if (raw == null || !Number.isFinite(raw)) return null
          return raw * yahooValueScale
        }
        const quoteName: string | null = price.longName ?? price.shortName ?? null
        if (!isEntityNameMatch(expectedName, quoteName)) {
          throw new Error(`Yahoo entity mismatch: ${quoteName ?? 'unknown'}`)
        }

        if (base.recommendationMean == null) base.recommendationMean = fd.recommendationMean?.raw ?? null
        if (base.recommendationKey == null) base.recommendationKey = fd.recommendationKey ?? trend0?.trend ?? null
        if (base.numberOfAnalystOpinions == null) base.numberOfAnalystOpinions = fd.numberOfAnalystOpinions?.raw ?? null
        if (base.targetMeanPrice == null) {
          const yahooTarget = scaleYahooValue(fd.targetMeanPrice?.raw)
          if (yahooTarget != null) {
            base.targetMeanPrice = yahooTarget
            base.targetOrigin = 'yahoo'
          }
        }
        if (base.targetLowPrice == null) base.targetLowPrice = scaleYahooValue(fd.targetLowPrice?.raw)
        if (base.targetHighPrice == null) base.targetHighPrice = scaleYahooValue(fd.targetHighPrice?.raw)
        const yahooCurrent = scaleYahooValue(fd.currentPrice?.raw)
        if (yahooCurrent != null) {
          base.currentPrice = yahooCurrent
          base.currentOrigin = 'yahoo'
        } else {
          base.currentPrice = base.currentPrice ?? null
        }
        base.currency = quoteCurrency ?? base.currency ?? null
        base.financialCurrency = financialCurrency ?? base.financialCurrency ?? null
        base.resolvedTicker = candidateTicker
        if (!base.leewayUsed) base.source = 'yahoo'

        if (base.financialCurrency && base.currency && base.financialCurrency !== base.currency) {
          try {
            base.fxRate = await deriveFxRate(base.financialCurrency, base.currency)
          } catch {
            // ignore FX fetch errors
          }
        }

        yahooSuccess = true
        if (hasTargetSignal(base)) break
      } catch (err: any) {
        lastYahooErr = err
      }
    }

    if (!yahooSuccess) throw lastYahooErr ?? new Error('Yahoo candidate resolution failed')
    if (!hasTargetSignal(base)) throw new Error('Yahoo analyst target empty')
  } catch (err: any) {
    // Fallback 1: MarketScreener (search by ticker)
    try {
      const msTicker = base.resolvedTicker ?? ticker
      const ms = await fetchFromMarketScreener(msTicker)
      const hasData =
        ms.recommendationKey != null ||
        ms.numberOfAnalystOpinions != null ||
        ms.targetMeanPrice != null ||
        ms.targetLowPrice != null ||
        ms.targetHighPrice != null ||
        ms.currentPrice != null ||
        ms.pe != null ||
        ms.pb != null ||
        ms.ebitda != null ||
        ms.enterpriseValue != null ||
        ms.returnOnAssets != null
      if (!hasData) throw new Error('MarketScreener: empty data')
      const result: AnalystResult = {
        ...base,
        recommendationKey: base.recommendationKey ?? ms.recommendationKey ?? null,
        numberOfAnalystOpinions: base.numberOfAnalystOpinions ?? ms.numberOfAnalystOpinions ?? null,
        targetMeanPrice: base.targetMeanPrice ?? ms.targetMeanPrice ?? null,
        targetLowPrice: base.targetLowPrice ?? ms.targetLowPrice ?? null,
        targetHighPrice: base.targetHighPrice ?? ms.targetHighPrice ?? null,
        currentPrice: base.currentPrice ?? ms.currentPrice ?? null,
        targetOrigin: base.targetMeanPrice != null
          ? (base.targetOrigin ?? null)
          : (ms.targetMeanPrice != null ? 'marketscreener' : null),
        currentOrigin: base.currentPrice != null
          ? (base.currentOrigin ?? null)
          : (ms.currentPrice != null ? 'marketscreener' : null),
        financialCurrency: base.financialCurrency ?? ms.financialCurrency ?? ms.currency ?? null,
        pe: base.pe ?? ms.pe ?? null,
        pb: base.pb ?? ms.pb ?? null,
        ebitda: base.ebitda ?? ms.ebitda ?? null,
        enterpriseValue: base.enterpriseValue ?? ms.enterpriseValue ?? null,
        returnOnAssets: base.returnOnAssets ?? ms.returnOnAssets ?? null,
        source: base.leewayUsed ? 'leeway' : 'marketscreener',
      }
      return await applyFxRateForTarget(result, targetCurrency)
    } catch (msErr: any) {
      // Fallback 2: OptionsAnalysisSuite (public HTML)
      try {
        const fallbackTicker = base.resolvedTicker ?? ticker
        const fallback = await fetchFromOptionAnalysisSuiteWithRetry(fallbackTicker)
      const result: AnalystResult = {
        ...base,
        recommendationKey: base.recommendationKey ?? fallback.recommendationKey ?? null,
        targetMeanPrice: base.targetMeanPrice ?? fallback.targetMeanPrice ?? null,
        targetLowPrice: base.targetLowPrice ?? fallback.targetLowPrice ?? null,
        targetHighPrice: base.targetHighPrice ?? fallback.targetHighPrice ?? null,
        targetOrigin: base.targetMeanPrice != null
          ? (base.targetOrigin ?? null)
          : (fallback.targetMeanPrice != null ? 'optionsanalysissuite' : null),
        currentOrigin: base.currentOrigin ?? null,
        financialCurrency: base.financialCurrency ?? fallback.financialCurrency ?? fallback.currency ?? null,
        source: base.leewayUsed ? 'leeway' : 'optionsanalysissuite',
      }
        return await applyFxRateForTarget(result, targetCurrency)
      } catch (fallbackErr: any) {
        base.error = [err?.message, msErr?.message, fallbackErr?.message].filter(Boolean).join(' | ')
      }
    }
  }

  return await applyFxRateForTarget(base, targetCurrency)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!requireAuth(req, res)) return
  const ticker: string | undefined = req.body?.ticker
  const isin: string | undefined = req.body?.isin
  const mnemonic: string | undefined = normalizeMnemonic(req.body?.mnemonic) ?? undefined
  const expectedName: string | undefined = typeof req.body?.expectedName === 'string'
    ? req.body.expectedName.trim()
    : undefined
  const targetCurrency: string | undefined = typeof req.body?.targetCurrency === 'string'
    ? req.body.targetCurrency.trim()
    : undefined
  if (!ticker) return res.status(400).json({ error: 'ticker required' })
  const cacheKey = buildAnalystCacheKey(ticker, mnemonic, isin, targetCurrency)
  const cached = analystCache.get(cacheKey)
  // Long TTL only when we actually have a target signal.
  // Rating-only payloads should refresh sooner so fallbacks can enrich targets.
  const cachedTtl = hasTargetSignal(cached?.data) ? CACHE_TTL_MS : EMPTY_RESULT_CACHE_TTL_MS
  if (cached && Date.now() - cached.ts < cachedTtl) {
    return res.status(200).json(cached.data)
  }
  const result = await fetchAnalyst(ticker, isin, mnemonic, expectedName, targetCurrency)
  analystCache.set(cacheKey, { ts: Date.now(), data: result })
  return res.status(200).json(result)
}
