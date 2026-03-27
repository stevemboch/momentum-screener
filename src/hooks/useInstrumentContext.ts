import { useState, useEffect, useCallback } from 'react'
import { apiFetchJson } from '../api/client'

const CONTEXT_TTL = 6 * 60 * 60 * 1000  // 6 Stunden

type EarningsResult = 'beat' | 'miss' | 'inline'
type NewsSentiment = 'positive' | 'negative' | 'neutral'
type BankruptcyRiskLevel = 'low' | 'medium' | 'high'
type FinancialHealthStatus = 'healthy' | 'watch' | 'stressed'

interface BankruptcyRisk {
  level: BankruptcyRiskLevel | null
  signals: string[]
  detail: string | null
}

interface FinancialHealth {
  status: FinancialHealthStatus | null
  detail: string | null
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
  bankruptcyRisk: BankruptcyRisk | null
  financialHealth: FinancialHealth | null
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
      }
    : null

  const healthRaw = src.financialHealth
  const financialHealth = (healthRaw && typeof healthRaw === 'object')
    ? {
        status: asFinancialHealthStatus(healthRaw.status),
        detail: asNonEmptyString(healthRaw.detail),
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
    bankruptcyRisk,
    financialHealth,
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
