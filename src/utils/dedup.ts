import type { Instrument } from '../types'

// ─── Provider Detection ───────────────────────────────────────────────────────

const PROVIDERS: { prefix: string; priority: number }[] = [
  { prefix: 'ISHARES',    priority: 1  },
  { prefix: 'VANGUARD',   priority: 2  },
  { prefix: 'AMUNDI',     priority: 3  },
  { prefix: 'LYXOR',      priority: 3  },
  { prefix: 'XTRACKERS',  priority: 4  },
  { prefix: 'SPDR',       priority: 5  },
  { prefix: 'INVESCO',    priority: 6  },
  { prefix: 'UBS',        priority: 7  },
  { prefix: 'DEKA',       priority: 8  },
  { prefix: 'HSBC',       priority: 9  },
  { prefix: 'WISDOMTREE', priority: 10 },
  { prefix: 'VANECK',     priority: 11 },
  { prefix: 'PIMCO',      priority: 12 },
  { prefix: 'FIDELITY',   priority: 13 },
  { prefix: 'BLACKROCK',  priority: 14 },
  { prefix: 'STATESTREET',priority: 15 },
  { prefix: 'DIMENSIONAL',priority: 16 },
  { prefix: 'OSSIAM',     priority: 17 },
  { prefix: 'FLOSSBACH',  priority: 18 },
  { prefix: 'DWS',        priority: 19 },
  { prefix: 'GLOBAL X',   priority: 20 },
  { prefix: 'GLOBALX',    priority: 20 },
  { prefix: 'FRANKLIN',   priority: 21 },
  { prefix: 'LGIM',       priority: 22 },
  { prefix: 'ABRDN',      priority: 23 },
  { prefix: 'NOMURA',     priority: 24 },
  { prefix: 'TABULA',     priority: 25 },
]

const PROVIDER_ALIASES: [string, string][] = [
  ['ISHARES',    'ISHARES'],
  ['ISHS',       'ISHARES'],
  ['ISH',        'ISHARES'],
  ['IS ',        'ISHARES'],
  ['SS SPDR',    'SPDR'],
  ['SS ',        'SPDR'],
  ['SSGA',       'SPDR'],
  ['XTRACKERS',  'XTRACKERS'],
  ['XTRK',       'XTRACKERS'],
  ['XTRAC',      'XTRACKERS'],
  ['XTR',        'XTRACKERS'],
  ['X ',         'XTRACKERS'],
  ['LYXOR',      'LYXOR'],
  ['LYX',        'LYXOR'],
  ['AMUNDI',     'AMUNDI'],
  ['VANECK',     'VANECK'],
  ['WISDOMTREE', 'WISDOMTREE'],
  ['WT ',        'WISDOMTREE'],
  ['FRANKLIN',   'FRANKLIN'],
  ['FRK',        'FRANKLIN'],
  ['FTGF',       'FRANKLIN'],
  ['INVESCO',    'INVESCO'],
  ['INV',        'INVESCO'],
  ['GLX',        'GLOBALX'],
  ['VANGUARD',   'VANGUARD'],
  ['VAN',        'VANGUARD'],
  ['SPDR',       'SPDR'],
  ['UBS',        'UBS'],
  ['DEKA',       'DEKA'],
  ['HSBC',       'HSBC'],
  ['PIMCO',      'PIMCO'],
  ['LGIM',       'LGIM'],
]

// ─── Abbreviation Expansion ──────────────────────────────────────────────────

