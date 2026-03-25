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
  priceCurrency?: string | null
  firstTradingDate?: string
  xetraGroup?: string
  sector?: string | null
  industry?: string | null

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
  analystCurrency?: string | null
  analystCurrentPrice?: number | null
  targetPriceAdj?: number | null
  targetLowAdj?: number | null
  targetHighAdj?: number | null
  targetFxRate?: number | null
  targetFxApplied?: boolean
  targetCurrencyUnknown?: boolean
  marketCap?: number | null
  analystSource?: 'yahoo' | 'marketscreener' | 'optionsanalysissuite' | 'leeway'
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
  leewayFetched?: boolean
  leewayError?: string | null
  earningsYieldRank?: number
  returnOnAssetsRank?: number

  // Value score
  valueScore?: number | null
  valueRank?: number
  valueScoreModel?: 'etf' | 'magic-formula' | 'fallback'

  // Pullback
  pullbackScore?: number | null      // 0–1 Gesamt-Pullback-Signal
  pullbackStop?: number | null       // konkreter Stop-Loss Kurs
  pullbackTarget?: number | null     // konkretes Kursziel
  pullbackRR?: number | null         // Risk-Reward-Ratio (z.B. 1.5)
  pullbackSignals?: {
    s1: number   // RSI unter 35 (stark überverkauft)
    s2: number   // RSI dreht nach oben
    s3: number   // Volumen rückläufig im Rücksetzer
    s4: number   // Kurs nahe MA50 (Support)
    s5: number   // Kurzfristiges Higher Low (5 Tage)
  } | null

  // TFA – Turnaround Formula
  rsi14?: number | null
  drawFromHigh?: number | null   // % unter 52W-Hoch, negativ
  levyRS?: number | null         // Kurs / 26W-GD
  higherLow?: boolean | null
  tfaTSignals?: { t1: number; t2: number; t3: number; t4: number; t5: number } | null
  tfaTScore?: number | null      // 0–1, technische Bodensignale
  tfaFSignals?: { f1: number; f2: number; f3: number } | null
  tfaFScore?: number | null      // 0–1, fundamentale Intaktheit
  tfaEScore?: number | null      // 0–1, Katalysatoren (Gemini)
  tfaCatalyst?: {
    earningsBeatRecent: { value: number; confidence: string; source: string | null } | null
    earningsBeatPrior: { value: number; confidence: string; source: string | null } | null
    guidanceRaised: { value: number; confidence: string; source: string | null } | null
    analystUpgrade: { value: number; confidence: string; source: string | null } | null
    insiderBuying: { value: number; confidence: string; source: string | null } | null
    restructuring: { value: number; confidence: string; source: string | null } | null
    koRisk: { value: boolean; confidence: string; source: string | null } | null
    eScore: number | null
    summary: string | null
    fetchedAt: number | null
  } | null
  tfaScore?: number | null       // 0–1, Gesamtscore
  tfaPhase?: TfaPhase
  tfaRejectReason?: string
  tfaKO?: boolean                // true = disqualifiziert
  tfaFetched?: boolean
  maCrossover?: {
    ma50: boolean | null
    ma100: boolean | null
    ma200: boolean | null
    any: boolean
    risingMa: 'ma50' | 'ma100' | 'ma200' | null
    stillValid: boolean
  } | null
  tfaCrossoverDaysAgo?: number | null

  // TFA – Mehrjahres-Erweiterung (Wochendaten)
  closesWeekly?: number[]
  timestampsWeekly?: number[]
  drawFrom5YHigh?: number | null
  drawFrom7YHigh?: number | null
  weeklyRsi14?: number | null
  weeklyLevyRS?: number | null
  weeklyHigherLow?: boolean | null
  weeklyVolaRatio?: number | null
  tfaScenario?: '52w' | '5y' | '7y' | null
  tfaTScore5Y?: number | null
  tfaFScore5Y?: number | null
  tfaTSignals5Y?: { t1: number; t2: number; t3: number; t4: number; t5: number } | null
  tfaFSignals5Y?: { f1: number; f2: number; f3: number; f4: number; f5: number } | null
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

export interface RegimeBenchmark {
  label: string
  ticker: string
  aboveMa200: boolean | null
}

export interface RegimeResult {
  regime: MarketRegime
  confidence: number
  summary: string
  suggestion: string
  benchmarks?: RegimeBenchmark[]
  computedAt: number
}

export type SortColumn =
  | 'momentumScore'
  | 'riskAdjustedScore'
  | 'r1m' | 'r3m' | 'r6m'
  | 'vola'
  | 'aum' | 'ter'
  | 'marketCap'
  | 'pe' | 'pb' | 'earningsYield' | 'returnOnAssets'
  | 'combinedScore'
  | 'breakoutScore'
  | 'sellingThreshold'
  | 'tfaScore' | 'drawFromHigh' | 'rsi14' | 'levyRS' | 'tfaTScore' | 'tfaFScore'
  | 'drawFrom5YHigh' | 'drawFrom7YHigh' | 'weeklyRsi14' | 'weeklyVolaRatio'
  | 'tfaTScore5Y' | 'tfaFScore5Y'
  | 'tfaCrossoverDaysAgo'
  | 'pullbackScore' | 'pullbackStop' | 'pullbackTarget' | 'pullbackRR'

export type SortDirection = 'asc' | 'desc'
export type TypeFilter = 'all' | 'etf' | 'stock'

export type ColumnGroup =
  'scores' | 'returns' | 'technical' | 'fundamentals' | 'breakout' | 'tfa' | 'pullback'

export type TfaPhase =
  | 'none'
  | 'monitoring'
  | 'above_all_mas'
  | 'watch'
  | 'fetching'
  | 'qualified'
  | 'rejected'
  | 'ko'

export type AiFilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in'

export interface AiFilterRule {
  field: string
  operator: AiFilterOperator
  value: string | number | boolean | null | Array<string | number | boolean | null>
  fallback?: string | number | boolean | null
}

export interface AiFilterPlan {
  version: 1
  match: 'all' | 'any'
  rules: AiFilterRule[]
}

export interface TableState {
  sortColumn: SortColumn
  sortDirection: SortDirection
  typeFilter: TypeFilter
  showDeduped: boolean
  filterBelowRiskFree: boolean
  filterBelowAllMAs: boolean
  tfaMode: boolean
  pullbackMode: boolean
  aiFilterPlan: AiFilterPlan | null
  aiFilterQuery: string | null
  aiFilterActive: boolean
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
