import type { Instrument } from './types'

export type UniverseCode = 'index_global' | 'legacy_xetra'
export type UniverseStatus = 'fresh' | 'stale'

export interface UniverseConstituent {
  isin: string
  /** ISIN when supplied; otherwise an exchange-bound OpenFIGI identity. */
  identifierType?: 'ISIN' | 'FIGI'
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
  status: UniverseStatus
  asOfDate: string
  retrievedAt: string
  version: string
  sources: Array<{
    code: string
    benchmark: string
    region: string
    sourceType?: 'ETF_HOLDINGS_PROXY' | 'OFFICIAL_INDEX'
    inputRows?: number
    resolvedRows?: number
    unresolvedRows?: number
    isinMatchRate?: number
    memberCount: number
    retrievedAt: string
  }>
  constituents: UniverseConstituent[]
}

export const UNIVERSE_SNAPSHOT_KEY = 'universe:snapshot:index_global:v1'

export function constituentToInstrument(constituent: UniverseConstituent): Instrument {
  return {
    isin: constituent.isin,
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
