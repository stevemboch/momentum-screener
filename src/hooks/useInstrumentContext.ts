import { useState, useEffect, useCallback } from 'react'
import { apiFetchJson } from '../api/client'

const CONTEXT_TTL = 6 * 60 * 60 * 1000  // 6 Stunden

export interface ContextResult {
  lastEarnings: {
    date: string | null
    result: 'beat' | 'miss' | 'inline' | null
    detail: string | null
  } | null
  nextEarnings: string | null
  news: { headline: string; sentiment: 'positive' | 'negative' | 'neutral' }[]
  macroRisk: string | null
  fetchedAt: number
  error?: string
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
      if (Date.now() - parsed.fetchedAt < CONTEXT_TTL) setResult(parsed)
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
      const withTs = { ...data, fetchedAt: Date.now() }
      setResult(withTs)
      try {
        localStorage.setItem(cacheKey, JSON.stringify(withTs))
      } catch { /* quota ignore */ }
    } catch (e: any) {
      setResult({
        lastEarnings: null, nextEarnings: null, news: [],
        macroRisk: null, fetchedAt: Date.now(), error: e.message,
      })
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
