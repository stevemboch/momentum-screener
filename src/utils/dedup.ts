import type { Instrument } from '../types'

// ─── Provider Detection ───────────────────────────────────────────────────────

const PROVIDERS: { prefix: string; priority: number }[] = [
  { prefix: 'ISHARES', priority: 1 },
  { prefix: 'VANGUARD', priority: 2 },
  { prefix: 'AMUNDI', priority: 3 },
  { prefix: 'LYXOR', priority: 3 },
  { prefix: 'XTRACKERS', priority: 4 },
  { prefix: 'SPDR', priority: 5 },
  { prefix: 'INVESCO', priority: 6 },
  { prefix: 'UBS', priority: 7 },
  { prefix: 'DEKA', priority: 8 },
  { prefix: 'HSBC', priority: 9 },
  { prefix: 'WISDOMTREE', priority: 10 },
  { prefix: 'VANECK', priority: 11 },
  { prefix: 'PIMCO', priority: 12 },
  { prefix: 'FIDELITY', priority: 13 },
  { prefix: 'BLACKROCK', priority: 14 },
  { prefix: 'STATESTREET', priority: 15 },
  { prefix: 'DIMENSIONAL', priority: 16 },
  { prefix: 'OSSIAM', priority: 17 },
  { prefix: 'FLOSSBACH', priority: 18 },
  { prefix: 'DWS', priority: 19 },
  { prefix: 'GLOBAL X', priority: 20 },
  { prefix: 'GLOBALX', priority: 20 },
  { prefix: 'FRANKLIN', priority: 21 },
  { prefix: 'LGIM', priority: 22 },
  { prefix: 'LEGAL', priority: 22 },
  { prefix: 'ABRDN', priority: 23 },
  { prefix: 'NOMURA', priority: 24 },
  { prefix: 'TABULA', priority: 25 },
]

// Xetra short-name provider aliases → canonical provider prefix
const PROVIDER_ALIASES: Record<string, string> = {
  'ISH': 'ISHARES',
  'ISHS': 'ISHARES',
  'IS': 'ISHARES',       // "IS Core MSCI..."
  'SS': 'SPDR',          // State Street SPDR
  'SSGA': 'SPDR',
  'XTR': 'XTRACKERS',
  'XTRK': 'XTRACKERS',
  'XTRAC': 'XTRACKERS',
  'LYX': 'LYXOR',
  'LYXR': 'LYXOR',
  'VANECK': 'VANECK',
  'VE': 'VANECK',
  'GLX': 'GLOBALX',
  'FT': 'FRANKLIN',
}

// ─── Abbreviation Expansion ───────────────────────────────────────────────────
// Xetra names are truncated to ~35 chars. Map short forms to canonical terms.

