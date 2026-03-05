import { useCallback } from 'react'
import { useAppState } from '../store'
import { computeRegimeInputs } from '../utils/regimeInputs'

const REGIME_TTL = 60 * 60 * 1000  // 60 Minuten

export function useRegime() {
  const { state, dispatch } = useAppState()

  const compute = useCallback(async () => {
    if (state.marketRegime) {
      const age = Date.now() - state.marketRegime.computedAt
      if (age < REGIME_TTL) return
    }

    const inputs = computeRegimeInputs(state.instruments, state.referenceR3m)
    if (inputs.instrumentCount < 10) return

    try {
      const res = await fetch('/api/claude-regime', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inputs),
      })
      const data = await res.json()
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
