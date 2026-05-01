import { useCallback, useEffect, useRef } from 'react'
import { useAppState } from '../store'
import { computeRegimeInputs, type RegimeInputs } from '../utils/regimeInputs'
import { calculateMAs } from '../utils/calculations'
import type { Instrument, RegimeBenchmark, RegimeResult } from '../types'
import { apiFetchJson } from '../api/client'

const REGIME_TTL = 60 * 60 * 1000  // 60 Minuten
const BENCHMARKS: Array<Pick<RegimeBenchmark, 'label' | 'ticker'>> = [
  { label: 'S&P 500', ticker: 'SPY' },
  { label: 'MSCI World', ticker: 'URTH' },
  { label: 'MSCI Europe', ticker: 'IEUR' },
  { label: 'MSCI EM', ticker: 'EEM' },
]

async function fetchBenchmarks(): Promise<RegimeBenchmark[]> {
  const tickers = BENCHMARKS.map((b) => b.ticker)
  const data = await apiFetchJson<any[]>('/api/yahoo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tickers }),
  })

  return BENCHMARKS.map((benchmark, idx) => {
    const result = Array.isArray(data) ? data[idx] : null
    if (!result || result.error || !Array.isArray(result.closes)) {
      return { ...benchmark, aboveMa200: null }
    }
    const { aboveMa200 } = calculateMAs(result.closes as number[])
    return { ...benchmark, aboveMa200: aboveMa200 ?? null }
  })
}

function classifyRegime(inputs: RegimeInputs): Omit<RegimeResult, 'benchmarks' | 'computedAt'> {
  const breadth = inputs.aboveMA200Pct
  const hitRate = inputs.positiveR3mPct
  const avgR3m = inputs.avgR3m ?? 0
  const worldR3m = inputs.urthR3m ?? 0
  const avgVola = inputs.avgVola ?? 0.18

  const trendScore =
    (breadth - 0.5) * 2.2 +
    (hitRate - 0.5) * 1.6 +
    avgR3m * 2.0 +
    worldR3m * 1.2

  const highRiskPenalty = Math.max(0, (avgVola - 0.24) * 3.0)
  const lowVolaBonus = Math.max(0, (0.16 - avgVola) * 1.5)
  const score = trendScore - highRiskPenalty + lowVolaBonus

  if (score >= 0.65 && breadth >= 0.58 && hitRate >= 0.55) {
    return {
      regime: 'RISK_ON',
      confidence: Math.min(94, Math.max(62, Math.round(58 + score * 22))),
      summary: 'Broad participation and positive medium-term momentum support a risk-on stance.',
      suggestion: 'Overweight trend-following equity positions and keep stop discipline intact.',
    }
  }

  if (score <= -0.65 && breadth <= 0.45 && hitRate <= 0.45) {
    return {
      regime: 'RISK_OFF',
      confidence: Math.min(95, Math.max(64, Math.round(58 + Math.abs(score) * 22))),
      summary: 'Weak breadth and negative momentum indicate a defensive market backdrop.',
      suggestion: 'Reduce cyclical exposure and favor cash, defensives, or lower-beta assets.',
    }
  }

  if (Math.abs(score) >= 0.35) {
    return {
      regime: 'TRANSITION',
      confidence: Math.min(86, Math.max(55, Math.round(52 + Math.abs(score) * 20))),
      summary: 'Signals are shifting but not yet confirmed by broad and stable participation.',
      suggestion: 'Keep position sizes moderate and wait for stronger breadth confirmation.',
    }
  }

  return {
    regime: 'SIDEWAYS',
    confidence: Math.min(80, Math.max(50, Math.round(55 - Math.abs(score) * 8))),
    summary: 'Mixed breadth and momentum suggest a range-bound, indecisive market.',
    suggestion: 'Prioritize selective setups and avoid aggressive directional concentration.',
  }
}

export function useRegime() {
  const { state, dispatch } = useAppState()
  const inFlightRef = useRef(false)
  const stateRef = useRef(state)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const compute = useCallback(async (overrides?: { instruments?: Instrument[]; referenceR3m?: number | null }) => {
    const currentState = stateRef.current
    if (inFlightRef.current) return
    if (currentState.marketRegime) {
      const age = Date.now() - currentState.marketRegime.computedAt
      if (age < REGIME_TTL) return
    }

    const instruments = overrides?.instruments ?? currentState.instruments
    const referenceR3m = overrides?.referenceR3m ?? currentState.referenceR3m
    const withPrices = instruments.filter(i => i.closes && i.closes.length > 0)
    const withSignals = withPrices.filter(i => i.r3m != null && i.aboveMa200 != null)
    if (withSignals.length < 10) return
    const coverage = withSignals.length / (withPrices.length || 1)
    if (coverage < 0.6) return

    const inputs = computeRegimeInputs(withSignals, referenceR3m)
    if (inputs.instrumentCount < 10) return

    inFlightRef.current = true
    try {
      const [benchmarksRes] = await Promise.allSettled([fetchBenchmarks()])
      const regime = classifyRegime(inputs)
      const benchmarks = benchmarksRes.status === 'fulfilled' ? benchmarksRes.value : undefined
      dispatch({
        type: 'SET_MARKET_REGIME',
        regime: { ...regime, benchmarks, computedAt: Date.now() }
      })
    } catch {
      // Regime ist optional — Fehler still ignorieren
    } finally {
      inFlightRef.current = false
    }
  }, [dispatch])

  return { regime: state.marketRegime, compute }
}
