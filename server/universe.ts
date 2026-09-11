import Papa from 'papaparse'

type UniverseSourceCode = 'STOXX_EUROPE_600' | 'SP_500' | 'MSCI_JAPAN' | 'MSCI_EM'

interface SourceDefinition {
  code: UniverseSourceCode
  region: 'Europe' | 'North America' | 'Japan' | 'Emerging Markets'
  benchmark: string
  urlEnv: string
  defaultUrl: string
  minRows: number
  maxRows: number
}

interface Constituent {
  isin: string
  identifierType: 'ISIN' | 'LISTING'
  ticker: string | null
  yahooTicker: string | null
  name: string
  sector: string | null
  sourceSector: string | null
  primaryListingCountry: string | null
  sourceCountry: string | null
  weight: number | null
  benchmark: string
  region: SourceDefinition['region']
  source: UniverseSourceCode
  memberships: string[]
}

interface ImportedSource {
  constituents: Constituent[]
  retrievedAt: string
  inputRows: number
  resolvedRows: number
  unresolvedRows: number
}

const SOURCES: SourceDefinition[] = [
  { code: 'STOXX_EUROPE_600', region: 'Europe', benchmark: 'STOXX Europe 600', urlEnv: 'UNIVERSE_STOXX_EUROPE_600_CSV_URL', defaultUrl: 'https://www.ishares.com/de/privatanleger/de/produkte/251931/ishares-stoxx-europe-600-ucits-etf-de-fund/1478358465952.ajax?fileType=csv&fileName=EXSA_holdings&dataType=fund', minRows: 500, maxRows: 750 },
  { code: 'SP_500', region: 'North America', benchmark: 'S&P 500', urlEnv: 'UNIVERSE_SP_500_CSV_URL', defaultUrl: 'https://www.ishares.com/de/privatanleger/de/produkte/253743/ishares-sp-500-b-ucits-etf-acc-fund/1478358465952.ajax?fileType=csv&fileName=SXR8_holdings&dataType=fund', minRows: 450, maxRows: 550 },
  { code: 'MSCI_JAPAN', region: 'Japan', benchmark: 'MSCI Japan', urlEnv: 'UNIVERSE_MSCI_JAPAN_CSV_URL', defaultUrl: 'https://www.ishares.com/de/privatanleger/de/produkte/251866/ishares-msci-japan-ucits-etf-inc-fund/1478358465952.ajax?fileType=csv&fileName=IJPN_holdings&dataType=fund', minRows: 100, maxRows: 400 },
  { code: 'MSCI_EM', region: 'Emerging Markets', benchmark: 'MSCI Emerging Markets', urlEnv: 'UNIVERSE_MSCI_EM_CSV_URL', defaultUrl: 'https://www.ishares.com/de/privatanleger/de/produkte/251857/ishares-msci-emerging-markets-ucits-etf-inc-fund/1478358465952.ajax?fileType=csv&fileName=IQQE_holdings&dataType=fund', minRows: 600, maxRows: 1_800 },
]

const ISIN = /^[A-Z]{2}[A-Z0-9]{10}$/

function value(row: Record<string, unknown>, names: string[]): string {
  const key = Object.keys(row).find((candidate) => names.includes(candidate.trim().toLowerCase()))
  return key == null ? '' : String(row[key] ?? '').trim()
}

function isEquity(assetClass: string): boolean {
  const normalized = assetClass.trim().toLowerCase()
  return !normalized || normalized.includes('equity') || normalized.includes('aktien')
}