const ABBREV: Record<string, string> = {
  // Indices
  'STX': 'STOXX',
  'STX600': 'STOXX600',
  'STXX': 'STOXX',
  'EURSTX': 'EURO STOXX',
  'EURSTX50': 'EURO STOXX50',
  'EURSTX600': 'EURO STOXX600',
  'EUR600': 'EURO STOXX600',
  'EX600': 'EURO STOXX600',
  'ESTX': 'EURO STOXX',
  'ESTX50': 'EURO STOXX50',

  // Sectors & asset classes
  'RSRCES': 'RESOURCES',
  'RSRC': 'RESOURCES',
  'RSCR': 'RESOURCES',
  'BASICRESOURCE': 'BASIC RESOURCES',
  'BASICRES': 'BASIC RESOURCES',
  'BASRES': 'BASIC RESOURCES',
  'SEMICNDCT': 'SEMICONDUCTOR',
  'SEMICOND': 'SEMICONDUCTOR',
  'SEMIC': 'SEMICONDUCTOR',
  'SEMCNDCT': 'SEMICONDUCTOR',
  'UTILITIE': 'UTILITIES',
  'UTILIT': 'UTILITIES',
  'UTIL': 'UTILITIES',
  'HLTHCARE': 'HEALTHCARE',
  'HLTHCR': 'HEALTHCARE',
  'HLTH': 'HEALTH',
  'HELTHCR': 'HEALTHCARE',
  'FINANCI': 'FINANCIALS',
  'FINAN': 'FINANCIALS',
  'FINANC': 'FINANCIALS',
  'CONSMR': 'CONSUMER',
  'CONSM': 'CONSUMER',
  'DISCRET': 'DISCRETIONARY',
  'DISCR': 'DISCRETIONARY',
  'STAPLE': 'STAPLES',
  'INDUST': 'INDUSTRIALS',
  'INDUS': 'INDUSTRIALS',
  'TELECOM': 'COMMUNICATIONS',
  'TELECO': 'COMMUNICATIONS',
  'COMMUN': 'COMMUNICATIONS',
  'COMM': 'COMMUNICATIONS',
  'INFTECH': 'INFORMATION TECHNOLOGY',
  'INFOTECH': 'INFORMATION TECHNOLOGY',
  'INFTEC': 'INFORMATION TECHNOLOGY',
  'TECH': 'TECHNOLOGY',
  'REALEST': 'REAL ESTATE',
  'REALES': 'REAL ESTATE',
  'REALET': 'REAL ESTATE',

  // Geographic
  'GLB': 'GLOBAL',
  'GLBL': 'GLOBAL',
  'GLBSCT': 'GLOBAL SELECT',
  'WRLD': 'WORLD',
  'WRL': 'WORLD',
  'INTL': 'INTERNATIONAL',
  'INTRNTNL': 'INTERNATIONAL',
  'EM': 'EMERGING MARKETS',
  'EMG': 'EMERGING MARKETS',
  'EMRG': 'EMERGING MARKETS',
  'DM': 'DEVELOPED MARKETS',
  'ACWI': 'ALL COUNTRY WORLD',
  'ACWI EX': 'ALL COUNTRY WORLD EX',
  'APAC': 'ASIA PACIFIC',
  'APACD': 'ASIA PACIFIC DEVELOPED',
  'LATAM': 'LATIN AMERICA',

  // Modifiers
  'PHYS': 'PHYSICAL',
  'PHY': 'PHYSICAL',
  'PRVDR': 'PROVIDER',
  'EX-FIN': 'EX FINANCIALS',
  'EXFIN': 'EX FINANCIALS',
  'HEDG': 'HEDGED',
  'HDGD': 'HEDGED',

  // Mining / metals specific
  'MINERS': 'MINERS',
  'MINING': 'MINERS',
  'MINE': 'MINERS',
  'GOLDMINE': 'GOLD MINERS',
  'GOLDMIN': 'GOLD MINERS',
  'SILVMINE': 'SILVER MINERS',

  // Miscellaneous
  'DIV': 'DIVIDEND',
  'DIVID': 'DIVIDEND',
  'MOMEN': 'MOMENTUM',
  'MOMNTM': 'MOMENTUM',
  'QUALI': 'QUALITY',
  'QUAL': 'QUALITY',
  'MINVOL': 'MINIMUM VOLATILITY',
  'MINVAR': 'MINIMUM VARIANCE',
  'LOWVOL': 'LOW VOLATILITY',
  'LOWVLT': 'LOW VOLATILITY',
  'EQWT': 'EQUAL WEIGHT',
  'EQW': 'EQUAL WEIGHT',
  'MKT': 'MARKET',
  'GOVNT': 'GOVERNMENT',
  'GOVT': 'GOVERNMENT',
  'CORP': 'CORPORATE',
  'HY': 'HIGH YIELD',
  'IG': 'INVESTMENT GRADE',
  'AGGR': 'AGGREGATE',
  'AGG': 'AGGREGATE',
}

