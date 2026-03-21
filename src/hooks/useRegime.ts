import { useCallback } from 'react'
import { useAppState } from '../store'
import { computeRegimeInputs } from '../utils/regimeInputs'
import type { Instrument } from '../types'
import { apiFetchJson } from '../api/client'

const REGIME_TTL = 60 * 60 * 1000  // 60 Minuten

export function useRegime() {
  const { state, dispatch } = useAppState()

  const compute = useCallback(async (overrides?: { instruments?: Instrument[]; referenceR3m?: number | null }) => {
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

    try {
      const data = await apiFetchJson<any>('/api/claude-regime', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inputs),
      })
      if (data.error) return
      dispatch({
        type: 'SET_MARKET_REGIME',
        regime: { ...data, computedAt: Date.now() }
      })
    } catch {
      // Regime ist optional — Fehler still ignorieren
    }
  }, [state.instruments, state.referenceR3m, state.marketRegime, dispatch])

  return { regime: state.marketRegime, compute }
}