const EXCHANGE_MAP: Record<string, { country: string; yahooSuffix?: string; padTicker?: number }> = {
  'new york stock exchange': { country: 'United States' }, nyse: { country: 'United States' }, nasdaq: { country: 'United States' },
  'tokyo stock exchange': { country: 'Japan', yahooSuffix: '.T' }, 'london stock exchange': { country: 'United Kingdom', yahooSuffix: '.L' },
  'euronext amsterdam': { country: 'Netherlands', yahooSuffix: '.AS' }, 'euronext paris': { country: 'France', yahooSuffix: '.PA' },
  'six swiss exchange': { country: 'Switzerland', yahooSuffix: '.SW' }, 'deutsche boerse ag': { country: 'Germany', yahooSuffix: '.DE' },
  'hong kong exchanges and clearing': { country: 'Hong Kong', yahooSuffix: '.HK', padTicker: 4 }, 'hong kong stock exchange': { country: 'Hong Kong', yahooSuffix: '.HK', padTicker: 4 },
  'korea exchange': { country: 'South Korea', yahooSuffix: '.KS', padTicker: 6 }, 'taiwan stock exchange': { country: 'Taiwan', yahooSuffix: '.TW', padTicker: 4 },
  'shanghai stock exchange': { country: 'China', yahooSuffix: '.SS', padTicker: 6 }, 'shenzhen stock exchange': { country: 'China', yahooSuffix: '.SZ', padTicker: 6 },
  'national stock exchange of india': { country: 'India', yahooSuffix: '.NS' }, 'bse ltd': { country: 'India', yahooSuffix: '.BO' }, 'borsa italiana': { country: 'Italy', yahooSuffix: '.MI' },
  'bolsa de madrid': { country: 'Spain', yahooSuffix: '.MC' }, 'warsaw stock exchange/equities/main market': { country: 'Poland', yahooSuffix: '.WA' }, 'oslo bors asa': { country: 'Norway', yahooSuffix: '.OL' },
  'johannesburg stock exchange': { country: 'South Africa', yahooSuffix: '.JO' }, 'saudi stock exchange': { country: 'Saudi Arabia', yahooSuffix: '.SR' }, 'stock exchange of thailand': { country: 'Thailand', yahooSuffix: '.BK' },
  'bursa malaysia': { country: 'Malaysia', yahooSuffix: '.KL' }, 'istanbul stock exchange': { country: 'Turkey', yahooSuffix: '.IS' }, 'bolsa mexicana de valores': { country: 'Mexico', yahooSuffix: '.MX' },
  'nyse euronext - euronext brussels': { country: 'Belgium', yahooSuffix: '.BR' }, 'nyse euronext - euronext lisbon': { country: 'Portugal', yahooSuffix: '.LS' },
  'wiener boerse ag': { country: 'Austria', yahooSuffix: '.VI' }, 'athens exchange s.a. cash market': { country: 'Greece', yahooSuffix: '.AT' }, 'prague stock exchange': { country: 'Czech Republic', yahooSuffix: '.PR' },
  'budapest stock exchange': { country: 'Hungary', yahooSuffix: '.BD' }, 'indonesia stock exchange': { country: 'Indonesia', yahooSuffix: '.JK' }, 'philippine stock exchange inc.': { country: 'Philippines', yahooSuffix: '.PS' },
  'qatar exchange': { country: 'Qatar', yahooSuffix: '.QA' }, 'dubai financial market': { country: 'United Arab Emirates', yahooSuffix: '.DU' }, 'abu dhabi securities exchange': { country: 'United Arab Emirates', yahooSuffix: '.AD' },
  'nasdaq omx nordic': { country: 'Sweden', yahooSuffix: '.ST' }, 'nasdaq omx helsinki ltd.': { country: 'Finland', yahooSuffix: '.HE' }, 'omx nordic exchange copenhagen a/s': { country: 'Denmark', yahooSuffix: '.CO' },
  'cboe bzx': { country: 'United States' }, 'xbsp': { country: 'Brazil', yahooSuffix: '.SA' }, 'bolsa de valores de colombia': { country: 'Colombia', yahooSuffix: '.CL' },
  'santiago stock exchange': { country: 'Chile', yahooSuffix: '.SN' }, 'egyptian exchange': { country: 'Egypt', yahooSuffix: '.CA' }, 'kuwait stock exchange': { country: 'Kuwait', yahooSuffix: '.KW' },
}

