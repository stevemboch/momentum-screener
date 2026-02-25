// ─── Instrument Types ────────────────────────────────────────────────────────

export type InstrumentType = 'ETF' | 'ETC' | 'ETN' | 'Stock' | 'Unknown'
export type InputSource = 'manual' | 'xetra'

export interface Instrument {
  // Identity
  isin: string
  wkn?: string
  mnemonic?: string
  yahooTicker: string
  type: InstrumentType
  source: InputSource
  currency?: string
  firstTradingDate?: string
  xetraGroup?: string

  // Names
  xetraName?: string
  longName?: string
  displayName: string

  // Dedup
  dedupGroup?: string
  isDedupWinner?: boolean
  dedupCandidates?: string[]

  // AUM / TER
  aum?: number | null
  ter?: number | null
  justEtfFetched?: boolean
  justEtfError?: string

  // Price / momentum data
  closes?: number[]
  highs?: number[]
  lows?: number[]
  timestamps?: number[]
  r1m?: number | null
  r3m?: number | null
  r6m?: number | null
  vola?: number | null
  momentumScore?: number | null
  sharpeScore?: number | null
  momentumRank?: number
  sharpeRank?: number
  priceFetched?: boolean
  priceError?: string

  // Moving averages
  ma10?: number | null
  ma50?: number | null
  ma100?: number | null
  ma200?: number | null
  aboveMa10?: boolean | null
  aboveMa50?: boolean | null
  aboveMa100?: boolean | null
  aboveMa200?: boolean | null

  // ATR & Selling Threshold
  atr20?: number | null
  sellingThreshold?: number | null

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
  aumFloor: number
  atrMultiplier: number   // 3–5, default 4
  riskFreeRate: number    // annualised, default 0.035 (3.5%)
}

export type SortColumn =
  | 'momentumScore'
  | 'sharpeScore'
  | 'r1m' | 'r3m' | 'r6m'
  | 'vola'
  | 'aum' | 'ter'
  | 'pe' | 'pb' | 'earningsYield'
  | 'valueScore'
  | 'sellingThreshold'

export type SortDirection = 'asc' | 'desc'
export type TypeFilter = 'all' | 'etf' | 'stock'

export interface TableState {
  sortColumn: SortColumn
  sortDirection: SortDirection
  typeFilter: TypeFilter
  showDeduped: boolean
  aumFloor: number
  filterBelowRiskFree: boolean
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
  | 'idle' | 'parsing' | 'openfigi' | 'dedup' | 'justetf' | 'prices' | 'done' | 'error'

export interface FetchStatus {
  phase: FetchPhase
  message: string
  current: number
  total: number
}

// ─── ETF Groups ─────────────────────────────────────────────────────────────

export interface ETFGroup {
  label: string
  groupKey: string
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
  { label: 'DAX',                  groupKey: 'DAX' },
  { label: 'MDAX',                 groupKey: 'MDAX' },
  { label: 'SDAX',                 groupKey: 'SDAX' },
  { label: 'Deutschland',          groupKey: 'DEUTSCHLAND' },
  { label: 'Nordamerika',          groupKey: 'NORDAMERIKA' },
  { label: 'Frankreich',           groupKey: 'FRANKREICH' },
  { label: 'Großbritannien',       groupKey: 'GROSSBRITANNIEN' },
  { label: 'Skandinavien',         groupKey: 'SKANDINAVIEN' },
  { label: 'Schweiz',              groupKey: 'SCHWEIZ LIECHTENSTEIN' },
  { label: 'Benelux',              groupKey: 'BELGIEN NIEDERLANDE LUXEMBURG' },
  { label: 'Italien/Griechenland', groupKey: 'ITALIEN GRIECHENLAND' },
  { label: 'Österreich',           groupKey: 'OESTERREICH' },
  { label: 'Spanien/Portugal',     groupKey: 'SPANIEN PORTUGAL' },
  { label: 'Others',               groupKey: '__OTHER_STOCKS__' },
]

export const DEFAULT_ETF_GROUPS = ['EXCHANGE TRADED FUNDS - PASSIV', 'EXCHANGE TRADED COMMODITIES']
export const DEFAULT_STOCK_GROUPS = ['DAX', 'MDAX', 'SDAX']