const ABBREV: [string, string][] = [
  ['S&P 500',       'SP500'],
  ['S&P500',        'SP500'],
  ['SPTSE',         'SPTSX'],
  ['STOXX 600',     'STOXX600'],
  ['EURO STOXX 50', 'EUROSTOXX50'],
  ['EURO STOXX',    'EUROSTOXX'],
  ['ESTX50',        'EUROSTOXX50'],
  ['ESTX 50',       'EUROSTOXX50'],
  ['EX600',         'STOXX600'],
  ['EURSTX',        'EUROSTOXX'],
  ['ACWI',          'ALLCOUNTRY'],
  ['ALL COUNTRY',   'ALLCOUNTRY'],
  ['ALL-WORLD',     'ALLWORLD'],
  ['FTSE ALL',      'ALLWORLD'],
  ['UNITED KINGDOM','UK'],
  ['UNITED STATES', 'US'],
  ['U.S.',          'US'],
  ['U.S.A.',        'US'],
  ['SOUTH KOREA',   'KOREA'],
  ['LATIN AMERICA', 'LATAM'],
  ['LAT AM',        'LATAM'],
  ['LATIN AM',      'LATAM'],
  ['EASTERN EUROPE','EASTERNEUROPE'],
  ['EAST EUROPE',   'EASTERNEUROPE'],
  ['SOUTHEAST ASIA','SOUTHEASTASIA'],
  ['ASIA EX JAPAN', 'ASIAEXJAPAN'],
  ['ASIA EX-JAPAN', 'ASIAEXJAPAN'],
  ['AXJ',           'ASIAEXJAPAN'],
  ['EX JAPAN',      'ASIAEXJAPAN'],
  ['EUROPE EX UK',  'EUROPEEXUK'],
  ['PACIFIC EX JAPAN','PACIFICEXJAPAN'],
  ['WORLD EX US',   'WORLDEXUS'],
  ['WORLD EX-US',   'WORLDEXUS'],
  ['EMERGING ASIA', 'EMERGINGASIA'],
  ['FRONTIER MARKETS','FRONTIERMARKETS'],
  ['NORTH AMERICA', 'NORTHAMERICA'],
  ['ASIA PACIFIC',  'ASIAPACIFIC'],
  ['ASIA-PACIFIC',  'ASIAPACIFIC'],
  ['PAN EUROPE',    'EUROPE'],
  ['PAN-EUROPE',    'EUROPE'],
  ['PANEUROPE',     'EUROPE'],
  ['EMERGING MARKETS','EMERGINGMARKETS'],
  ['MINIMUM VOLATILITY','MINVOL'],
  ['MINIMUM VARIANCE',  'MINVOL'],
  ['LOW VOLATILITY',    'MINVOL'],
  ['LOW VOL',           'MINVOL'],
  ['MINVAR',            'MINVOL'],
  ['LOWVOL',            'MINVOL'],
  ['LOWVOLATILITY',     'MINVOL'],
  ['MINIMUMVOLATILITY', 'MINVOL'],
  ['MINIMUMVARIANCE',   'MINVOL'],
  ['MIN VOL',           'MINVOL'],
  ['HIGH DIVIDEND',     'DIVIDEND'],
  ['HIGH DIV',          'DIVIDEND'],
  ['HDY',               'DIVIDEND'],
  ['DIVIDENDEN',        'DIVIDEND'],
  ['EQUAL WEIGHT',      'EQUALWEIGHT'],
  ['EQUAL WEIGHTED',    'EQUALWEIGHT'],
  ['EQWT',              'EQUALWEIGHT'],
  ['MULTI FACTOR',      'MULTIFACTOR'],
  ['MULTI-FACTOR',      'MULTIFACTOR'],
  ['SMALL CAP',         'SMALLCAP'],
  ['SMALL-CAP',         'SMALLCAP'],
  ['MID CAP',           'MIDCAP'],
  ['MID-CAP',           'MIDCAP'],
  ['LARGE CAP',         'LARGECAP'],
  ['LARGE-CAP',         'LARGECAP'],
  ['MEGA CAP',          'MEGACAP'],
  ['SMALL MID',         'SMID'],
  ['SMALL-MID',         'SMID'],
  ['INVESTABLE MARKET', 'IMI'],
  ['INFORMATION TECHNOLOGY','TECHNOLOGY'],
  ['COMM SERVICES',         'COMMUNICATIONS'],
  ['COMMUNICATION SERVICES','COMMUNICATIONS'],
  ['REAL ESTATE',           'REALESTATE'],
  ['CONSUMER DISCRETIONARY','CONSUMERDISCRETIONARY'],
  ['CONSUMER STAPLES',      'CONSUMERSTAPLES'],
  ['BASIC RESOURCES',       'BASICRESOURCES'],
  ['NATURAL RESOURCES',     'BASICRESOURCES'],
  ['BASICRESOURCE',         'BASICRESOURCES'],
  ['SEMICNDCT',             'SEMICONDUCTORS'],
  ['SEMICONDUCTOR',         'SEMICONDUCTORS'],
  ['HLTHCARE',              'HEALTHCARE'],
  ['HEALTH CARE',           'HEALTHCARE'],
  ['CLEAN ENERGY',          'CLEANENERGY'],
  ['RENEWABLE ENERGY',      'CLEANENERGY'],
  ['CLOUD COMPUTING',       'CLOUDCOMPUTING'],
  ['ARTIFICIAL INTELLIGENCE','AI'],
  ['FUTURE MOBILITY',       'FUTUREMOBILITY'],
  ['ELECTRIC VEHICLES',     'FUTUREMOBILITY'],
  ['GOLD MINERS',           'GOLDMINERS'],
  ['SILVER MINERS',         'SILVERMINERS'],
  ['USTREASURY',            'GOVBOND'],
  ['TRESURY',               'GOVBOND'],
  ['TREASURY',              'GOVBOND'],
  ['GOV BOND',              'GOVBOND'],
  ['GOVERNMENT BOND',       'GOVBOND'],
  ['CORP BOND',             'CORPBOND'],
  ['CORPORATE BOND',        'CORPBOND'],
  ['HIGH YIELD',            'HIGHYIELD'],
  ['INFLATION LINKED',      'INFLATIONLINKED'],
  ['INFLATION-LINKED',      'INFLATIONLINKED'],
  ['INFL LINKED',           'INFLATIONLINKED'],
  ['SHORT TERM',            'SHORTDURATION'],
  ['SHORT-TERM',            'SHORTDURATION'],
  ['LONG TERM',             'LONGDURATION'],
  ['LONG-TERM',             'LONGDURATION'],
  ['CONVERTIBLE',           'CONVERTIBLEBOND'],
  ['PARIS ALIGNED',         'PAB'],
  ['LOW CARBON',            'LOWCARBON'],
  ['NET ZERO',              'NETZERO'],
  ['FOSSIL FUEL FREE',      'FOSSILFUELFREE'],
]

