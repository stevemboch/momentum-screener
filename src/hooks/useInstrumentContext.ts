import { useState, useEffect, useCallback } from 'react'
import { apiFetchJson } from '../api/client'

const CONTEXT_TTL = 6 * 60 * 60 * 1000  // 6 Stunden

type EarningsResult = 'beat' | 'miss' | 'inline'
type NewsSentiment = 'positive' | 'negative' | 'neutral'
type BankruptcyRiskLevel = 'low' | 'medium' | 'high'
type FinancialHealthStatus = 'healthy' | 'watch' | 'stressed'
type SourceType = 'primary' | 'regulatory' | 'major_media' | 'secondary'
type Confidence = 'high' | 'medium' | 'low'
type DataQuality = 'high' | 'medium' | 'low'

interface EvidenceItem {
  sourceName: string | null
  sourceType: SourceType
  url: string | null
  publishedAt: string | null
  confidence: Confidence
  confidenceReason: string | null
}

interface BankruptcyRisk {
  level: BankruptcyRiskLevel | null
  signals: string[]
  detail: string | null
  evidence: EvidenceItem[]
  insufficientEvidenceReason: string | null
}

interface FinancialHealth {
  status: FinancialHealthStatus | null
  detail: string | null
  evidence: EvidenceItem[]
  insufficientEvidenceReason: string | null
}

export interface ContextResult {
  lastEarnings: {
    date: string | null
    result: EarningsResult | null
    detail: string | null
  } | null
  nextEarnings: string | null
  news: { headline: string; sentiment: NewsSentiment }[]
  macroRisk: string | null
  macroRiskEvidence: EvidenceItem[]
  macroRiskInsufficientEvidenceReason: string | null
  bankruptcyRisk: BankruptcyRisk | null
  financialHealth: FinancialHealth | null
  asOf: string | null
  searchWindow: { from: string | null; to: string | null }
  dataQuality: DataQuality | null
  diagnostics?: {
    modelId?: string
    searchMode?: string
    parseRetry?: boolean
    evidenceCount?: number
    jsonResponseMode?: boolean
  }
  fetchedAt: number
  error?: string
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.trim()
  return cleaned.length > 0 ? cleaned : null
}

function asEarningsResult(value: unknown): EarningsResult | null {
  return value === 'beat' || value === 'miss' || value === 'inline' ? value : null
}

function asSentiment(value: unknown): NewsSentiment {
  return value === 'positive' || value === 'negative' || value === 'neutral' ? value : 'neutral'
}

function asBankruptcyRiskLevel(value: unknown): BankruptcyRiskLevel | null {
  return value === 'low' || value === 'medium' || value === 'high' ? value : null
}

function asFinancialHealthStatus(value: unknown): FinancialHealthStatus | null {
  return value === 'healthy' || value === 'watch' || value === 'stressed' ? value : null
}

function asSourceType(value: unknown): SourceType {
  if (value === 'primary' || value === 'regulatory' || value === 'major_media' || value === 'secondary') return value
  return 'secondary'
}

function asConfidence(value: unknown): Confidence {
  if (value === 'high' || value === 'medium' || value === 'low') return value
  return 'low'
}

function asDataQuality(value: unknown): DataQuality | null {
  if (value === 'high' || value === 'medium' || value === 'low') return value
  return null
}

function normalizeEvidence(value: unknown): EvidenceItem | null {
  if (!value || typeof value !== 'object') return null
  const src = value as any
  return {
    sourceName: asNonEmptyString(src.sourceName),
    sourceType: asSourceType(src.sourceType),
    url: asNonEmptyString(src.url),
    publishedAt: asNonEmptyString(src.publishedAt),
    confidence: asConfidence(src.confidence),
    confidenceReason: asNonEmptyString(src.confidenceReason),
  }
}

function normalizeEvidenceList(value: unknown, max = 3): EvidenceItem[] {
  if (!Array.isArray(value)) return []
  return value.map(normalizeEvidence).filter(Boolean).slice(0, max) as EvidenceItem[]
}

