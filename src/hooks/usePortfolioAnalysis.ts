import { useState, useCallback } from 'react'
import { useAppState } from '../store'

const BRIEFING_TTL = 2 * 60 * 60 * 1000  // 2h Cache

// ── Typen ────────────────────────────────────────────────────

export interface StructureResult {
  severity: 'ok' | 'warning' | 'critical'
  findings: string[]
}

export interface BriefingFinding {
  priority: 'high' | 'medium' | 'low'
  instruments: string[]
  headline: string
  detail: string
  sentiment: 'positive' | 'negative' | 'neutral'
}

export interface BriefingResult {
  findings: BriefingFinding[]
  macroContext: string
  generatedAt: string
  fetchedAt: number
}

type LoadingState = 'idle' | 'loading' | 'done' | 'error'

// ── Hook ─────────────────────────────────────────────────────

export function usePortfolioAnalysis() {
  const { state } = useAppState()

  const [structureStatus, setStructureStatus] = useState<LoadingState>('idle')
  const [structureResult, setStructureResult] = useState<StructureResult | null>(null)
  const [structureError,  setStructureError]  = useState<string | null>(null)

  const [briefingStatus, setBriefingStatus] = useState<LoadingState>(() => {
    try {
      const raw = localStorage.getItem('cache:portfolio-briefing')
      if (!raw) return 'idle'
      const parsed = JSON.parse(raw)
      return Date.now() - parsed.fetchedAt < BRIEFING_TTL ? 'done' : 'idle'
    } catch { return 'idle' }
  })
  const [briefingResult, setBriefingResult] = useState<BriefingResult | null>(() => {
    try {
      const raw = localStorage.getItem('cache:portfolio-briefing')
      if (!raw) return null
      const parsed = JSON.parse(raw)
      return Date.now() - parsed.fetchedAt < BRIEFING_TTL ? parsed : null
    } catch { return null }
  })
  const [briefingError, setBriefingError] = useState<string | null>(null)

  const briefingIsStale = briefingResult
    ? Date.now() - briefingResult.fetchedAt > BRIEFING_TTL
    : false

  const isRunning =
    structureStatus === 'loading' || briefingStatus === 'loading'

  // ── Payload ──────────────────────────────────────────────

  const buildPayload = useCallback(() => {
    return state.instruments
      .filter(i => i.inPortfolio)
      .map(i => ({
        name:             i.displayName,
        type:             i.type,
        dedupKey:         i.dedupGroup   ?? null,
        xetraGroup:       i.xetraGroup   ?? null,
        longName:         i.longName     ?? null,
        currency:         i.currency     ?? null,
        r1m:              i.r1m          ?? null,
        r3m:              i.r3m          ?? null,
        r6m:              i.r6m          ?? null,
        vola:             i.vola         ?? null,
        momentumRank:     i.momentumRank     ?? null,
        riskAdjustedRank: i.riskAdjustedRank ?? null,
      }))
  }, [state.instruments])

  // ── Fetches ──────────────────────────────────────────────

  const fetchStructure = useCallback(async (payload: object[]) => {
    setStructureStatus('loading')
    setStructureError(null)
    try {
      const res = await fetch('/api/claude-portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruments: payload }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setStructureResult(data)
      setStructureStatus('done')
    } catch (e: any) {
      setStructureError(e.message)
      setStructureStatus('error')
    }
  }, [])

  const fetchBriefing = useCallback(async (payload: object[]) => {
    setBriefingStatus('loading')
    setBriefingError(null)
    try {
      const res = await fetch('/api/portfolio-briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruments: payload }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      const withTs = { ...data, fetchedAt: Date.now() }
      setBriefingResult(withTs)
      setBriefingStatus('done')
      try {
        localStorage.setItem('cache:portfolio-briefing', JSON.stringify(withTs))
      } catch { /* quota */ }
    } catch (e: any) {
      setBriefingError(e.message)
      setBriefingStatus('error')
    }
  }, [])

  // ── Haupt-Trigger: beide parallel ────────────────────────

  const run = useCallback(async () => {
    const payload = buildPayload()
    if (payload.length === 0) return
    // Beide gleichzeitig starten — kein sequenzielles await
    fetchStructure(payload)
    fetchBriefing(payload)
  }, [buildPayload, fetchStructure, fetchBriefing])

  // ── Clear ────────────────────────────────────────────────

  const clear = useCallback(() => {
    setStructureStatus('idle')
    setStructureResult(null)
    setStructureError(null)
    setBriefingStatus('idle')
    setBriefingResult(null)
    setBriefingError(null)
    localStorage.removeItem('cache:portfolio-briefing')
  }, [])

  return {
    structureStatus, structureResult, structureError,
    briefingStatus,  briefingResult,  briefingError, briefingIsStale,
    isRunning,
    run,
    clear,
  }
}
