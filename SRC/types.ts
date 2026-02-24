// ─── Instrument Types ────────────────────────────────────────────────────────

export type InstrumentType = 'ETF' | 'ETC' | 'ETN' | 'Stock' | 'Unknown'
export type InputSource = 'manual' | 'xetra'

export interface Instrument {
  // Identity
  isin: string
  wkn?: string
  mnemonic?: string          // Xetra ticker (e.g. EUNL)
  yahooTicker: string        // e.g. EUNL.DE
  type: InstrumentType
  source: InputSource
  currency?: string
  firstTradingDate?: string
  xetraGroup?: string        // Product Assignment Group Description

  // Names
  xetraName?: string         // Abbreviated Xetra name
  longName?: string          // OpenFIGI name (ALL CAPS)
  displayName: string        // Best available name for display

  // Dedup
  dedupGroup?: string        // Exposure key
  isDedupWinner?: boolean
  dedupCandidates?: string[] // ISINs of other candidates in group

  // justETF data
  aum?: number | null        // Raw EUR value
  ter?: number | null        // Decimal percentage (0.2 = 0.20%)
  justEtfFetched?: boolean
  justEtfError?: string

  // Price / momentum data
  closes?: number[]
  timestamps?: number[]
  r1m?: number | null
  r3m?: number | null
  r6m?: number | null
  vola?: number | null       // Annualised 6M volatility
  momentumScore?: number | null
  sharpeScore?: number | null
  momentumRank?: number
  sharpeRank?: number
  priceFetched?: boolean
  priceError?: string

  // Fundamentals
  pe?: number | null
  pb?: number | null
  earningsYield?: number | null
  ebitda?: number | null
  enterpriseValue?: number | null
  returnOnAssets?: number | null
  fundamentalsFetched?: boolean

  // Value score
  valueScore?: number | null
  valueRank?: number
  valueScoreModel?: 'etf' | 'magic-formula' | 'fallback'
}

// ─── App State ──────────────────────────────────────────────────────────────

export interface MomentumWeights {
  w1m: number
  w3m: number
  w6m: number
}

export interface AppSettings {
  weights: MomentumWeights
  aumFloor: number           // EUR value, default 100_000_000
}

export type SortColumn =
  | 'momentumScore'
  | 'sharpeScore'
  | 'r1m' | 'r3m' | 'r6m'
  | 'vola'
  | 'aum' | 'ter'
  | 'pe' | 'pb' | 'earningsYield'
  | 'valueScore'

export type SortDirection = 'asc' | 'desc'

export type TypeFilter = 'all' | 'etf' | 'stock'

export interface TableState {
  sortColumn: SortColumn
  sortDirection: SortDirection
  typeFilter: TypeFilter
  showDeduped: boolean
  aumFloor: number
}

// ─── Xetra CSV Row ──────────────────────────────────────────────────────────

export interface XetraRow {
  instrument: string
  isin: string
  wkn: string
  mnemonic: string
  instrumentType: string
  group: string
  currency: string
  firstTradingDate: string
}

// ─── Fetch Status ───────────────────────────────────────────────────────────

export type FetchPhase =
  | 'idle'
  | 'parsing'
  | 'openfigi'
  | 'dedup'
  | 'justetf'
  | 'prices'
  | 'done'
  | 'error'

export interface FetchStatus {
  phase: FetchPhase
  message: string
  current: number
  total: number
}

// ─── ETF Groups ─────────────────────────────────────────────────────────────

export interface ETFGroup {
  label: string
  groupKey: string          // matches Product Assignment Group Description
  count: number
  enabled: boolean
}

export const ETF_GROUPS: Omit<ETFGroup, 'count' | 'enabled'>[] = [
  { label: 'Passive ETFs',       groupKey: 'EXCHANGE TRADED FUNDS - PASSIV' },
  { label: 'ETCs (Commodities)', groupKey: 'EXCHANGE TRADED COMMODITIES' },
  { label: 'Bond ETFs',          groupKey: 'EXCHANGE TRADED FUNDS - RENTEN' },
  { label: 'Active ETFs',        groupKey: 'EXCHANGE TRADED FUNDS - AKTIV' },
  { label: 'USD – Equity',       groupKey: 'ETF - CURRENCY USD' },
  { label: 'USD – Bond',         groupKey: 'ETF RENTEN - FOREIGN CURRENCY' },
]

export const STOCK_GROUPS: Omit<ETFGroup, 'count' | 'enabled'>[] = [
  { label: 'DAX',                groupKey: 'DAX' },
  { label: 'MDAX',               groupKey: 'MDAX' },
  { label: 'SDAX',               groupKey: 'SDAX' },
  { label: 'Deutschland',        groupKey: 'DEUTSCHLAND' },
  { label: 'Nordamerika',        groupKey: 'NORDAMERIKA' },
  { label: 'Frankreich',         groupKey: 'FRANKREICH' },
  { label: 'Großbritannien',     groupKey: 'GROSSBRITANNIEN' },
  { label: 'Skandinavien',       groupKey: 'SKANDINAVIEN' },
  { label: 'Schweiz',            groupKey: 'SCHWEIZ LIECHTENSTEIN' },
  { label: 'Benelux',            groupKey: 'BELGIEN NIEDERLANDE LUXEMBURG' },
  { label: 'Italien/Griechenland', groupKey: 'ITALIEN GRIECHENLAND' },
  { label: 'Österreich',         groupKey: 'OESTERREICH' },
  { label: 'Spanien/Portugal',   groupKey: 'SPANIEN PORTUGAL' },
  { label: 'Others',             groupKey: '__OTHER_STOCKS__' },
]

export const DEFAULT_ETF_GROUPS = ['EXCHANGE TRADED FUNDS - PASSIV', 'EXCHANGE TRADED COMMODITIES']
export const DEFAULT_STOCK_GROUPS = ['DAX', 'MDAX', 'SDAX']