// Words/tokens to strip entirely after expansion
const STRIP_WORDS = new Set([
  'UCITS', 'ETF', 'ETC', 'ETP', 'SWAP', 'DR', 'ACC', 'DIST', 'DISTRIBUTING',
  'ACCUMULATING', 'CLASS', 'SHARE', 'SHARES', 'FUND',
  '1C', '2C', '3C', '4C', '1D', '2D',
  'DAILY', 'MONTHLY', 'QUARTERLY',
  'U.ETF', 'UETF', 'IE', 'DE', 'LU', 'FR',  // country suffixes
  'THE', 'AN', 'OF', 'FOR', 'AND',
  // Strip currency when used as standalone word (not as part of index name)
  // Note: EUR in "EURO STOXX" is handled by ABBREV expansion
  'GBP', 'CHF', 'JPY', 'SEK', 'NOK',
  // Noise quality words that differ across providers for same exposure
  'CORE', 'PRIME', 'PLUS', 'SELECT', 'OPTIMAL', 'ENHANCED',
  'IMI', 'LARGE', 'MID', 'SMALL', 'CAP',
  'SCREENED', 'LEADERS', 'FILTERED', 'FOCUSED', 'UNIVERSAL', 'BROAD',
  'NET', 'TOTAL', 'RETURN', 'TR', 'NR', 'GR',
  // Provider names (resolved separately)
  ...PROVIDERS.map((p) => p.prefix),
  ...Object.keys(PROVIDER_ALIASES),
])

// ─── Commodity Detection ──────────────────────────────────────────────────────
// ETCs tracking a single physical commodity → key is just the commodity

const COMMODITIES: { commodity: string; terms: string[] }[] = [
  { commodity: 'GOLD',      terms: ['GOLD', 'XAU', 'XAUUSD', 'GOLD ETC', 'GOLDBARREN'] },
  { commodity: 'SILVER',    terms: ['SILVER', 'XAG', 'SILBER'] },
  { commodity: 'PLATINUM',  terms: ['PLATINUM', 'XPT', 'PLATIN'] },
  { commodity: 'PALLADIUM', terms: ['PALLADIUM', 'XPD'] },
  { commodity: 'COPPER',    terms: ['COPPER', 'KUPFER'] },
  { commodity: 'NICKEL',    terms: ['NICKEL'] },
  { commodity: 'ZINC',      terms: ['ZINC', 'ZINK'] },
  { commodity: 'TIN',       terms: ['TIN', 'ZINN'] },
  { commodity: 'ALUMINIUM', terms: ['ALUMINIUM', 'ALUMINUM'] },
  { commodity: 'COBALT',    terms: ['COBALT'] },
  { commodity: 'LITHIUM',   terms: ['LITHIUM'] },
  { commodity: 'OIL',       terms: ['CRUDE OIL', 'BRENT', 'WTI', 'OIL ETC', 'PETROLEUM'] },
  { commodity: 'GAS',       terms: ['NATURAL GAS', 'NATURAL GS', 'NAT GAS'] },
  { commodity: 'WHEAT',     terms: ['WHEAT', 'WEIZEN'] },
  { commodity: 'CORN',      terms: ['CORN', 'MAIS'] },
  { commodity: 'SOYBEANS',  terms: ['SOYBEAN', 'SOYA', 'SOY'] },
  { commodity: 'CARBON',    terms: ['CARBON', 'CO2', 'CARBON CREDIT', 'EMISSION'] },
]

// Sub-dimensions for commodities (create separate groups)
const COMMODITY_DIMS: { key: string; terms: string[] }[] = [
  { key: 'HEDGED',   terms: ['HEDGED', 'HDG', 'HDGD'] },
  { key: 'DAILY',    terms: ['DAILY HEDGED', 'DAILY HDG'] },
  { key: '2X',       terms: ['2X', '2EX', 'DAILY 2X', 'DOUBLE'] },
  { key: 'SHORT',    terms: ['SHORT', '-1X', 'INVERSE'] },
  { key: 'BASKET',   terms: ['BASKET', 'DIVERSIFIED', 'BROAD COMMODITY', 'BLOOMBERG COMMODITY', 'RICI'] },
  { key: 'PRECIOUS', terms: ['PRECIOUS METALS', 'PRECIOUS MET'] },
]

function detectCommodity(name: string): string | null {
  const upper = name.toUpperCase()
  // Baskets / diversified first
  for (const dim of COMMODITY_DIMS) {
    if (dim.key === 'BASKET' || dim.key === 'PRECIOUS') {
      for (const term of dim.terms) {
        if (upper.includes(term)) return dim.key
      }
    }
  }
  // Then single commodities
  for (const { commodity, terms } of COMMODITIES) {
    for (const term of terms) {
      if (upper.includes(term)) return commodity
    }
  }
  return null
}

