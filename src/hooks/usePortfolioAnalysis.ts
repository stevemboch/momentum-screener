import { useState, useCallback } from 'react'
import { useAppState } from '../store'
import { apiFetchJson } from '../api/client'

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
  evidence: {
    sourceName: string | null
    sourceType: 'primary' | 'regulatory' | 'major_media' | 'secondary'
    url: string | null
    publishedAt: string | null
    confidence: 'high' | 'medium' | 'low'
    confidenceReason: string | null
  }[]
  insufficientEvidenceReason: string | null
}

export interface BriefingResult {
  findings: BriefingFinding[]
  macroContext: string
  macroContextEvidence: {
    sourceName: string | null
    sourceType: 'primary' | 'regulatory' | 'major_media' | 'secondary'
    url: string | null
    publishedAt: string | null
    confidence: 'high' | 'medium' | 'low'
    confidenceReason: string | null
  }[]
  macroContextInsufficientEvidenceReason: string | null
  asOf: string
  searchWindow: { from: string; to: string }
  dataQuality: 'high' | 'medium' | 'low'
  generatedAt: string
  fetchedAt: number
  diagnostics?: {
    modelId?: string
    searchMode?: string
    parseRetry?: boolean
    evidenceCount?: number
    jsonResponseMode?: boolean
  }
}

type LoadingState = 'idle' | 'loading' | 'done' | 'error'

function asString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const cleaned = v.trim()
  return cleaned.length > 0 ? cleaned : null
}

function asPriority(v: unknown): 'high' | 'medium' | 'low' {
  if (v === 'high' || v === 'medium' || v === 'low') return v
  return 'low'
}

function asSentiment(v: unknown): 'positive' | 'negative' | 'neutral' {
  if (v === 'positive' || v === 'negative' || v === 'neutral') return v
  return 'neutral'
}

function asSourceType(v: unknown): 'primary' | 'regulatory' | 'major_media' | 'secondary' {
  if (v === 'primary' || v === 'regulatory' || v === 'major_media' || v === 'secondary') return v
  return 'secondary'
}

function asConfidence(v: unknown): 'high' | 'medium' | 'low' {
  if (v === 'high' || v === 'medium' || v === 'low') return v
  return 'low'
}

function asDataQuality(v: unknown): 'high' | 'medium' | 'low' {
  if (v === 'high' || v === 'medium' || v === 'low') return v
  return 'low'
}

function normalizeEvidenceList(v: unknown, max = 3): BriefingFinding['evidence'] {
  if (!Array.isArray(v)) return []
  return v
    .map((item: unknown) => {
      if (!item || typeof item !== 'object') return null
      const src = item as any
      return {
        sourceName: asString(src.sourceName),
        sourceType: asSourceType(src.sourceType),
        url: asString(src.url),
        publishedAt: asString(src.publishedAt),
        confidence: asConfidence(src.confidence),
        confidenceReason: asString(src.confidenceReason),
      }
    })
    .filter(Boolean)
    .slice(0, max) as BriefingFinding['evidence']
}

function normalizeBriefing(raw: any, fetchedAtFallback: number): BriefingResult {
  const src = (raw && typeof raw === 'object') ? raw : {}
  const findings = Array.isArray(src.findings)
    ? src.findings
        .map((f: any) => {
          const headline = asString(f?.headline)
          const detail = asString(f?.detail)
          if (!headline || !detail) return null
          return {
            priority: asPriority(f.priority),
            instruments: Array.isArray(f.instruments)
              ? f.instruments.map((i: unknown) => asString(i)).filter(Boolean).slice(0, 6) as string[]
              : [],
            headline,
            detail,
            sentiment: asSentiment(f.sentiment),
            evidence: normalizeEvidenceList(f.evidence, 3),
            insufficientEvidenceReason: asString(f.insufficientEvidenceReason),
          }
        })
        .filter(Boolean) as BriefingFinding[]
    : []

  return {
    findings,
    macroContext: asString(src.macroContext) ?? '',
    macroContextEvidence: normalizeEvidenceList(src.macroContextEvidence, 3),
    macroContextInsufficientEvidenceReason: asString(src.macroContextInsufficientEvidenceReason),
    asOf: asString(src.asOf) ?? new Date().toISOString(),
    searchWindow: {
      from: asString(src.searchWindow?.from) ?? '',
      to: asString(src.searchWindow?.to) ?? '',
    },
    dataQuality: asDataQuality(src.dataQuality),
    generatedAt: asString(src.generatedAt) ?? new Date().toISOString(),
    fetchedAt: (typeof src.fetchedAt === 'number' && Number.isFinite(src.fetchedAt))
      ? src.fetchedAt
      : fetchedAtFallback,
    diagnostics: (src.diagnostics && typeof src.diagnostics === 'object')
      ? {
          modelId: asString(src.diagnostics.modelId) ?? undefined,
          searchMode: asString(src.diagnostics.searchMode) ?? undefined,
          parseRetry: typeof src.diagnostics.parseRetry === 'boolean' ? src.diagnostics.parseRetry : undefined,
          evidenceCount: typeof src.diagnostics.evidenceCount === 'number' ? src.diagnostics.evidenceCount : undefined,
          jsonResponseMode: typeof src.diagnostics.jsonResponseMode === 'boolean' ? src.diagnostics.jsonResponseMode : undefined,
        }
      : undefined,
  }
}

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
      if (Date.now() - parsed.fetchedAt >= BRIEFING_TTL) return null
      return normalizeBriefing(parsed, parsed.fetchedAt)
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
      const data = await apiFetchJson<any>('/api/claude-portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruments: payload }),
      })
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
      const data = await apiFetchJson<any>('/api/portfolio-briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruments: payload }),
      })
      if (data.error) throw new Error(data.error)
      const withTs = normalizeBriefing(data, Date.now())
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
