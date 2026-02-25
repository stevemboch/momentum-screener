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
  { prefix: 'ABRDN', priority: 23 },
  { prefix: 'NOMURA', priority: 24 },
  { prefix: 'TABULA', priority: 25 },
]

// Xetra short-name provider aliases → canonical provider prefix for priority lookup
const PROVIDER_ALIASES: [string, string][] = [
  ['ISHARES', 'ISHARES'],
  ['ISHS', 'ISHARES'],
  ['ISH', 'ISHARES'],
  ['IS ', 'ISHARES'],   // "IS Core MSCI..." – note trailing space
  ['SS SPDR', 'SPDR'],
  ['SS ', 'SPDR'],
  ['SSGA', 'SPDR'],
  ['XTRACKERS', 'XTRACKERS'],
  ['XTRK', 'XTRACKERS'],
  ['XTRAC', 'XTRACKERS'],
  ['XTR', 'XTRACKERS'],
  ['X ', 'XTRACKERS'],  // "X MSCI Korea" – Xtrackers
  ['LYXOR', 'LYXOR'],
  ['LYX', 'LYXOR'],
  ['AMUNDI', 'AMUNDI'],
  ['VANECK', 'VANECK'],
  ['WISDOMTREE', 'WISDOMTREE'],
  ['WT ', 'WISDOMTREE'],
  ['FRANKLIN', 'FRANKLIN'],
  ['FRK', 'FRANKLIN'],  // "Frk FTSE Korea"
  ['FTGF', 'FRANKLIN'],
  ['INVESCO', 'INVESCO'],
  ['INV', 'INVESCO'],
  ['GLX', 'GLOBALX'],
  ['VANGUARD', 'VANGUARD'],
  ['VAN', 'VANGUARD'],
  ['SPDR', 'SPDR'],
  ['UBS', 'UBS'],
  ['DEKA', 'DEKA'],
  ['HSBC', 'HSBC'],
  ['PIMCO', 'PIMCO'],
  ['LGIM', 'LGIM'],
]

// ─── Abbreviation Expansion ───────────────────────────────────────────────────

