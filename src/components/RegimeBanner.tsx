import { useState } from 'react'
import { useAppState } from '../store'
import type { MarketRegime } from '../types'

const CONFIG: Record<MarketRegime, { label: string; icon: string; color: string }> = {
  RISK_ON:    { label: 'Risk On',    icon: '📈', color: 'text-green-400 border-green-400/30 bg-green-400/5'  },
  RISK_OFF:   { label: 'Risk Off',   icon: '📉', color: 'text-red-400 border-red-400/30 bg-red-400/5'        },
  SIDEWAYS:   { label: 'Seitwärts',  icon: '➡️',  color: 'text-gray-400 border-gray-400/30 bg-gray-400/5'    },
  TRANSITION: { label: 'Transition', icon: '🔄', color: 'text-amber-400 border-amber-400/30 bg-amber-400/5'  },
}

export function RegimeBanner() {
  const { state } = useAppState()
  const [dismissed, setDismissed] = useState(false)
  const regime = state.marketRegime

  if (!regime || dismissed) return null

  const cfg = CONFIG[regime.regime]

  return (
    <div className={`flex items-start justify-between gap-4 px-4 py-2 
                     border-b text-[11px] font-mono ${cfg.color}`}>
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <span className="shrink-0">{cfg.icon}</span>
        <div>
          <span className="font-semibold">{cfg.label}</span>
          <span className="text-muted mx-1.5">·</span>
          <span>{regime.confidence}% Konfidenz</span>
          <span className="text-muted mx-1.5">—</span>
          <span>{regime.summary}</span>
          <div className="mt-0.5 text-muted">→ {regime.suggestion}</div>
        </div>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="text-muted hover:text-gray-300 shrink-0 mt-0.5"
      >
        ×
      </button>
    </div>
  )
}
