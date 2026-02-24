import { useEffect } from 'react'
import { Database, Loader, ChevronDown, ChevronUp } from 'lucide-react'
import { useAppState } from '../store'
import { usePipeline } from '../hooks/usePipeline'
import { useState } from 'react'

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
      {/* Group selector toggle */}
      <button
        onClick={() => setShowGroups(!showGroups)}
        className="flex items-center justify-between w-full text-xs text-muted hover:text-gray-300 py-1 font-mono"
      >
        <span>
          {state.xetraReady ? (
            <>
              <span className="text-green-500 mr-1">●</span>
              {enabledETFCount.toLocaleString()} ETFs · {enabledStockCount.toLocaleString()} stocks selected
            </>
          ) : state.xetraLoading ? (
            <><span className="text-amber-400 mr-1">◌</span> Loading universe...</>
          ) : (
            <><span className="text-muted mr-1">○</span> Xetra universe</>
          )}
        </span>
        {showGroups ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      {/* Groups */}
      {showGroups && state.xetraReady && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 pb-2 border-b border-border">
          <div>
            <div className="text-[10px] text-muted uppercase tracking-wider mb-1 font-mono">ETF Groups</div>
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
            <div className="text-[10px] text-muted uppercase tracking-wider mb-1 font-mono">Stock Groups</div>
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

      {/* Load button */}
      <button
        onClick={activateXetra}
        disabled={!state.xetraReady || isLoading}
        className="flex items-center justify-center gap-2 px-3 py-2 bg-surface2 border border-border text-gray-300 text-xs font-mono font-semibold rounded hover:border-accent/50 hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {isLoading ? (
          <><Loader size={12} className="animate-spin" /> Processing...</>
        ) : (
          <><Database size={12} /> Load Xetra Universe</>
        )}
      </button>

      {/* Clear button */}
      {state.xetraActive && !isLoading && (
        <button
          onClick={() => dispatch({ type: 'CLEAR_XETRA' })}
          className="text-xs text-muted hover:text-red-400 font-mono text-center"
        >
          Clear Xetra data
        </button>
      )}
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
        className="w-3 h-3 accent-blue-500"
      />
      <span className={`text-[11px] font-mono ${enabled ? 'text-gray-300' : 'text-muted'}`}>
        {label}
      </span>
      {count > 0 && (
        <span className="text-[10px] text-muted ml-auto">{count.toLocaleString()}</span>
      )}
    </label>
  )
}