const ABBREV: [string, string][] = [
  // Indices – sorted longest first to avoid partial matches
  ['EURSTX600', 'EUROSTOXX600'],
  ['EURSTX50', 'EUROSTOXX50'],
  ['EURSTX', 'EUROSTOXX'],
  ['EUR600', 'EUROSTOXX600'],
  ['EX600', 'EUROSTOXX600'],
  ['ESTX600', 'EUROSTOXX600'],
  ['ESTX50', 'EUROSTOXX50'],
  ['ESTX', 'EUROSTOXX'],
  ['STX600', 'STOXX600'],
  ['STX50', 'STOXX50'],
  ['STX', 'STOXX'],
  ['STXX', 'STOXX'],

  // Sectors
  ['BASICRESOURCE', 'BASICRESOURCES'],
  ['BASICRESOURCES', 'BASICRESOURCES'],
  ['BASICRES', 'BASICRESOURCES'],
  ['BASRES', 'BASICRESOURCES'],
  ['RSRCES', 'BASICRESOURCES'],
  ['RSRC', 'RESOURCES'],
  ['RSCR', 'RESOURCES'],
  ['SEMICNDCT', 'SEMICONDUCTOR'],
  ['SEMICOND', 'SEMICONDUCTOR'],
  ['SEMCNDCT', 'SEMICONDUCTOR'],
  ['SEMIC', 'SEMICONDUCTOR'],
  ['UTILITIE', 'UTILITIES'],
  ['UTILIT', 'UTILITIES'],
  ['UTIL', 'UTILITIES'],
  ['HLTHCARE', 'HEALTHCARE'],
  ['HLTHCR', 'HEALTHCARE'],
  ['HELTHCR', 'HEALTHCARE'],
  ['HLTH', 'HEALTH'],
  ['FINANCIALS', 'FINANCIALS'],
  ['FINANCI', 'FINANCIALS'],
  ['FINANC', 'FINANCIALS'],
  ['FINAN', 'FINANCIALS'],
  ['CONSMR', 'CONSUMER'],
  ['DISCRET', 'DISCRETIONARY'],
  ['DISCR', 'DISCRETIONARY'],
  ['INDUST', 'INDUSTRIALS'],
  ['INFTECH', 'TECHNOLOGY'],
  ['INFOTECH', 'TECHNOLOGY'],
  ['INFTEC', 'TECHNOLOGY'],
  ['REALEST', 'REALESTATE'],
  ['REALES', 'REALESTATE'],
  ['REALET', 'REALESTATE'],
  ['TELECOM', 'COMMUNICATIONS'],
  ['TELECO', 'COMMUNICATIONS'],
  ['COMMUN', 'COMMUNICATIONS'],

  // Geographic
  ['GLB', 'GLOBAL'],
  ['GLBL', 'GLOBAL'],
  ['WRLD', 'WORLD'],
  ['WRL', 'WORLD'],
  ['INTL', 'INTERNATIONAL'],
  ['INTRNTNL', 'INTERNATIONAL'],
  ['LATAM', 'LATINAMERICA'],
  ['APAC', 'ASIAPACIFIC'],

  // Modifiers
  ['PHYS', 'PHYSICAL'],
  ['MINERS', 'MINERS'],
  ['MINING', 'MINERS'],
  ['GOLDMIN', 'GOLDMINERS'],
  ['GOLDMINE', 'GOLDMINERS'],
  ['SILVMINE', 'SILVERMINERS'],

  // Misc
  ['MINVOL', 'MINIMUMVOLATILITY'],
  ['MINVAR', 'MINIMUMVARIANCE'],
  ['LOWVOL', 'LOWVOLATILITY'],
  ['EQWT', 'EQUALWEIGHT'],
  ['GOVT', 'GOVERNMENT'],
  ['GOVNT', 'GOVERNMENT'],
  ['CORP', 'CORPORATE'],
]

const STRIP_WORDS = new Set([
  'UCITS', 'ETF', 'ETC', 'ETP', 'SWAP', 'DR', 'ACC', 'DIST', 'DISTRIBUTING',
  'ACCUMULATING', 'CLASS', 'SHARE', 'SHARES', 'FUND', 'TRUST',
  '1C', '2C', '3C', '4C', '5C', '1D', '2D', '3D', 'A', 'B', 'C', 'D',
  'DAILY', 'MONTHLY', 'QUARTERLY',
  'THE', 'AN', 'OF', 'FOR', 'AND', 'WITH',
  // Strip index family names – we do NOT use them as dedup dimensions
  // (MSCI Korea = FTSE Korea for our purposes)
  'MSCI', 'FTSE', 'SP', 'STOXX', 'BLOOMBERG', 'SOLACTIVE',
  'RUSSELL', 'NASDAQ', 'DJ', 'NIKKEI', 'CSI', 'TOPIX', 'HANGSENG',
  // Noise quality words
  'CORE', 'PRIME', 'PLUS', 'SELECT', 'OPTIMAL', 'ENHANCED', 'QUALITY',
  'IMI', 'LARGE', 'MID', 'SMALL', 'CAP', 'MEGA',
  'SCREENED', 'LEADERS', 'FILTERED', 'FOCUSED', 'UNIVERSAL', 'BROAD',
  'NET', 'TOTAL', 'RETURN', 'TR', 'NR', 'GR', 'PR',
  'MARKET', 'INDEX', 'IDX',
  // Provider names
  ...PROVIDERS.map((p) => p.prefix),
])

// ─── Commodity Detection ──────────────────────────────────────────────────────

