import { useEffect, useState } from 'react'
import { useRegime } from '../hooks/useRegime'
import { useAppState } from '../store'
import type { MarketRegime } from '../types'

const CONFIG: Record<MarketRegime, { label: string; icon: string; color: string }> = {
  RISK_ON:    { label: 'Risk On',    icon: '📈', color: 'text-green-400 border-green-400/30 bg-green-400/5'  },
  RISK_OFF:   { label: 'Risk Off',   icon: '📉', color: 'text-red-400 border-red-400/30 bg-red-400/5'        },
  SIDEWAYS:   { label: 'Sideways',   icon: '➡️',  color: 'text-gray-400 border-gray-400/30 bg-gray-400/5'    },
  TRANSITION: { label: 'Transition', icon: '🔄', color: 'text-amber-400 border-amber-400/30 bg-amber-400/5'  },
}

export function RegimeBanner() {
  const { state } = useAppState()
  const { regime, compute } = useRegime()
  const [dismissed, setDismissed] = useState(false)
  const [loading, setLoading] = useState(false)
  const REGIME_DELAY_MS = 1500

  useEffect(() => {
    if (state.fetchStatus.phase !== 'done') return
    let cancelled = false
    setLoading(true)
    const t = setTimeout(() => {
      compute().finally(() => {
        if (!cancelled) setLoading(false)
      })
    }, REGIME_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [state.fetchStatus.phase, state.instruments.length, state.referenceR3m, compute])

  if (dismissed) return null

  if (!regime && !loading) return null

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border/50 text-ui-sm font-mono text-muted">
        <span className="w-1.5 h-1.5 rounded-full bg-muted animate-pulse" />
        Market regime is being analyzed...
      </div>
    )
  }

  if (!regime) return null

  const cfg = CONFIG[regime.regime]

  return (
    <div className={`flex items-start justify-between gap-4 px-4 py-2 border-b text-ui-sm font-mono ${cfg.color}`}>
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <span className="shrink-0">{cfg.icon}</span>
        <div>
            <span className="font-semibold">{cfg.label}</span>
            <span className="text-muted mx-1.5">·</span>
            <span>{regime.confidence}% confidence</span>
            <span className="text-muted mx-1.5">—</span>
            <span>{regime.summary}</span>
            <div className="mt-0.5 text-muted">→ {regime.suggestion}</div>
          </div>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="focus-ring text-muted hover:text-gray-300 shrink-0 mt-0.5"
        aria-label="Dismiss market regime banner"
      >
        ×
      </button>
    </div>
  )
}
