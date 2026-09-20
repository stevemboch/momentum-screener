import type { Instrument } from './types'

export type UniverseCode = 'index_global' | 'legacy_xetra'
export type UniverseStatus = 'fresh' | 'stale'

export interface UniverseConstituent {
  isin: string
  /** ISIN when supplied; otherwise a deterministic source-listing identity. */
  identifierType?: 'ISIN' | 'LISTING'
  cusip?: string | null
  ticker: string | null
  yahooTicker?: string | null
  name: string
  sector: string | null
  sourceSector: string | null
  primaryListingCountry: string | null
  sourceCountry: string | null
  weight: number | null
  benchmark: string
  region: string
  source: string
  memberships?: string[]
}

export interface UniverseSnapshot {
  universeCode: UniverseCode
  nasdaqVariant?: '100' | 'composite'
  /** Sources actually imported; source metadata may additionally list all selectable groups. */
  selectedSources?: string[]
  status: UniverseStatus
  asOfDate: string
  retrievedAt: string
  version: string
  sources: Array<{
    code: string
    benchmark: string
    region: string
    sourceType?: 'ETF_HOLDINGS_PROXY' | 'TRACKING_FUND_DISCLOSURE' | 'OFFICIAL_LISTING_SCREEN' | 'OFFICIAL_INDEX'
    inputRows?: number
    resolvedRows?: number
    unresolvedRows?: number
    isinMatchRate?: number
    memberCount: number
    retrievedAt: string
  }>
  constituents: UniverseConstituent[]
}

export const UNIVERSE_SNAPSHOT_KEY = 'universe:snapshot:index_global:v4'

/**
 * Nasdaq 100 and Nasdaq Composite are interchangeable variants of the same
 * user-facing universe component. Their source code changes with the picker,
 * but their checkbox selection must not.
 */
export function indexFilterGroupKey(sourceCode: string): string {
  return sourceCode === 'NASDAQ_100' || sourceCode === 'NASDAQ_COMPOSITE'
    ? 'NASDAQ_COMPONENT'
    : sourceCode
}

// These are source choices, rather than loaded constituent groups. Keeping
// them client-side lets the membership picker work before the first snapshot
// has been fetched; counts are filled in once that snapshot is available.
export const INDEX_UNIVERSE_GROUPS = [
  { label: 'STOXX Europe 600', groupKey: 'STOXX_EUROPE_600' },
  { label: 'S&P 500', groupKey: 'SP_500' },
  { label: 'S&P MidCap 400', groupKey: 'SP_MIDCAP_400' },
  { label: 'S&P SmallCap 600', groupKey: 'SP_SMALLCAP_600' },
  { label: 'Nasdaq component', groupKey: 'NASDAQ_COMPONENT' },
  { label: 'MSCI Japan', groupKey: 'MSCI_JAPAN' },
  { label: 'MSCI Pacific ex Japan', groupKey: 'MSCI_PACIFIC_EX_JAPAN' },
  { label: 'MSCI Emerging Markets', groupKey: 'MSCI_EM' },
  { label: 'SDAX', groupKey: 'SDAX' },
  { label: 'HDAX', groupKey: 'HDAX' },
] as const

export function constituentToInstrument(constituent: UniverseConstituent): Instrument {
  return {
    isin: constituent.isin,
    cusip: constituent.cusip ?? undefined,
    mnemonic: constituent.ticker ?? undefined,
    yahooTicker: constituent.yahooTicker ?? constituent.ticker ?? '',
    type: 'Stock',
    source: 'index',
    displayName: constituent.name || constituent.isin,
    longName: constituent.name || undefined,
    sector: constituent.sector,
    sourceSector: constituent.sourceSector,
    primaryListingCountry: constituent.primaryListingCountry,
    sourceCountry: constituent.sourceCountry,
    indexRegion: constituent.region,
    universeMemberships: constituent.memberships?.length ? constituent.memberships : [constituent.benchmark],
  }
}

export function readCachedSnapshot(): UniverseSnapshot | null {
  try {
    const raw = localStorage.getItem(UNIVERSE_SNAPSHOT_KEY)
    if (!raw) return null
    const snapshot = JSON.parse(raw) as UniverseSnapshot
    if (snapshot?.universeCode !== 'index_global' || !Array.isArray(snapshot.constituents)) return null
    return { ...snapshot, status: 'stale' }
  } catch {
    return null
  }
}

export function cacheSnapshot(snapshot: UniverseSnapshot) {
  try { localStorage.setItem(UNIVERSE_SNAPSHOT_KEY, JSON.stringify(snapshot)) } catch { /* best effort */ }
}