function detectCommodityDimensions(name: string): string {
  const upper = name.toUpperCase()
  const dims: string[] = []
  for (const dim of COMMODITY_DIMS) {
    if (dim.key === 'BASKET' || dim.key === 'PRECIOUS') continue
    for (const term of dim.terms) {
      if (upper.includes(term)) { dims.push(dim.key); break }
    }
  }
  return dims.join('|')
}

// ─── Name Normalization ───────────────────────────────────────────────────────

function expandAbbreviations(name: string): string {
  // First try multi-word replacements (longest match first)
  let result = name

  // Sort by length descending so longer matches take priority
  const sortedAbbrev = Object.entries(ABBREV).sort((a, b) => b[0].length - a[0].length)
  for (const [abbr, expansion] of sortedAbbrev) {
    const regex = new RegExp(`\\b${abbr}\\b`, 'gi')
    result = result.replace(regex, expansion)
  }

  return result
}

function stripProviderPrefix(name: string): string {
  const upper = name.toUpperCase()

  // Check provider aliases first (Xetra short names)
  for (const [alias, canonical] of Object.entries(PROVIDER_ALIASES)) {
    if (upper.startsWith(alias + ' ') || upper === alias) {
      return name.slice(alias.length).trim()
    }
  }

  // Then canonical providers
  for (const p of PROVIDERS) {
    if (upper.startsWith(p.prefix + ' ') || upper.startsWith(p.prefix + '-')) {
      return name.slice(p.prefix.length).trim()
    }
  }
  return name
}

function detectProvider(name: string): { priority: number } {
  const upper = name.toUpperCase()

  // Check aliases first
  for (const [alias, canonical] of Object.entries(PROVIDER_ALIASES)) {
    if (upper.startsWith(alias + ' ') || upper === alias) {
      const prov = PROVIDERS.find((p) => p.prefix === canonical)
      return prov ?? { priority: 99 }
    }
  }

  for (const p of PROVIDERS) {
    if (upper.startsWith(p.prefix)) return p
  }
  return { priority: 99 }
}

// ─── Exposure Key Extraction ─────────────────────────────────────────────────

const ESG_TERMS = ['ESG', 'SRI', 'PAB', 'CTB', 'CLIMATE', 'SUSTAINABLE', 'RESPONSIBLE',
  'GREEN', 'IMPACT', 'LOW CARBON', 'NET ZERO', 'PARIS']
const HEDGED_TERMS = ['HEDGED', 'HDG', 'HDGD', 'CURRENCY HEDGED']
const INDEX_FAMILIES = ['MSCI', 'FTSE', 'S&P', 'SP', 'STOXX', 'BLOOMBERG', 'SOLACTIVE',
  'RUSSELL', 'NASDAQ', 'DJ', 'EURO STOXX', 'NIKKEI', 'HANG SENG', 'CSI', 'TOPIX']