const COMMODITIES: { commodity: string; terms: string[] }[] = [
  { commodity: 'GOLD',      terms: ['GOLD', 'XAU', 'GOLDBARREN'] },
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
  { commodity: 'OIL',       terms: ['CRUDE OIL', 'BRENT', 'WTI', 'PETROLEUM'] },
  { commodity: 'GAS',       terms: ['NATURAL GAS', 'NAT GAS'] },
  { commodity: 'WHEAT',     terms: ['WHEAT', 'WEIZEN'] },
  { commodity: 'CORN',      terms: ['CORN', 'MAIS'] },
  { commodity: 'SOYBEANS',  terms: ['SOYBEAN', 'SOYA'] },
  { commodity: 'CARBON',    terms: ['CARBON', 'CO2', 'EMISSION'] },
  { commodity: 'PRECIOUS',  terms: ['PRECIOUS METALS', 'PRECIOUS MET'] },
  { commodity: 'BASKET',    terms: ['BLOOMBERG COMMODITY', 'BROAD COMMODITY', 'DIVERSIFIED COMMODITY', 'RICI'] },
]

const COMMODITY_MODS: { key: string; terms: string[] }[] = [
  { key: 'HEDGED', terms: ['HEDGED', 'HDG', 'HDGD', 'CURRENCY HEDGED'] },
  { key: '2X',     terms: ['2X', '2EX', 'DOUBLE LONG', 'DAILY 2X'] },
  { key: 'SHORT',  terms: ['SHORT', 'INVERSE', '-1X', 'DAILY SHORT'] },
  { key: 'MINERS', terms: ['MINERS', 'MINING', 'MINE'] },
]

function detectCommodity(upper: string): { commodity: string; mods: string } | null {
  let found: string | null = null
  for (const { commodity, terms } of COMMODITIES) {
    for (const term of terms) {
      if (upper.includes(term)) { found = commodity; break }
    }
    if (found) break
  }
  if (!found) return null

  const mods: string[] = []
  for (const { key, terms } of COMMODITY_MODS) {
    for (const term of terms) {
      if (upper.includes(term)) { mods.push(key); break }
    }
  }

  return { commodity: found, mods: mods.join('|') }
}

// ─── Provider Strip & Detection ──────────────────────────────────────────────

function stripAndDetectProvider(name: string): { stripped: string; priority: number } {
  const upper = name.toUpperCase()
  for (const [alias, canonical] of PROVIDER_ALIASES) {
    if (upper.startsWith(alias)) {
      const stripped = name.slice(alias.length).trim().replace(/^[-\s]+/, '')
      const prov = PROVIDERS.find((p) => p.prefix === canonical)
      return { stripped, priority: prov?.priority ?? 99 }
    }
  }
  return { stripped: name, priority: 99 }
}

// ─── Abbreviation Expansion ───────────────────────────────────────────────────

function expandAbbreviations(name: string): string {
  let result = name.toUpperCase()
  for (const [abbr, expansion] of ABBREV) {
    // Word-boundary match
    const regex = new RegExp(`(?<![A-Z])${abbr}(?![A-Z])`, 'g')
    result = result.replace(regex, expansion)
  }
  return result
}

// ─── Overlay Detection ────────────────────────────────────────────────────────

const ESG_TERMS = ['ESG', 'SRI', 'PAB', 'CTB', 'CLIMATE', 'SUSTAINABLE',
  'RESPONSIBLE', 'GREEN', 'IMPACT', 'LOW CARBON', 'NET ZERO', 'PARIS ALIGNED']
const HEDGED_TERMS = ['HEDGED', 'HDG', 'HDGD', 'CURRENCY HEDGED', 'EUR HEDGED', 'USD HEDGED']

// ─── Exposure Key ────────────────────────────────────────────────────────────

