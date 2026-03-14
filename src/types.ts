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
  yahooLongName?: string
  displayName: string

  // Dedup
  dedupGroup?: string
  isDedupWinner?: boolean
  dedupCandidates?: string[]
  inPortfolio?: boolean

  // AUM / TER
  aum?: number | null
  ter?: number | null
  justEtfFetched?: boolean
  justEtfError?: string

  // Price / momentum data
  closes?: number[]
  highs?: number[]
  lows?: number[]
  volumes?: number[]
  timestamps?: number[]
  r1m?: number | null
  r3m?: number | null
  r6m?: number | null
  vola?: number | null
  momentumScore?: number | null
  riskAdjustedScore?: number | null
  momentumRank?: number
  riskAdjustedRank?: number
  combinedScore?: number | null
  combinedRank?: number
  breakoutDate?: number
  breakoutAgeDays?: number
  breakoutScore?: number | null
  breakoutConfirmed?: boolean
  breakoutFlags?: {
    ma200Rising?: boolean
    goldenCross?: boolean
    relStrength?: boolean
    volumeConfirm?: boolean
    retest?: boolean
  }
  priceFetched?: boolean
  priceError?: string

  // Analyst data (stocks, on-demand)
  analystRating?: number | null
  analystRatingKey?: string | null
  analystOpinions?: number | null
  targetPrice?: number | null
  targetLow?: number | null
  targetHigh?: number | null
  analystSource?: 'yahoo' | 'marketscreener' | 'optionsanalysissuite'
  analystFetched?: boolean
  analystError?: string

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
  earningsYieldRank?: number
  returnOnAssetsRank?: number

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

export type MarketRegime = 'RISK_ON' | 'RISK_OFF' | 'SIDEWAYS' | 'TRANSITION'

export interface RegimeResult {
  regime: MarketRegime
  confidence: number
  summary: string
  suggestion: string
  computedAt: number
}

export type SortColumn =
  | 'momentumScore'
  | 'riskAdjustedScore'
  | 'r1m' | 'r3m' | 'r6m'
  | 'vola'
  | 'aum' | 'ter'
  | 'pe' | 'pb' | 'earningsYield' | 'returnOnAssets'
  | 'combinedScore'
  | 'breakoutScore'
  | 'sellingThreshold'

export type SortDirection = 'asc' | 'desc'
export type TypeFilter = 'all' | 'etf' | 'stock'

export type ColumnGroup =
  'scores' | 'returns' | 'technical' | 'fundamentals' | 'breakout'

export interface TableState {
  sortColumn: SortColumn
  sortDirection: SortDirection
  typeFilter: TypeFilter
  showDeduped: boolean
  filterBelowRiskFree: boolean
  filterBelowAllMAs: boolean
  hiddenColumnGroups: ColumnGroup[]
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
  { label: 'DE',                   groupKey: 'DEUTSCHLAND' },
  { label: 'NA',                   groupKey: 'NORDAMERIKA' },
  { label: 'FR',                   groupKey: 'FRANKREICH' },
  { label: 'UK',                   groupKey: 'GROSSBRITANNIEN' },
  { label: 'SCAND',                groupKey: 'SKANDINAVIEN' },
  { label: 'CH',                   groupKey: 'SCHWEIZ LIECHTENSTEIN' },
  { label: 'BENELUX',              groupKey: 'BELGIEN NIEDERLANDE LUXEMBURG' },
  { label: 'IT/GR',                groupKey: 'ITALIEN GRIECHENLAND' },
  { label: 'AT',                   groupKey: 'OESTERREICH' },
  { label: 'ES/PT',                groupKey: 'SPANIEN PORTUGAL' },
  { label: 'Others',               groupKey: '__OTHER_STOCKS__' },
]

export const DEFAULT_ETF_GROUPS = ['EXCHANGE TRADED FUNDS - PASSIV', 'EXCHANGE TRADED COMMODITIES']
export const DEFAULT_STOCK_GROUPS = ['DAX', 'MDAX', 'SDAX']
