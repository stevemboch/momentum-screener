import Papa from 'papaparse'
import * as XLSX from 'xlsx'

type UniverseSourceCode =
  | 'STOXX_EUROPE_600' | 'SP_500' | 'SP_MIDCAP_400' | 'SP_SMALLCAP_600'
  | 'NASDAQ_100' | 'MSCI_JAPAN' | 'MSCI_PACIFIC_EX_JAPAN' | 'MSCI_EM'

interface SourceDefinition {
  code: UniverseSourceCode
  region: 'Europe' | 'North America' | 'Japan' | 'Pacific ex Japan' | 'Emerging Markets'
  benchmark: string
  urlEnv: string
  defaultUrl: string
  minRows: number
  maxRows: number
  defaultListingCountry?: string
  sourceType: 'ETF_HOLDINGS_PROXY' | 'TRACKING_FUND_DISCLOSURE' | 'OFFICIAL_LISTING_SCREEN'
  format?: 'csv' | 'blackrock_holdings_json' | 'blackrock_product_data' | 'dws_excel'
}

interface Constituent {
  isin: string
  identifierType: 'ISIN' | 'LISTING'
  cusip: string | null
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
  { code: 'STOXX_EUROPE_600', region: 'Europe', benchmark: 'STOXX Europe 600', urlEnv: 'UNIVERSE_STOXX_EUROPE_600_CSV_URL', defaultUrl: 'https://etf.dws.com/etfdata/export/DEU/DEU/excel/product/constituent/LU0328475792/', minRows: 500, maxRows: 750, sourceType: 'ETF_HOLDINGS_PROXY', format: 'dws_excel' },
  { code: 'SP_500', region: 'North America', benchmark: 'S&P 500', urlEnv: 'UNIVERSE_SP_500_CSV_URL', defaultUrl: 'https://etf.dws.com/etfdata/export/DEU/DEU/excel/product/constituent/IE000Z9SJA06/', minRows: 450, maxRows: 550, defaultListingCountry: 'United States', sourceType: 'ETF_HOLDINGS_PROXY', format: 'dws_excel' },
  // Xtrackers does not offer a plain S&P MidCap 400 UCITS ETF; the US-listed MIDE is ESG-scored.
  // Using Russell 2000 as the mid-cap proxy is not appropriate. We use the US API with MIDE ticker.
  // Updated to match actual file format - the MIDE ETF has ~280 holdings, not the expected 390-430
  { code: 'SP_MIDCAP_400', region: 'North America', benchmark: 'S&P MidCap 400', urlEnv: 'UNIVERSE_SP_MIDCAP_400_CSV_URL', defaultUrl: 'https://etf.dws.com/api/pdp/en-us/export/etf/MIDE/Securities', minRows: 250, maxRows: 320, defaultListingCountry: 'United States', sourceType: 'TRACKING_FUND_DISCLOSURE', format: 'dws_excel' },
  // iShares ISP6 (IE00B2QWCY14) tracks the actual S&P SmallCap 600. Its public
  // holdings endpoint exposes the current physical ETF basket, including ISINs.
  { code: 'SP_SMALLCAP_600', region: 'North America', benchmark: 'S&P SmallCap 600', urlEnv: 'UNIVERSE_SP_SMALLCAP_600_CSV_URL', defaultUrl: 'https://www.blackrock.com/varnish-api/uk-retail01-product-data/product-data/api/v2/get-product-data?appSubType=ISHARES&appType=PRODUCT_PAGE&component=holdings&locale=en_GB&portfolioId=251920&targetSite=ishares-uk&userType=individual&excludeContent=true&asOfDate=&includeConfig=true', minRows: 580, maxRows: 700, defaultListingCountry: 'United States', sourceType: 'ETF_HOLDINGS_PROXY', format: 'blackrock_product_data' },
  { code: 'NASDAQ_100', region: 'North America', benchmark: 'Nasdaq 100', urlEnv: 'UNIVERSE_NASDAQ_100_CSV_URL', defaultUrl: 'https://etf.dws.com/etfdata/export/DEU/DEU/excel/product/constituent/IE00BMFKG444/', minRows: 90, maxRows: 110, defaultListingCountry: 'United States', sourceType: 'ETF_HOLDINGS_PROXY', format: 'dws_excel' },
  { code: 'MSCI_JAPAN', region: 'Japan', benchmark: 'MSCI Japan', urlEnv: 'UNIVERSE_MSCI_JAPAN_CSV_URL', defaultUrl: 'https://etf.dws.com/etfdata/export/DEU/DEU/excel/product/constituent/LU0274209740/', minRows: 100, maxRows: 400, sourceType: 'ETF_HOLDINGS_PROXY', format: 'dws_excel' },
  { code: 'MSCI_PACIFIC_EX_JAPAN', region: 'Pacific ex Japan', benchmark: 'MSCI Pacific ex Japan', urlEnv: 'UNIVERSE_MSCI_PACIFIC_EX_JAPAN_CSV_URL', defaultUrl: 'https://etf.dws.com/etfdata/export/DEU/DEU/excel/product/constituent/LU0322252338/', minRows: 70, maxRows: 120, sourceType: 'ETF_HOLDINGS_PROXY', format: 'dws_excel' },
  { code: 'MSCI_EM', region: 'Emerging Markets', benchmark: 'MSCI Emerging Markets', urlEnv: 'UNIVERSE_MSCI_EM_CSV_URL', defaultUrl: 'https://etf.dws.com/etfdata/export/DEU/DEU/excel/product/constituent/IE000GWA2J58/', minRows: 600, maxRows: 1_800, sourceType: 'ETF_HOLDINGS_PROXY', format: 'dws_excel' },
]

