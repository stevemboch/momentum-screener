import { useCallback, useRef } from 'react'
import { useAppState } from '../store'
import { computeRegimeInputs } from '../utils/regimeInputs'
import { calculateMAs } from '../utils/calculations'
import type { Instrument, RegimeBenchmark } from '../types'
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

export function useRegime() {
  const { state, dispatch } = useAppState()
  const inFlightRef = useRef(false)

  const compute = useCallback(async (overrides?: { instruments?: Instrument[]; referenceR3m?: number | null }) => {
    if (inFlightRef.current) return
    if (state.marketRegime) {
      const age = Date.now() - state.marketRegime.computedAt
      if (age < REGIME_TTL) return
    }

    const instruments = overrides?.instruments ?? state.instruments
    const referenceR3m = overrides?.referenceR3m ?? state.referenceR3m
    const withPrices = instruments.filter(i => i.closes && i.closes.length > 0)
    const withSignals = withPrices.filter(i => i.r3m != null && i.aboveMa200 != null)
    if (withSignals.length < 10) return
    const coverage = withSignals.length / (withPrices.length || 1)
    if (coverage < 0.6) return

    const inputs = computeRegimeInputs(withSignals, referenceR3m)
    if (inputs.instrumentCount < 10) return

    inFlightRef.current = true
    try {
      const [regimeRes, benchmarksRes] = await Promise.allSettled([
        apiFetchJson<any>('/api/claude-regime', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(inputs),
        }),
        fetchBenchmarks(),
      ])
      if (regimeRes.status !== 'fulfilled') return
      const data = regimeRes.value
      if (data.error) return
      const benchmarks = benchmarksRes.status === 'fulfilled' ? benchmarksRes.value : undefined
      dispatch({
        type: 'SET_MARKET_REGIME',
        regime: { ...data, benchmarks, computedAt: Date.now() }
        })
    } catch {
      // Regime ist optional — Fehler still ignorieren
    } finally {
      inFlightRef.current = false
    }
  }, [state.instruments, state.referenceR3m, state.marketRegime, dispatch])

  return { regime: state.marketRegime, compute }
}