// ─── Dimension Maps ──────────────────────────────────────────────────────────

const REGION_MAP: [string[], string][] = [
  [['EUROSTOXX50'],                               'EUROZONE'],
  [['EUROSTOXX','EUROSTX'],                       'EUROPE'],
  [['STOXX600'],                                  'EUROPE'],
  [['ALLCOUNTRY','ALLWORLD'],                     'GLOBAL'],
  [['SP500','RUSSELL1000'],                       'US'],
  [['NASDAQ100'],                                 'US'],
  [['RUSSELL2000'],                               'US'],
  [['SPTSX'],                                     'CANADA'],
  [['FTSEMIB'],                                   'ITALY'],
  [['CAC40'],                                     'FRANCE'],
  [['IBEX35'],                                    'SPAIN'],
  [['ASX200'],                                    'AUSTRALIA'],
  [['NIKKEI225'],                                 'JAPAN'],
  [['HANGSENGCHINA','HANGSENG'],                  'CHINA'],
  [['CSI300'],                                    'CHINA'],
  [['KOSPI'],                                     'KOREA'],
  [['SENSEX','NIFTY'],                            'INDIA'],
  [['MOEX'],                                      'RUSSIA'],
  [['TECDAX','DAX','MDAX','SDAX'],                'GERMANY'],
  [['WORLD'],                                     'WORLD'],
  [['GLOBAL'],                                    'GLOBAL'],
  [['EMERGINGMARKETS','EMERGING','EM'],            'EM'],
  [['EUROPE','EUROPEAN','EMU'],                   'EUROPE'],
  [['EUROZONE'],                                  'EUROZONE'],
  [['NORTHAMERICA'],                              'US'],
  [['USA','US'],                                  'US'],
  [['UK','UNITEDKINGDOM'],                        'UK'],
  [['JAPAN'],                                     'JAPAN'],
  [['CHINA'],                                     'CHINA'],
  [['INDIA'],                                     'INDIA'],
  [['GERMANY'],                                   'GERMANY'],
  [['FRANCE'],                                    'FRANCE'],
  [['SWITZERLAND'],                               'SWITZERLAND'],
  [['CANADA'],                                    'CANADA'],
  [['AUSTRALIA'],                                 'AUSTRALIA'],
  [['KOREA'],                                     'KOREA'],
  [['BRAZIL'],                                    'BRAZIL'],
  [['TAIWAN'],                                    'TAIWAN'],
  [['MEXICO'],                                    'MEXICO'],
  [['INDONESIA'],                                 'INDONESIA'],
  [['VIETNAM'],                                   'VIETNAM'],
  [['THAILAND'],                                  'THAILAND'],
  [['SOUTHAFRICA'],                               'SOUTH-AFRICA'],
  [['ASIAPACIFIC','APAC'],                        'ASIA-PACIFIC'],
  [['ASIA'],                                      'ASIA'],
  [['PACIFIC'],                                   'PACIFIC'],
  [['AFRICA'],                                    'AFRICA'],
  [['FRONTIERMARKETS','FRONTIER'],                'FRONTIER'],
  [['INTERNATIONAL'],                             'WORLD'],
]