function extractExposureKey(longName: string | undefined, fallbackName: string): string {
  const rawName = longName || fallbackName || ''

  // 1. Strip provider prefix, get priority
  const { stripped } = stripAndDetectProvider(rawName)

  // 2. Expand abbreviations
  const expanded = expandAbbreviations(stripped)

  // 3. Check for commodity ETC
  const commodity = detectCommodity(expanded)
  if (commodity) {
    return commodity.mods
      ? `COMMODITY|${commodity.commodity}|${commodity.mods}`
      : `COMMODITY|${commodity.commodity}`
  }

  // 4. Detect overlays (ESG, Hedged)
  let esg = ''
  for (const t of ESG_TERMS) { if (expanded.includes(t)) { esg = 'ESG'; break } }

  let hedged = ''
  for (const t of HEDGED_TERMS) { if (expanded.includes(t)) { hedged = 'HEDGED'; break } }

  // 5. Tokenize and strip noise
  const words = expanded.split(/[\s\-\/\(\),\.]+/).map(w => w.trim()).filter((w) => {
    if (!w || w.length < 2) return false
    if (STRIP_WORDS.has(w)) return false
    if (/^\d{1,2}$/.test(w)) return false
    if (/^[A-Z]\d+$/.test(w)) return false
    if (/^\d+(MO|YR|Y|M)$/.test(w)) return false
    if (['USD', 'EUR', 'GBP', 'CHF', 'JPY', 'SEK'].includes(w)) return false
    return true
  })

  // 6. Normalize synonyms
  const normalized = words.map((w) => {
    if (['WORLD', 'WLD', 'WORLDWIDE'].includes(w)) return 'WORLD'
    if (['EUROPE', 'EUROPEAN', 'EUR', 'EURO'].includes(w)) return 'EUROPE'
    if (['AMERICA', 'AMERICAN', 'AMERICAS'].includes(w)) return 'AMERICA'
    if (['EMERGINGMARKETS', 'EMERGING', 'EMG'].includes(w)) return 'EMERGINGMARKETS'
    if (['GOVERNMENT', 'GOVT', 'GOV'].includes(w)) return 'GOVERNMENT'
    if (['CORPORATE', 'CORP'].includes(w)) return 'CORPORATE'
    if (['AGGREGATE', 'AGG'].includes(w)) return 'AGGREGATE'
    if (['BOND', 'BONDS'].includes(w)) return 'BOND'
    if (['EQUITY', 'EQUITIES', 'STOCKS', 'STOCK'].includes(w)) return 'EQUITY'
    if (['MINERS', 'MINING', 'MINE'].includes(w)) return 'MINERS'
    if (['REALESTATE', 'REIT', 'REITS'].includes(w)) return 'REALESTATE'
    if (['HEALTHCARE', 'HEALTH'].includes(w)) return 'HEALTH'
    if (['TECHNOLOGY', 'TECH'].includes(w)) return 'TECHNOLOGY'
    if (['COMMUNICATIONS', 'TELECOM', 'COMM'].includes(w)) return 'COMMUNICATIONS'
    if (['BASICRESOURCES', 'BASICRESOURCE', 'RESOURCES', 'RESOURCE'].includes(w)) return 'BASICRESOURCES'
    if (['SEMICONDUCTOR', 'SEMICONDUCTORS'].includes(w)) return 'SEMICONDUCTOR'
    if (['UTILITIES'].includes(w)) return 'UTILITIES'
    if (['FINANCIALS', 'FINANCIAL'].includes(w)) return 'FINANCIALS'
    if (['INDUSTRIALS', 'INDUSTRIAL'].includes(w)) return 'INDUSTRIALS'
    if (['DISCRETIONARY'].includes(w)) return 'DISCRETIONARY'
    return w
  })

  // 7. Sort alphabetically → order-independent matching
  const core = [...new Set(normalized)].sort().join(' ').trim()

  const parts = [core, esg, hedged].filter(Boolean)
  return parts.join('|') || rawName.toUpperCase()
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
    const key = extractExposureKey(inst.longName, inst.displayName)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(inst)
  }

  const result: DedupGroup[] = []

  for (const [key, candidates] of groups) {
    const sorted = [...candidates].sort((a, b) => {
      const pa = stripAndDetectProvider(a.longName || a.displayName).priority
      const pb = stripAndDetectProvider(b.longName || b.displayName).priority
      if (pa !== pb) return pa - pb
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