function normalizedExchange(exchange: string): string {
  const raw = exchange.trim().toLowerCase()
  const aliases: Record<string, string> = {
    'new york stock exchange inc.': 'nyse', 'nasdaq': 'nasdaq', 'xetra': 'deutsche boerse ag',
    'hong kong exchanges and clearing ltd': 'hong kong exchanges and clearing',
    'korea exchange (stock market)': 'korea exchange', 'korea exchange (kosdaq)': 'korea exchange',
    'nyse euronext - euronext paris': 'euronext paris',
    'deutsche börse ag': 'deutsche boerse ag',
  }
  return aliases[raw] ?? raw
}

function exchangeMeta(exchange: string): { country?: string; yahooSuffix?: string; padTicker?: number } {
  return EXCHANGE_MAP[normalizedExchange(exchange)] ?? {}
}

function yahooTicker(ticker: string | null, exchange: string | null): string | null {
  if (!ticker) return null
  const meta = exchangeMeta(exchange ?? '')
  const local = meta.padTicker && /^\d+$/.test(ticker) ? ticker.padStart(meta.padTicker, '0') : ticker
  return meta.yahooSuffix ? `${local}${meta.yahooSuffix}` : local
}

function numberValue(raw: string): number | null {
  const stripped = raw.replace(/[%,$\s]/g, '')
  const normalized = stripped.includes(',') && stripped.includes('.')
    ? (stripped.lastIndexOf(',') > stripped.lastIndexOf('.') ? stripped.replace(/\./g, '').replace(',', '.') : stripped.replace(/,/g, ''))
    : stripped.replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function canonicalGicsSector(raw: string): string | null {
  const value = raw.trim().toLowerCase()
  if (!value) return null
  const mapping: Record<string, string> = {
    'information technology': 'Information Technology', technology: 'Information Technology', 'communication services': 'Communication Services', telecommunications: 'Communication Services', media: 'Communication Services',
    'consumer discretionary': 'Consumer Discretionary', 'consumer products & services': 'Consumer Discretionary', 'automobiles & parts': 'Consumer Discretionary', 'travel & leisure': 'Consumer Discretionary',
    'consumer staples': 'Consumer Staples', 'food, beverage & tobacco': 'Consumer Staples', 'personal care, drug & grocery stores': 'Consumer Staples',
    energy: 'Energy', financials: 'Financials', banks: 'Financials', insurance: 'Financials', 'financial services': 'Financials', 'health care': 'Health Care', healthcare: 'Health Care',
    industrials: 'Industrials', 'industrial goods & services': 'Industrials', 'construction & materials': 'Industrials', materials: 'Materials', chemicals: 'Materials', 'basic resources': 'Materials',
    'real estate': 'Real Estate', utilities: 'Utilities',
  }
  return mapping[value] ?? null
}

function stableHash(input: string): string {
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) { hash ^= input.charCodeAt(i); hash = Math.imul(hash, 16777619) }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

interface Candidate { isin: string | null; ticker: string | null; name: string; sourceSector: string | null; sourceCountry: string | null; exchange: string | null; weight: number | null }

async function importSource(source: SourceDefinition): Promise<ImportedSource> {
  const response = await fetch(process.env[source.urlEnv] || source.defaultUrl, { headers: { Accept: 'text/csv,text/plain,*/*', 'User-Agent': 'MomentumScreener/1.0' } })
  if (!response.ok) throw new Error(`${source.code}: HTTP ${response.status}`)
  const parsedRows = Papa.parse<string[]>(await response.text(), { header: false, skipEmptyLines: 'greedy', delimitersToGuess: [',', ';', '\t', '|'] })
  const headerIndex = parsedRows.data.findIndex((row) => row.some((cell) => ['isin', 'ticker', 'emittententicker', 'issuer ticker'].includes(String(cell ?? '').replace(/^\uFEFF/, '').trim().toLowerCase())))
  if (headerIndex < 0) throw new Error(`${source.code}: CSV has no recognised holdings header`)
  const header = parsedRows.data[headerIndex].map((cell) => String(cell ?? '').replace(/^\uFEFF/, '').trim())
  const rows = parsedRows.data.slice(headerIndex + 1).map((cells) => Object.fromEntries(header.map((name, index) => [name, cells[index] ?? ''])) as Record<string, unknown>)
  const candidates: Candidate[] = []
  for (const row of rows) {
    if (!isEquity(value(row, ['asset class', 'asset_class', 'assetclass', 'anlageklasse']))) continue
    const rawIsin = value(row, ['isin']).toUpperCase()
    candidates.push({ isin: ISIN.test(rawIsin) ? rawIsin : null, ticker: value(row, ['ticker', 'symbol', 'local ticker', 'emittententicker', 'issuer ticker']) || null,
      name: value(row, ['name', 'security name', 'holding name', 'instrument']), sourceSector: value(row, ['sector', 'gics sector', 'industry', 'sektor']) || null,
      sourceCountry: value(row, ['country', 'location', 'country of risk', 'standort']) || null, exchange: value(row, ['exchange', 'börse']) || null,
      weight: numberValue(value(row, ['weight (%)', 'weight', 'weight %', 'gewichtung (%)'])) })
  }
  const byIsin = new Map<string, Constituent>()
  for (const candidate of candidates) {
    // The holdings file is the membership authority. If no ISIN is disclosed,
    // retain the source listing identity; no third-party mapper can remove it.
    // Exchange + local ticker is sufficient across sources and preserves shared
    // benchmark memberships. Only a ticker-less exceptional row includes its
    // source, to avoid accidentally merging namesakes from different markets.
    const listingKey = candidate.ticker
      ? [normalizedExchange(candidate.exchange ?? ''), candidate.ticker].map((part) => part.trim().toUpperCase()).join(':')
      : [source.code, normalizedExchange(candidate.exchange ?? ''), candidate.name].map((part) => part.trim().toUpperCase()).join(':')
    const identifier = candidate.isin || `LISTING:${stableHash(listingKey)}`
    const exchange = exchangeMeta(candidate.exchange ?? '')
    byIsin.set(identifier, { isin: identifier, identifierType: candidate.isin ? 'ISIN' : 'LISTING', ticker: candidate.ticker, yahooTicker: yahooTicker(candidate.ticker, candidate.exchange), name: candidate.name || identifier,
      sector: candidate.sourceSector ? canonicalGicsSector(candidate.sourceSector) : null, sourceSector: candidate.sourceSector,
      primaryListingCountry: exchange.country ?? null, sourceCountry: candidate.sourceCountry, weight: candidate.weight,
      benchmark: source.benchmark, region: source.region, source: source.code, memberships: [source.benchmark] })
  }
  const constituents = [...byIsin.values()]
  if (constituents.length < source.minRows || constituents.length > source.maxRows) throw new Error(`${source.code}: ${constituents.length} valid equity holdings outside expected range ${source.minRows}-${source.maxRows}`)
  return { constituents, retrievedAt: new Date().toISOString(), inputRows: candidates.length, resolvedRows: constituents.length, unresolvedRows: 0 }
}

/** Import all index proxy holdings, failing closed when a source is incomplete. */
export async function getIndexGlobalSnapshot() {
  const imports = await Promise.all(SOURCES.map(importSource))
  const byIsin = new Map<string, Constituent>()
  imports.flatMap((item) => item.constituents).forEach((constituent) => {
    const existing = byIsin.get(constituent.isin)
    if (!existing) byIsin.set(constituent.isin, constituent)
    else existing.memberships = [...new Set([...existing.memberships, ...constituent.memberships])]
  })
  const constituents = [...byIsin.values()]
  return {
    universeCode: 'index_global' as const, status: 'fresh' as const, asOfDate: new Date().toISOString().slice(0, 10), retrievedAt: new Date().toISOString(),
    version: stableHash(constituents.map((item) => `${item.isin}:${item.source}`).sort().join('|')),
    sources: SOURCES.map((source, index) => ({ code: source.code, benchmark: source.benchmark, region: source.region, sourceType: 'ETF_HOLDINGS_PROXY',
      inputRows: imports[index].inputRows, resolvedRows: imports[index].resolvedRows, unresolvedRows: imports[index].unresolvedRows,
      isinMatchRate: imports[index].inputRows === 0 ? 0 : imports[index].resolvedRows / imports[index].inputRows, memberCount: imports[index].constituents.length, retrievedAt: imports[index].retrievedAt })),
    constituents,
  }
}