const SUBREGION_MAP: [string[], string][] = [
  [['LATAM'],                           'LATAM'],
  [['EASTERNEUROPE'],                   'EASTERN-EUROPE'],
  [['SOUTHEASTASIA','ASEAN'],           'SE-ASIA'],
  [['ASIAEXJAPAN'],                     'ASIA-EX-JP'],
  [['EUROPEEXUK'],                      'EUROPE-EX-UK'],
  [['PACIFICEXJAPAN'],                  'PACIFIC-EX-JP'],
  [['WORLDEXUS'],                       'WORLD-EX-US'],
  [['EMERGINGASIA'],                    'EMERGING-ASIA'],
  [['NORDICS','NORDIC','SCANDINAVIA'],  'NORDICS'],
  [['GULF','GCC'],                      'GULF'],
]

const FACTOR_MAP: [string[], string][] = [
  [['VALUE','VAL'],             'VALUE'],
  [['DIVIDEND','DIV'],          'DIVIDEND'],
  [['MOMENTUM','MOM'],          'MOMENTUM'],
  [['QUALITY','QUAL'],          'QUALITY'],
  [['SMID'],                    'SMID'],
  [['SMALLCAP','SC'],           'SMALLCAP'],
  [['MIDCAP'],                  'MIDCAP'],
  [['MEGACAP','LARGECAP'],      'LARGECAP'],
  [['IMI'],                     'IMI'],
  [['MINVOL'],                  'MINVOL'],
  [['GROWTH'],                  'GROWTH'],
  [['EQUALWEIGHT'],             'EQUALWEIGHT'],
  [['MULTIFACTOR'],             'MULTIFACTOR'],
  [['DEVELOPED'],               'DEVELOPED'],
]

const SECTOR_MAP: [string[], string][] = [
  [['SEMICONDUCTORS'],                                    'SEMICONDUCTORS'],
  [['TECHNOLOGY','TECH'],                                 'TECH'],
  [['HEALTHCARE'],                                        'HEALTHCARE'],
  [['FINANCIALS','FINANCIAL','BANKS','BANKING'],          'FINANCIALS'],
  [['BASICRESOURCES'],                                    'BASIC-RESOURCES'],
  [['MATERIALS'],                                         'MATERIALS'],
  [['ENERGY'],                                            'ENERGY'],
  [['UTILITIES'],                                         'UTILITIES'],
  [['INDUSTRIALS'],                                       'INDUSTRIALS'],
  [['REALESTATE'],                                        'REAL-ESTATE'],
  [['CONSUMERDISCRETIONARY','DISCRETIONARY'],             'CONSUMER-DISC'],
  [['CONSUMERSTAPLES','STAPLES'],                         'CONSUMER-STAPLES'],
  [['COMMUNICATIONS','TELECOM'],                          'COMMUNICATIONS'],
  [['CYBERSECURITY'],                                     'CYBERSECURITY'],
  [['ROBOTICS','AUTOMATION'],                             'ROBOTICS'],
  [['WATER'],                                             'WATER'],
  [['CLEANENERGY'],                                       'CLEAN-ENERGY'],
  [['BIOTECHNOLOGY','BIOTECH','BIOPHARMA'],               'BIOTECH'],
  [['PHARMACEUTICALS','PHARMA'],                          'PHARMA'],
  [['CLOUDCOMPUTING'],                                    'CLOUD'],
  [['AI'],                                                'AI'],
  [['FUTUREMOBILITY'],                                    'MOBILITY'],
  [['GOLDMINERS'],                                        'GOLD-MINERS'],
  [['SILVERMINERS'],                                      'SILVER-MINERS'],
  [['MINERS','MINING'],                                   'MINERS'],
  [['DEFENSE','DEFENCE','AEROSPACE'],                     'DEFENSE'],
  [['INFRASTRUCTURE'],                                    'INFRASTRUCTURE'],
  [['AGRIBUSINESS','AGRICULTURE'],                        'AGRICULTURE'],
]

