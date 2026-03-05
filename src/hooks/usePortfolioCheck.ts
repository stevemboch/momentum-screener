import { useState, useCallback } from 'react'
import { useAppState } from '../store'

export interface PortfolioCheckResult {
  severity: 'ok' | 'warning' | 'critical'
  findings: string[]
}

export function usePortfolioCheck() {
  const { state } = useAppState()
  const [result, setResult] = useState<PortfolioCheckResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async () => {
    const portfolioInstruments = state.instruments.filter(i => i.inPortfolio)
    if (portfolioInstruments.length === 0) return

    const payload = portfolioInstruments.map(i => ({
      name:      i.displayName,
      type:      i.type,
      region:    i.dedupGroup?.match(/R:([^|]+)/)?.[1] ?? null,
      subregion: i.dedupGroup?.match(/SR:([^|]+)/)?.[1] ?? null,
      sector:    i.dedupGroup?.match(/S:([^|]+)/)?.[1] ?? null,
      factors:   i.dedupGroup?.match(/F:([^|]+)/)?.[1] ?? null,
      momentumRank:     i.momentumRank ?? null,
      riskAdjustedRank: i.riskAdjustedRank ?? null,
      valueRank:        i.valueRank ?? null,
      r3m:      i.r3m ?? null,
      r6m:      i.r6m ?? null,
      vola:     i.vola ?? null,
      isEsg:    i.dedupGroup?.includes('ESG') ?? false,
      isHedged: i.dedupGroup?.includes('HEDGED') ?? false,
    }))

    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/claude-portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruments: payload }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setResult(data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [state.instruments])

  return { result, loading, error, run, clear: () => setResult(null) }
}
