import Papa from 'papaparse'
import { fetchOpenFigiBatch, type FigiJob } from '../api/openfigi'

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
  ticker: string | null
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

const EXCHANGE_MAP: Record<string, { figi: string; country: string }> = {
  'new york stock exchange': { figi: 'UN', country: 'United States' }, nyse: { figi: 'UN', country: 'United States' }, nasdaq: { figi: 'UQ', country: 'United States' },
  'tokyo stock exchange': { figi: 'JT', country: 'Japan' }, 'london stock exchange': { figi: 'LN', country: 'United Kingdom' },
  'euronext amsterdam': { figi: 'NA', country: 'Netherlands' }, 'euronext paris': { figi: 'FP', country: 'France' },
  'six swiss exchange': { figi: 'SW', country: 'Switzerland' }, 'deutsche boerse ag': { figi: 'GR', country: 'Germany' },
  'hong kong exchanges and clearing': { figi: 'HK', country: 'Hong Kong' }, 'hong kong stock exchange': { figi: 'HK', country: 'Hong Kong' },
  'korea exchange': { figi: 'KS', country: 'South Korea' }, 'taiwan stock exchange': { figi: 'TT', country: 'Taiwan' },
  'shanghai stock exchange': { figi: 'CH', country: 'China' }, 'shenzhen stock exchange': { figi: 'CS', country: 'China' },
}

function exchangeMeta(exchange: string): { figi?: string; country?: string } { return EXCHANGE_MAP[exchange.trim().toLowerCase()] ?? {} }

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
interface OpenFigiMatch { isin?: string; securityType2?: string; exchCode?: string }

async function resolveMissingIsins(candidates: Candidate[]): Promise<void> {
  const unresolved = candidates.filter((candidate) => !candidate.isin && candidate.ticker && candidate.exchange)
  if (!unresolved.length) return
  const apiKey = process.env.OPENFIGI_API_KEY
  if (!apiKey) throw new Error('OPENFIGI_API_KEY is required to resolve holdings without ISIN')
  for (let start = 0; start < unresolved.length; start += 100) {
    const batch = unresolved.slice(start, start + 100)
    const jobs: FigiJob[] = batch.map((candidate) => ({ idType: 'TICKER', idValue: candidate.ticker ?? '', exchCode: exchangeMeta(candidate.exchange ?? '').figi }))
    const payload = await fetchOpenFigiBatch(jobs, apiKey) as Array<{ data?: OpenFigiMatch[] } | null>
    batch.forEach((candidate, index) => {
      const expectedExchange = exchangeMeta(candidate.exchange ?? '').figi
      const isins = [...new Set((payload[index]?.data ?? [])
        .filter((match) => !expectedExchange || match.exchCode === expectedExchange)
        .filter((match) => !match.securityType2 || /common stock|ordinary share|equity/i.test(match.securityType2))
        .map((match) => match.isin?.toUpperCase()).filter((isin): isin is string => Boolean(isin && ISIN.test(isin))))]
      // Never use the provider's arbitrary first result: only one exact equity ISIN is accepted.
      if (isins.length === 1) candidate.isin = isins[0]
    })
  }
}

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
  await resolveMissingIsins(candidates)
  const byIsin = new Map<string, Constituent>()
  for (const candidate of candidates) {
    if (!candidate.isin) continue
    const exchange = exchangeMeta(candidate.exchange ?? '')
    byIsin.set(candidate.isin, { isin: candidate.isin, ticker: candidate.ticker, name: candidate.name || candidate.isin,
      sector: candidate.sourceSector ? canonicalGicsSector(candidate.sourceSector) : null, sourceSector: candidate.sourceSector,
      primaryListingCountry: exchange.country ?? null, sourceCountry: candidate.sourceCountry, weight: candidate.weight,
      benchmark: source.benchmark, region: source.region, source: source.code, memberships: [source.benchmark] })
  }
  const constituents = [...byIsin.values()]
  const matchRate = candidates.length === 0 ? 0 : constituents.length / candidates.length
  if (matchRate < 0.95) throw new Error(`${source.code}: ISIN resolution rate ${(matchRate * 100).toFixed(1)}% below 95% minimum`)
  if (constituents.length < source.minRows || constituents.length > source.maxRows) throw new Error(`${source.code}: ${constituents.length} valid equity ISINs outside expected range ${source.minRows}-${source.maxRows}`)
  return { constituents, retrievedAt: new Date().toISOString(), inputRows: candidates.length, resolvedRows: constituents.length, unresolvedRows: candidates.filter((candidate) => !candidate.isin).length }
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