const BOND_TYPE_MAP: [string[], string][] = [
  [['GOVBOND'],          'GOVERNMENT'],
  [['CORPBOND'],         'CORPORATE'],
  [['HIGHYIELD'],        'HIGH-YIELD'],
  [['INFLATIONLINKED'],  'INFLATION-LINKED'],
  [['CONVERTIBLEBOND'],  'CONVERTIBLE'],
  [['BOND'],             'AGGREGATE'],
]

const BOND_DURATION_MAP: [string[], string][] = [
  [['SHORTDURATION'],  'SHORT'],
  [['LONGDURATION'],   'LONG'],
]

const ESG_SIGNALS = [
  'ESG','SRI','PAB','CTB','CLIMATE','SUSTAINABLE','RESPONSIBLE',
  'GREEN','IMPACT','LOWCARBON','NETZERO','FOSSILFUELFREE',
]
const HEDGE_SIGNALS = ['HEDGED','HDG','HDGD']

// ─── Commodity Detection ─────────────────────────────────────────────────────

const COMMODITIES: { commodity: string; terms: string[] }[] = [
  { commodity: 'GOLD',             terms: ['GOLD','XAU','GOLDBARREN'] },
  { commodity: 'SILVER',           terms: ['SILVER','XAG','SILBER'] },
  { commodity: 'PLATINUM',         terms: ['PLATINUM','XPT','PLATIN'] },
  { commodity: 'PALLADIUM',        terms: ['PALLADIUM','XPD'] },
  { commodity: 'COPPER',           terms: ['COPPER','KUPFER'] },
  { commodity: 'NICKEL',           terms: ['NICKEL'] },
  { commodity: 'ZINC',             terms: ['ZINC','ZINK'] },
  { commodity: 'TIN',              terms: ['TIN','ZINN'] },
  { commodity: 'ALUMINIUM',        terms: ['ALUMINIUM','ALUMINUM'] },
  { commodity: 'COBALT',           terms: ['COBALT'] },
  { commodity: 'LITHIUM',          terms: ['LITHIUM'] },
  { commodity: 'OIL',              terms: ['CRUDE OIL','BRENT','WTI','PETROLEUM'] },
  { commodity: 'GAS',              terms: ['NATURAL GAS','NAT GAS'] },
  { commodity: 'WHEAT',            terms: ['WHEAT','WEIZEN'] },
  { commodity: 'CORN',             terms: ['CORN','MAIS'] },
  { commodity: 'SOYBEANS',         terms: ['SOYBEAN','SOYA'] },
  { commodity: 'CARBON',           terms: ['CARBON','CO2','EMISSION'] },
  { commodity: 'PRECIOUS',         terms: ['PRECIOUS METALS','PRECIOUS MET'] },
  { commodity: 'INDUSTRIALMETALS', terms: ['INDUSTRIAL METALS','IND METALS'] },
  { commodity: 'AGRICULTURE',      terms: ['AGRICULTURE','AGRICULTURAL'] },
  { commodity: 'LIVESTOCK',        terms: ['LIVESTOCK'] },
  { commodity: 'BASKET',           terms: ['BLOOMBERG COMMODITY','BROAD COMMODITY','DIVERSIFIED COMMODITY','RICI','COMMODITY'] },
]

const COMMODITY_MODS: { key: string; terms: string[] }[] = [
  { key: 'HEDGED', terms: ['HEDGED','HDG','HDGD','CURRENCY HEDGED'] },
  { key: '2X',     terms: ['2X','2EX','DOUBLE LONG','DAILY 2X'] },
  { key: 'SHORT',  terms: ['SHORT','INVERSE','-1X','DAILY SHORT'] },
  { key: 'MINERS', terms: ['MINERS','MINING','MINE'] },
]

// ─── Match Helpers ───────────────────────────────────────────────────────────