const ISIN = /^[A-Z]{2}[A-Z0-9]{10}$/

/**
 * Holdings providers occasionally format an ISIN with spaces or hyphens.  Do
 * not accept a value merely because it has twelve characters: the ISO 6166
 * check digit catches provider placeholders (for example `___451CVR021`) and
 * prevents those rows from reaching a quote request as fake instruments.
 */
function normalizeIsin(raw: unknown): string | null {
  const isin = String(raw ?? '').normalize('NFKC').toUpperCase().replace(/[\s-]/g, '')
  if (!ISIN.test(isin)) return null

  let digits = ''
  for (const char of isin) digits += /\d/.test(char) ? char : String(char.charCodeAt(0) - 55)
  let total = 0
  for (let i = digits.length - 1, parity = 0; i >= 0; i--, parity ^= 1) {
    let digit = Number(digits[i])
    if (parity) digit *= 2
    total += digit > 9 ? digit - 9 : digit
  }
  return total % 10 === 0 ? isin : null
}

function value(row: Record<string, unknown>, names: string[]): string {
  const key = Object.keys(row).find((candidate) => names.includes(candidate.trim().toLowerCase()))
  return key == null ? '' : String(row[key] ?? '').trim()
}

function isEquity(assetClass: string): boolean {
  const normalized = assetClass.trim().toLowerCase()
  return normalized.includes('equity') || normalized.includes('aktien')
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
  'asx - all markets': { country: 'Australia', yahooSuffix: '.AX' }, 'australian securities exchange': { country: 'Australia', yahooSuffix: '.AX' },
  'singapore exchange': { country: 'Singapore', yahooSuffix: '.SI' }, 'new zealand exchange': { country: 'New Zealand', yahooSuffix: '.NZ' },
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

interface Candidate { isin: string | null; cusip: string | null; ticker: string | null; name: string; sourceSector: string | null; sourceCountry: string | null; exchange: string | null; weight: number | null }

async function importSource(source: SourceDefinition): Promise<ImportedSource> {
  const isExcel = source.format === 'dws_excel'
  const response = await fetch(process.env[source.urlEnv] || source.defaultUrl, { 
    headers: { 
      Accept: isExcel
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*'
        : source.format === 'blackrock_product_data' ? 'application/json,*/*' : 'text/csv,text/plain,*/*',
      'User-Agent': 'MomentumScreener/1.0',
      ...(source.format === 'blackrock_product_data' ? { 'x-application-id': 'pp-ui-csr' } : {}),
    } 
  })
  if (!response.ok) throw new Error(`${source.code}: HTTP ${response.status}`)
  
  const candidates: Candidate[] = []
  
  if (source.format === 'blackrock_holdings_json') {
    const payload = await response.text()
    const parsed = JSON.parse(payload.replace(/^\uFEFF/, '')) as { aaData?: unknown[][] }
    if (!Array.isArray(parsed.aaData)) throw new Error(`${source.code}: holdings JSON has no aaData array`)
    for (const row of parsed.aaData) {
      const assetClass = String(row[4] ?? '')
      if (!isEquity(assetClass)) continue
      const isin = normalizeIsin(row[9])
      const rawCusip = String(row[8] ?? '').trim().toUpperCase()
      candidates.push({
        isin,
        cusip: /^[A-Z0-9]{9}$/.test(rawCusip) ? rawCusip : null,
        ticker: String(row[0] ?? '').trim() || null,
        name: String(row[1] ?? '').trim(),
        sourceSector: String(row[3] ?? '').trim() || null,
        sourceCountry: String(row[12] ?? '').trim() || null,
        exchange: String(row[13] ?? '').trim() || null,
        weight: numberValue(String(row[17] ?? '')),
      })
    }
  } else if (source.format === 'blackrock_product_data') {
    const parsed = await response.json() as {
      componentsByNameMap?: {
        holdings?: {
          containersByNameMap?: {
            all?: { dataPointsByNameMap?: Record<string, { value?: unknown }> }
          }
        }
      }
    }
    const fields = parsed.componentsByNameMap?.holdings?.containersByNameMap?.all?.dataPointsByNameMap
    if (!fields) throw new Error(`${source.code}: BlackRock holdings response has no all-holdings data`)
    const column = (name: string): unknown[] => Array.isArray(fields[name]?.value) ? fields[name]!.value as unknown[] : []
    const assetClasses = column('assetClass')
    const isins = column('isin')
    const rowCount = Math.max(assetClasses.length, isins.length, column('issueName').length)
    if (rowCount === 0) throw new Error(`${source.code}: BlackRock holdings response is empty`)
    for (let index = 0; index < rowCount; index++) {
      const assetClass = String(assetClasses[index] ?? '')
      if (!isEquity(assetClass)) continue
      candidates.push({
        isin: normalizeIsin(isins[index]),
        cusip: null,
        ticker: String(column('ticker')[index] ?? '').trim() || null,
        name: String(column('issueName')[index] ?? '').trim(),
        sourceSector: String(column('sectorName')[index] ?? '').trim() || null,
        sourceCountry: String(column('countryOfRisk')[index] ?? '').trim() || null,
        exchange: String(column('exchange')[index] ?? '').trim() || null,
        weight: numberValue(String(column('holdingPercent')[index] ?? '')),
      })
    }
  } else if (source.format === 'dws_excel') {
    const arrayBuffer = await response.arrayBuffer()
    const workbook = XLSX.read(arrayBuffer, { type: 'array' })
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as string[][]
    
    // Detect US format: has "Securities" row followed by "Fund Name:", "Ticker:", "As of:" rows
    let isUSFormat = false
    for (let i = 0; i < Math.min(5, jsonData.length); i++) {
      const row = jsonData[i].map((cell) => String(cell ?? '').trim().toLowerCase())
      if (row.some((cell) => cell === 'securities') || row.some((cell) => cell.startsWith('ticker:'))) {
        isUSFormat = true
        break
      }
    }
    
    let headerRowIndex = -1
    if (isUSFormat) {
      // US format: find row with "symbol", "isin", "cusip", "name", "weight %", etc.
      for (let i = 0; i < jsonData.length; i++) {
        const row = jsonData[i].map((cell) => String(cell ?? '').trim().toLowerCase())
        if (row.some((cell) => cell === 'symbol' || cell === 'isin' || cell === 'cusip' || cell === 'weight %')) {
          headerRowIndex = i
          break
        }
      }
    } else {
      // EU format: find row with 'isin' or 'name' or 'gewichtung'
      for (let i = 0; i < jsonData.length; i++) {
        const row = jsonData[i].map((cell) => String(cell ?? '').trim().toLowerCase())
        if (row.some((cell) => cell === 'isin' || cell === 'name' || cell === 'gewichting' || cell === 'gewichtung')) {
          headerRowIndex = i
          break
        }
      }
    }
    if (headerRowIndex < 0) throw new Error(`${source.code}: Excel file has no recognised holdings header`)
    
    const header = jsonData[headerRowIndex].map((cell) => String(cell ?? '').trim().toLowerCase())
    const headerMap = new Map<string, number>()
    header.forEach((name, idx) => headerMap.set(name, idx))
    
    const findCol = (names: string[]) => {
      for (const n of names) {
        if (headerMap.has(n)) return headerMap.get(n)!
      }
      return -1
    }
    
    // Support both EU (English/German) and US column names
    const isinCol = findCol(['isin'])
    const nameCol = findCol(['name', 'security name', 'instrument', 'holding name', 'bezeichnung'])
    const tickerCol = findCol(['ticker', 'symbol', 'local ticker', 'emittententicker', 'issuer ticker', 'kürzel'])
    const cusipCol = findCol(['cusip'])
    const sectorCol = findCol(['sector', 'gics sector', 'industry', 'sektor', 'industry classification', 'branche'])
    const countryCol = findCol(['country', 'location', 'country of risk', 'standort', 'land'])
    const exchangeCol = findCol(['exchange', 'börse', 'boerse', 'handelsplatz'])
    const weightCol = findCol(['weight (%)', 'weight', 'weight %', 'gewichtung (%)', 'gewichtung', 'weighting'])
    const assetClassCol = findCol(['asset class', 'asset_class', 'assetclass', 'anlageklasse', 'type of security', 'wertpapierart'])
    
    for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
      const row = jsonData[i]
      if (row.length === 0 || row.every((cell) => !cell)) continue
      
      const assetClass = assetClassCol >= 0 ? String(row[assetClassCol] ?? '').trim() : ''
      // If the file declares an asset-class column, an empty footer/cash row
      // is not an equity holding. Files without that column remain supported.
      if (assetClassCol >= 0 && !isEquity(assetClass)) continue
      
      const isin = isinCol >= 0 ? normalizeIsin(row[isinCol]) : null
      const rawCusip = cusipCol >= 0 ? String(row[cusipCol] ?? '').trim().toUpperCase() : ''
      
      candidates.push({
        isin,
        cusip: /^[A-Z0-9]{9}$/.test(rawCusip) ? rawCusip : null,
        ticker: tickerCol >= 0 ? String(row[tickerCol] ?? '').trim() || null : null,
        name: nameCol >= 0 ? String(row[nameCol] ?? '').trim() : '',
        sourceSector: sectorCol >= 0 ? String(row[sectorCol] ?? '').trim() || null : null,
        sourceCountry: countryCol >= 0 ? String(row[countryCol] ?? '').trim() || null : null,
        exchange: exchangeCol >= 0 ? String(row[exchangeCol] ?? '').trim() || null : null,
        weight: weightCol >= 0 ? numberValue(String(row[weightCol] ?? '')) : null,
      })
    }
  } else {
    const payload = await response.text()
    const parsedRows = Papa.parse<string[]>(payload, { header: false, skipEmptyLines: 'greedy', delimitersToGuess: [',', ';', '\t', '|'] })
    const headerIndex = parsedRows.data.findIndex((row) => row.some((cell) => ['isin', 'ticker', 'emittententicker', 'issuer ticker'].includes(String(cell ?? '').replace(/^\uFEFF/, '').trim().toLowerCase())))
    if (headerIndex < 0) throw new Error(`${source.code}: CSV has no recognised holdings header`)
    const header = parsedRows.data[headerIndex].map((cell) => String(cell ?? '').replace(/^\uFEFF/, '').trim())
    const rows = parsedRows.data.slice(headerIndex + 1).map((cells) => Object.fromEntries(header.map((name, index) => [name, cells[index] ?? ''])) as Record<string, unknown>)
    for (const row of rows) {
      const assetClass = value(row, ['asset class', 'asset_class', 'assetclass', 'anlageklasse'])
      if (assetClass && !isEquity(assetClass)) continue
      const isin = normalizeIsin(value(row, ['isin']))
      const rawCusip = value(row, ['cusip']).toUpperCase()
      candidates.push({ isin, cusip: /^[A-Z0-9]{9}$/.test(rawCusip) ? rawCusip : null, ticker: value(row, ['ticker', 'symbol', 'local ticker', 'emittententicker', 'issuer ticker']) || null,
        name: value(row, ['name', 'company', 'security name', 'holding name', 'instrument']), sourceSector: value(row, ['sector', 'gics sector', 'industry', 'sektor']) || null,
        sourceCountry: value(row, ['country', 'location', 'country of risk', 'standort']) || null, exchange: value(row, ['exchange', 'börse']) || null,
        weight: numberValue(value(row, ['weight (%)', 'weight', 'weight %', 'gewichtung (%)'])) })
    }
  }
  // An index member without an ISIN cannot be sent to Gettex.  Preserve rows
  // only where the source provides a real alternate listing identifier; this
  // also discards XLSX footers, cash lines and DWS placeholder "ISINs".
  const quoteableCandidates = candidates.filter((candidate) => candidate.isin || candidate.ticker || candidate.cusip)
  const byIsin = new Map<string, Constituent>()
  for (const candidate of quoteableCandidates) {
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
    byIsin.set(identifier, { isin: identifier, identifierType: candidate.isin ? 'ISIN' : 'LISTING', cusip: candidate.cusip, ticker: candidate.ticker, yahooTicker: yahooTicker(candidate.ticker, candidate.exchange), name: candidate.name || identifier,
      sector: candidate.sourceSector ? canonicalGicsSector(candidate.sourceSector) : null, sourceSector: candidate.sourceSector,
      primaryListingCountry: exchange.country ?? source.defaultListingCountry ?? null, sourceCountry: candidate.sourceCountry, weight: candidate.weight,
      benchmark: source.benchmark, region: source.region, source: source.code, memberships: [source.benchmark] })
  }
  const constituents = [...byIsin.values()]
  if (constituents.length < source.minRows || constituents.length > source.maxRows) throw new Error(`${source.code}: ${constituents.length} valid equity holdings outside expected range ${source.minRows}-${source.maxRows}`)
  // Keep this a row-level metric. A fund can disclose the same ISIN in more
  // than one line (for example share-class or basket accounting); deduping it
  // into one universe member must not lower the published ISIN match rate.
  const resolvedRows = candidates.filter((candidate) => candidate.isin != null).length
  return {
    constituents,
    retrievedAt: new Date().toISOString(),
    inputRows: candidates.length,
    resolvedRows,
    unresolvedRows: candidates.length - resolvedRows,
  }
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
    sources: SOURCES.map((source, index) => ({ code: source.code, benchmark: source.benchmark, region: source.region, sourceType: source.sourceType,
      inputRows: imports[index].inputRows, resolvedRows: imports[index].resolvedRows, unresolvedRows: imports[index].unresolvedRows,
      isinMatchRate: imports[index].inputRows === 0 ? 0 : imports[index].resolvedRows / imports[index].inputRows, memberCount: imports[index].constituents.length, retrievedAt: imports[index].retrievedAt })),
    constituents,
  }
}