function extractExposureKey(longName: string | undefined, fallbackName: string): string {
  const rawName = (longName || fallbackName || '')

  // Step 1: Strip provider prefix
  const withoutProvider = stripProviderPrefix(rawName)

  // Step 2: Expand abbreviations
  const expanded = expandAbbreviations(withoutProvider)

  const upper = expanded.toUpperCase()

  // Step 3: Check for commodity ETC
  const commodity = detectCommodity(upper)
  if (commodity) {
    const dims = detectCommodityDimensions(upper)
    return dims ? `COMMODITY|${commodity}|${dims}` : `COMMODITY|${commodity}`
  }

  // Step 4: Detect overlay dimensions
  let esg = ''
  for (const t of ESG_TERMS) { if (upper.includes(t)) { esg = 'ESG'; break } }

  let hedged = ''
  for (const t of HEDGED_TERMS) { if (upper.includes(t)) { hedged = 'HEDGED'; break } }

  let indexFamily = ''
  for (const fam of INDEX_FAMILIES) { if (upper.includes(fam)) { indexFamily = fam; break } }

  // Step 5: Strip noise words and build core
  const words = upper.split(/[\s\-\/\(\)]+/).filter((w) => {
    if (!w) return false
    if (STRIP_WORDS.has(w)) return false
    if (/^\d{1,2}$/.test(w)) return false       // class numbers
    if (/^[A-Z]\d+$/.test(w)) return false       // A1, B2 etc
    if (/^\d+(MO|YR|Y)$/.test(w)) return false  // maturity codes
    if (w === 'USD' || w === 'EUR' || w === 'GBP') return false // standalone currency
    return true
  })

  // Step 6: Normalize common word variants
  const normalized = words.map((w) => {
    if (w === 'WORLD' || w === 'WLD') return 'WORLD'
    if (w === 'EUROPE' || w === 'EUROPEAN' || w === 'EURO') return 'EUROPE'
    if (w === 'AMERICA' || w === 'AMERICAN' || w === 'US' || w === 'USA') return 'USA'
    if (w === 'EMERGING' || w === 'EMERGINGMARKETS') return 'EMERGING MARKETS'
    if (w === 'GOVERNMENT' || w === 'GOVT' || w === 'GOV') return 'GOVERNMENT'
    if (w === 'CORPORATE' || w === 'CORP') return 'CORPORATE'
    if (w === 'AGGREGATE' || w === 'AGG') return 'AGGREGATE'
    if (w === 'BOND' || w === 'BONDS') return 'BOND'
    if (w === 'EQUITY' || w === 'EQUITIES' || w === 'STOCKS') return 'EQUITY'
    if (w === 'MINERS' || w === 'MINING' || w === 'MINE') return 'MINERS'
    return w
  })

  // Sort words alphabetically to make order-independent comparison work
  // Exception: keep "GOLD MINERS" together by joining first, then the full key
  const core = normalized.sort().join(' ').trim()

  const parts = [core, indexFamily, esg, hedged].filter(Boolean)
  return parts.join('|')
}

// ─── Group ETFs/ETCs by Exposure ─────────────────────────────────────────────

export interface DedupGroup {
  key: string
  candidates: Instrument[]
  winner: Instrument
}

export function buildDedupGroups(instruments: Instrument[]): DedupGroup[] {
  const groups = new Map<string, Instrument[]>()

  for (const inst of instruments) {
    const nameToUse = inst.longName || inst.displayName
    const key = extractExposureKey(inst.longName, inst.displayName)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(inst)
  }

  const result: DedupGroup[] = []

  for (const [key, candidates] of groups) {
    const sorted = [...candidates].sort((a, b) => {
      const pa = detectProvider(a.longName || a.displayName)
      const pb = detectProvider(b.longName || b.displayName)
      if (pa.priority !== pb.priority) return pa.priority - pb.priority
      // Tiebreaker: EUR over USD
      if (a.currency === 'EUR' && b.currency !== 'EUR') return -1
      if (b.currency === 'EUR' && a.currency !== 'EUR') return 1
      return 0
    })

    result.push({ key, candidates: sorted, winner: sorted[0] })
  }

  return result
}

export function applyDedupToInstruments(
  instruments: Instrument[],
  groups: DedupGroup[]
): Instrument[] {
  const winnerISINs = new Set(groups.map((g) => g.winner.isin))
  const groupByISIN = new Map<string, { key: string; candidateISINs: string[] }>()

  for (const g of groups) {
    const candidateISINs = g.candidates.map((c) => c.isin)
    for (const c of g.candidates) {
      groupByISIN.set(c.isin, { key: g.key, candidateISINs })
    }
  }

  return instruments.map((inst) => {
    const group = groupByISIN.get(inst.isin)
    return {
      ...inst,
      dedupGroup: group?.key,
      isDedupWinner: winnerISINs.has(inst.isin),
      dedupCandidates: group?.candidateISINs.filter((isin) => isin !== inst.isin),
    }
  })
}

// ─── Debug helper (call from browser console) ────────────────────────────────
// Usage: window.__dedupKey("iShares Core MSCI World UCITS ETF")

if (typeof window !== 'undefined') {
  (window as any).__dedupKey = (name: string) => {
    const key = extractExposureKey(name, name)
    console.log(`Key: "${key}"`)
    return key
  }
}