function wb(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  return new RegExp(`(?<![A-Z])${escaped}(?![A-Z])`, 'i')
}

function matchFirst(name: string, map: [string[], string][]): string | null {
  for (const [aliases, canonical] of map) {
    for (const alias of aliases) {
      if (wb(alias).test(name)) return canonical
    }
  }
  return null
}

function matchAll(name: string, map: [string[], string][]): string[] {
  const found: string[] = []
  for (const [aliases, canonical] of map) {
    for (const alias of aliases) {
      if (wb(alias).test(name)) { found.push(canonical); break }
    }
  }
  return found
}

function hasAny(name: string, signals: string[]): boolean {
  return signals.some(s => wb(s).test(name))
}

// ─── Provider Strip ──────────────────────────────────────────────────────────

function stripAndDetectProvider(name: string): { stripped: string; priority: number } {
  const upper = name.toUpperCase()
  let bestMatch: { alias: string; canonical: string; priority: number } | null = null

  for (const [alias, canonical] of PROVIDER_ALIASES) {
    const regex = new RegExp(`^${alias}\\b|\\b${alias}\\b`, 'g')
    if (regex.test(upper)) {
      const prov = PROVIDERS.find(p => p.prefix === canonical)
      if (prov && (!bestMatch || alias.length > bestMatch.alias.length)) {
        bestMatch = { alias, canonical, priority: prov.priority }
      }
    }
  }

  if (bestMatch) {
    const stripped = upper.replace(new RegExp(`\\b${bestMatch.alias}\\b`, 'g'), '').trim()
    return { stripped: stripped.replace(/^[-\s]+/, ''), priority: bestMatch.priority }
  }
  return { stripped: upper, priority: 99 }
}

// ─── Abbreviation Expansion ──────────────────────────────────────────────────

function expandAbbreviations(name: string): string {
  let result = name.toUpperCase()
  for (const [abbr, expansion] of ABBREV) {
    if (!abbr) continue
    const escaped = abbr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
    result = result.replace(new RegExp(`(?<![A-Z])${escaped}(?![A-Z])`, 'gi'), expansion)
  }
  return result
}

// ─── Commodity Detection ─────────────────────────────────────────────────────

function detectCommodity(upper: string): { commodity: string; mods: string } | null {
  let found: string | null = null
  for (const { commodity, terms } of COMMODITIES) {
    for (const term of terms) {
      if (wb(term).test(upper)) { found = commodity; break }
    }
    if (found) break
  }
  if (!found) return null
  const mods: string[] = []
  for (const { key, terms } of COMMODITY_MODS) {
    for (const term of terms) {
      if (wb(term).test(upper)) { mods.push(key); break }
    }
  }
  return { commodity: found, mods: mods.join('|') }
}

function isBond(name: string): boolean {
  return /\bBOND\b|\bRENTEN\b|\bFIXED.?INCOME\b|\bGOVBOND\b|\bCORPBOND\b|\bHIGHYIELD\b|\bINFLATIONLINKED\b|\bAGGBOND\b|\bCONVERTIBLEBOND\b/i.test(name)
}

// ─── Structured Exposure Vector ───────────────────────────────────────────────

export interface ExposureVector {
  assetClass:   'EQUITY' | 'BOND' | 'COMMODITY'
  region:       string | null
  subregion:    string | null
  factors:      string[]        // sorted; empty = no factor tilt
  sector:       string | null
  bondType:     string | null
  bondDuration: string | null
  esg:          boolean
  hedged:       boolean
}

