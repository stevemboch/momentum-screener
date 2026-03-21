import { useEffect } from 'react'
import { Database, Loader, ChevronDown, ChevronUp } from 'lucide-react'
import { useAppState } from '../store'
import { usePipeline } from '../hooks/usePipeline'
import { useState } from 'react'
import { StatusBadge } from './ui/StatusBadge'

export function XetraPanel() {
  const { state, dispatch } = useAppState()
  const { loadXetraBackground, activateXetra } = usePipeline()
  const [showGroups, setShowGroups] = useState(false)

  const isLoading = ['openfigi', 'prices', 'justetf', 'dedup', 'parsing'].includes(state.fetchStatus.phase)

  // Load Xetra CSV in background on mount
  useEffect(() => {
    if (!state.xetraReady && !state.xetraLoading) {
      loadXetraBackground()
    }
  }, [])

  const enabledETFCount = state.etfGroups
    .filter((g) => g.enabled)
    .reduce((s, g) => s + g.count, 0)

  const enabledStockCount = state.stockGroups
    .filter((g) => g.enabled)
    .reduce((s, g) => s + g.count, 0)

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setShowGroups(!showGroups)}
        className="focus-ring flex w-full items-center justify-between py-1 font-mono text-ui-sm text-muted hover:text-gray-300"
        aria-expanded={showGroups}
        aria-label={showGroups ? 'Hide group filters' : 'Show group filters'}
      >
        <span>
          {state.xetraReady ? (
            <>
              <span className="text-green-500 mr-1" aria-hidden>●</span>
              {enabledETFCount.toLocaleString()} ETFs · {enabledStockCount.toLocaleString()} stocks selected
            </>
          ) : state.xetraLoading ? (
            <><span className="text-amber-400 mr-1" aria-hidden>◌</span> Loading universe...</>
          ) : (
            <><span className="text-muted mr-1" aria-hidden>○</span> Xetra universe</>
          )}
        </span>
        {showGroups ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      {showGroups && state.xetraReady && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 pb-2 border-b border-border">
          <div>
            <div className="mb-1 text-ui-xs font-mono uppercase tracking-wider text-muted">ETF groups</div>
            {state.etfGroups.map((g) => (
              <GroupCheckbox
                key={g.groupKey}
                label={g.label}
                count={g.count}
                enabled={g.enabled}
                onChange={(v) => dispatch({ type: 'SET_ETF_GROUP', groupKey: g.groupKey, enabled: v })}
              />
            ))}
          </div>
          <div>
            <div className="mb-1 text-ui-xs font-mono uppercase tracking-wider text-muted">Stock groups</div>
            {state.stockGroups.map((g) => (
              <GroupCheckbox
                key={g.groupKey}
                label={g.label}
                count={g.count}
                enabled={g.enabled}
                onChange={(v) => dispatch({ type: 'SET_STOCK_GROUP', groupKey: g.groupKey, enabled: v })}
              />
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={activateXetra}
        disabled={!state.xetraReady || isLoading}
        className="btn btn-md btn-secondary focus-ring w-full font-semibold"
      >
        {isLoading ? (
          <><Loader size={12} className="animate-spin" /> Processing...</>
        ) : (
          <><Database size={12} /> Load Xetra Universe</>
        )}
      </button>

      {state.xetraActive && !isLoading && (
        <button
          type="button"
          onClick={() => dispatch({ type: 'CLEAR_XETRA' })}
          className="btn btn-sm btn-ghost focus-ring"
        >
          Clear loaded Xetra data
        </button>
      )}

      {state.xetraLoading && <StatusBadge tone="info">Universe parsing in background</StatusBadge>}
    </div>
  )
}

function GroupCheckbox({
  label, count, enabled, onChange
}: {
  label: string; count: number; enabled: boolean; onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center gap-1.5 py-0.5 cursor-pointer group">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => onChange(e.target.checked)}
        className="w-3 h-3 accent-blue-500 focus-ring"
      />
      <span className={`text-ui-xs font-mono ${enabled ? 'text-gray-300' : 'text-muted'}`}>
        {label}
      </span>
      {count > 0 && (
        <span className="text-ui-xs text-muted ml-auto">{count.toLocaleString()}</span>
      )}
    </label>
  )
}