function normalizeContext(raw: any, fetchedAtFallback: number): ContextResult {
  const src = (raw && typeof raw === 'object') ? raw : {}

  const lastRaw = src.lastEarnings
  const lastEarnings = (lastRaw && typeof lastRaw === 'object')
    ? {
        date: asNonEmptyString(lastRaw.date),
        result: asEarningsResult(lastRaw.result),
        detail: asNonEmptyString(lastRaw.detail),
      }
    : null

  const news = Array.isArray(src.news)
    ? src.news
        .map((item: any) => {
          if (!item || typeof item !== 'object') return null
          const headline = asNonEmptyString(item.headline)
          if (!headline) return null
          return {
            headline,
            sentiment: asSentiment(item.sentiment),
          }
        })
        .filter(Boolean) as { headline: string; sentiment: NewsSentiment }[]
    : []

  const bankruptcyRaw = src.bankruptcyRisk
  const bankruptcyRisk = (bankruptcyRaw && typeof bankruptcyRaw === 'object')
    ? {
        level: asBankruptcyRiskLevel(bankruptcyRaw.level),
        signals: Array.isArray(bankruptcyRaw.signals)
          ? bankruptcyRaw.signals
              .map((s: unknown) => asNonEmptyString(s))
              .filter(Boolean)
              .slice(0, 3) as string[]
          : [],
        detail: asNonEmptyString(bankruptcyRaw.detail),
        evidence: normalizeEvidenceList(bankruptcyRaw.evidence, 3),
        insufficientEvidenceReason: asNonEmptyString(bankruptcyRaw.insufficientEvidenceReason),
      }
    : null

  const healthRaw = src.financialHealth
  const financialHealth = (healthRaw && typeof healthRaw === 'object')
    ? {
        status: asFinancialHealthStatus(healthRaw.status),
        detail: asNonEmptyString(healthRaw.detail),
        evidence: normalizeEvidenceList(healthRaw.evidence, 3),
        insufficientEvidenceReason: asNonEmptyString(healthRaw.insufficientEvidenceReason),
      }
    : null

  const fetchedAt = (typeof src.fetchedAt === 'number' && Number.isFinite(src.fetchedAt))
    ? src.fetchedAt
    : fetchedAtFallback

  const error = asNonEmptyString(src.error) ?? undefined

  return {
    lastEarnings,
    nextEarnings: asNonEmptyString(src.nextEarnings),
    news,
    macroRisk: asNonEmptyString(src.macroRisk),
    macroRiskEvidence: normalizeEvidenceList(src.macroRiskEvidence, 3),
    macroRiskInsufficientEvidenceReason: asNonEmptyString(src.macroRiskInsufficientEvidenceReason),
    bankruptcyRisk,
    financialHealth,
    asOf: asNonEmptyString(src.asOf),
    searchWindow: {
      from: asNonEmptyString(src.searchWindow?.from),
      to: asNonEmptyString(src.searchWindow?.to),
    },
    dataQuality: asDataQuality(src.dataQuality),
    diagnostics: (src.diagnostics && typeof src.diagnostics === 'object')
      ? {
          modelId: asNonEmptyString(src.diagnostics.modelId) ?? undefined,
          searchMode: asNonEmptyString(src.diagnostics.searchMode) ?? undefined,
          parseRetry: typeof src.diagnostics.parseRetry === 'boolean' ? src.diagnostics.parseRetry : undefined,
          evidenceCount: typeof src.diagnostics.evidenceCount === 'number' ? src.diagnostics.evidenceCount : undefined,
          jsonResponseMode: typeof src.diagnostics.jsonResponseMode === 'boolean' ? src.diagnostics.jsonResponseMode : undefined,
        }
      : undefined,
    fetchedAt,
    error,
  }
}

export function useInstrumentContext(isin: string) {
  const [result, setResult] = useState<ContextResult | null>(null)
  const [loading, setLoading] = useState(false)
  const cacheKey = `cache:context:${isin}`

  // Beim Mount gecachtes Ergebnis laden
  useEffect(() => {
    try {
      const raw = localStorage.getItem(cacheKey)
      if (!raw) return
      const parsed = JSON.parse(raw)
      const fetchedAt = (parsed && typeof parsed === 'object' && typeof parsed.fetchedAt === 'number')
        ? parsed.fetchedAt
        : null
      if (fetchedAt == null) return
      if (Date.now() - fetchedAt < CONTEXT_TTL) {
        setResult(normalizeContext(parsed, fetchedAt))
      }
    } catch { /* ignore */ }
  }, [isin])

  const load = useCallback(async (
    ticker: string,
    name: string,
    lastPrice: number | null,
    targetPrice: number | null
  ) => {
    setLoading(true)
    try {
      const data = await apiFetchJson<any>('/api/claude-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, name, lastPrice, targetPrice }),
      })
      const withTs = normalizeContext(data, Date.now())
      setResult(withTs)
      try {
        localStorage.setItem(cacheKey, JSON.stringify(withTs))
      } catch { /* quota ignore */ }
    } catch (e: any) {
      setResult(normalizeContext({ error: e?.message ?? 'Failed to load context' }, Date.now()))
    } finally {
      setLoading(false)
    }
  }, [isin])

  const invalidate = useCallback(() => {
    localStorage.removeItem(cacheKey)
    setResult(null)
  }, [isin])

  return { result, loading, load, invalidate }
}