function extractExposureVector(instrument: Instrument): ExposureVector {
  const rawName = instrument.longName || instrument.displayName || ''
  const { stripped } = stripAndDetectProvider(rawName)
  const expanded = expandAbbreviations(stripped)

  // Commodity (ETC first, then check any instrument)
  const commodity = detectCommodity(expanded)
  if (commodity || instrument.type === 'ETC') {
    const mods = commodity?.mods ? commodity.mods.split('|') : []
    return {
      assetClass: 'COMMODITY',
      region: null, subregion: null, factors: [],
      sector: commodity?.commodity ?? null,
      bondType: null, bondDuration: null,
      esg: false,
      hedged: mods.includes('HEDGED'),
    }
  }

  const esg    = hasAny(expanded, ESG_SIGNALS)
  const hedged = hasAny(expanded, HEDGE_SIGNALS)

  // Bond
  if (isBond(expanded)) {
    return {
      assetClass:   'BOND',
      region:       matchFirst(expanded, REGION_MAP),
      subregion:    matchFirst(expanded, SUBREGION_MAP),
      factors:      [],
      sector:       null,
      bondType:     matchFirst(expanded, BOND_TYPE_MAP),
      bondDuration: matchFirst(expanded, BOND_DURATION_MAP),
      esg, hedged,
    }
  }

  // Equity
  return {
    assetClass:   'EQUITY',
    region:       matchFirst(expanded, REGION_MAP),
    subregion:    matchFirst(expanded, SUBREGION_MAP),
    factors:      matchAll(expanded, FACTOR_MAP).sort(),
    sector:       matchFirst(expanded, SECTOR_MAP),
    bondType:     null,
    bondDuration: null,
    esg, hedged,
  }
}

// ─── Vector → canonical key ───────────────────────────────────────────────────

function vectorToKey(v: ExposureVector): string {
  if (v.assetClass === 'COMMODITY') {
    const parts = [`COMMODITY:${v.sector ?? 'UNKNOWN'}`]
    if (v.hedged) parts.push('HEDGED')
    return parts.join('|')
  }

  if (v.assetClass === 'BOND') {
    const parts = [
      'BOND',
      `R:${v.region ?? '_'}`,
      `SR:${v.subregion ?? '_'}`,
      `BT:${v.bondType ?? '_'}`,
      `DUR:${v.bondDuration ?? '_'}`,
    ]
    if (v.esg)    parts.push('ESG')
    if (v.hedged) parts.push('HEDGED')
    return parts.join('|')
  }

  // EQUITY
  const parts = [
    `R:${v.region ?? '_'}`,
    `SR:${v.subregion ?? '_'}`,
    `F:${v.factors.length ? v.factors.join('+') : '_'}`,
    `S:${v.sector ?? '_'}`,
  ]
  if (v.esg)    parts.push('ESG')
  if (v.hedged) parts.push('HEDGED')
  return parts.join('|')
}

function extractExposureKey(instrument: Instrument): string {
  return vectorToKey(extractExposureVector(instrument))
}

/** @internal */
export function __test_extractExposureKey(instrument: Instrument): string {
  return extractExposureKey(instrument)
}

/** @internal */
export function __test_extractExposureVector(instrument: Instrument): ExposureVector {
  return extractExposureVector(instrument)
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
    if (inst.type === 'Stock') {
      groups.set(inst.isin, [inst])
      continue
    }
    const key = extractExposureKey(inst)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(inst)
  }

  const result: DedupGroup[] = []

  for (const [key, candidates] of groups) {
    const sorted = [...candidates].sort((a, b) => {
      const pa = stripAndDetectProvider(a.longName || a.displayName).priority
      const pb = stripAndDetectProvider(b.longName || b.displayName).priority
      if (pa !== pb) return pa - pb
      if (a.currency === 'EUR' && b.currency !== 'EUR') return -1
      if (b.currency === 'EUR' && a.currency !== 'EUR') return  1
      if (a.aum !== null && b.aum !== null) return b.aum! - a.aum!
      if (a.aum === null && b.aum !== null) return  1
      if (a.aum !== null && b.aum === null) return -1
      if (a.ter !== null && b.ter !== null) return a.ter! - b.ter!
      if (a.ter === null && b.ter !== null) return  1
      if (a.ter !== null && b.ter === null) return -1
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
  const winnerISINs = new Set(groups.map(g => g.winner.isin))
  const groupByISIN = new Map<string, { key: string; candidateISINs: string[] }>()

  for (const g of groups) {
    const candidateISINs = g.candidates.map(c => c.isin)
    for (const c of g.candidates) {
      groupByISIN.set(c.isin, { key: g.key, candidateISINs })
    }
  }

  return instruments.map(inst => {
    const group = groupByISIN.get(inst.isin)
    return {
      ...inst,
      dedupGroup:      group?.key,
      isDedupWinner:   winnerISINs.has(inst.isin),
      dedupCandidates: group?.candidateISINs.filter(isin => isin !== inst.isin),
    }
  })
}
