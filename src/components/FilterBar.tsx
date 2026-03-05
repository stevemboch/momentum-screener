import { useEffect, useRef, useState } from 'react'
import { useAppState, useDisplayedInstruments } from '../store'
import type { ColumnGroup, TypeFilter } from '../types'

const COL_GROUP_LABELS: Record<ColumnGroup, string> = {
  scores: 'Scores',
  returns: 'Returns',
  technical: 'Technical',
  fundamentals: 'Fundamentals',
  breakout: 'Breakout',
}

export function FilterBar() {
  const { state, dispatch } = useAppState()
  const displayed = useDisplayedInstruments()
  const { typeFilter, showDeduped, filterBelowRiskFree, hiddenColumnGroups } = state.tableState
  const { fetchStatus, settings } = state
  const [colMenuOpen, setColMenuOpen] = useState(false)
  const colMenuRef = useRef<HTMLDivElement | null>(null)

  const setTypeFilter = (f: TypeFilter) =>
    dispatch({ type: 'SET_TABLE_STATE', updates: { typeFilter: f } })

  const isActive = ['openfigi', 'prices', 'justetf', 'dedup', 'parsing'].includes(fetchStatus.phase)

  useEffect(() => {
    if (!colMenuOpen) return
    const handleClick = (e: MouseEvent) => {
      if (!colMenuRef.current) return
      if (colMenuRef.current.contains(e.target as Node)) return
      setColMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [colMenuOpen])

  const toggleSwitch = (active: boolean, onClick: () => void, label: string, title?: string) => (
    <button
      onClick={onClick}
      title={title}
      className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono rounded border transition-colors ${
        active
          ? 'bg-green-400/10 text-green-400 border-green-400/30'
          : 'text-muted border-border hover:text-gray-300'
      }`}
    >
      {/* Toggle pill */}
      <span className={`relative inline-flex w-7 h-3.5 rounded-full transition-colors ${active ? 'bg-green-400' : 'bg-surface2 border border-border'}`}>
        <span className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow transition-transform ${active ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
      </span>
      {label}
    </button>
  )

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Type filter */}
      <div className="flex items-center gap-0.5 bg-surface2 rounded p-0.5 border border-border">
        {(['all', 'etf', 'stock'] as TypeFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setTypeFilter(f)}
            className={`px-2.5 py-1 text-xs font-mono rounded transition-colors ${
              typeFilter === f
                ? 'bg-accent/20 text-accent border border-accent/30'
                : 'text-muted hover:text-gray-300'
            }`}
          >
            {f === 'all' ? 'All' : f === 'etf' ? 'ETFs & ETCs' : 'Stocks'}
          </button>
        ))}
      </div>

      {/* Dedup toggle */}
      {toggleSwitch(
        showDeduped,
        () => dispatch({ type: 'SET_TABLE_STATE', updates: { showDeduped: !showDeduped } }),
        'Deduplicated'
      )}

      {/* Risk-free filter toggle */}
      {toggleSwitch(
        filterBelowRiskFree,
        () => dispatch({ type: 'SET_TABLE_STATE', updates: { filterBelowRiskFree: !filterBelowRiskFree } }),
        `> Risk-Free (${(settings.riskFreeRate * 100).toFixed(1)}%)`,
        `Hide instruments whose annualised return is below the risk-free rate (${(settings.riskFreeRate * 100).toFixed(1)}% p.a.)`
      )}

      <div className="flex items-center gap-1.5 text-xs font-mono text-muted">
        <span>Stop</span>
        <input
          type="range"
          min={3} max={5} step={0.25}
          value={settings.atrMultiplier}
          onChange={(e) => dispatch({
            type: 'SET_ATR_MULTIPLIER',
            multiplier: Number(e.target.value),
          })}
          className="w-16 accent-blue-500 h-1"
          title={`ATR Multiplier: ${settings.atrMultiplier}× — Selling threshold = Last Price − ${settings.atrMultiplier}× ATR(20)`}
        />
        <span className="text-gray-300 w-6">{settings.atrMultiplier}×</span>
      </div>

      {/* Instrument count */}
      <span className="text-xs font-mono text-muted ml-1">
        {displayed.length.toLocaleString()}
        {displayed.length !== state.instruments.length && (
          <span className="text-muted"> / {state.instruments.length.toLocaleString()}</span>
        )}
        {' '}instruments
      </span>

      <div className="relative ml-auto" ref={colMenuRef}>
        <button
          onClick={() => setColMenuOpen(!colMenuOpen)}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono rounded border border-border text-muted hover:text-gray-300 transition-colors"
        >
          Columns {hiddenColumnGroups.length > 0 && (
            <span className="text-accent">({hiddenColumnGroups.length} hidden)</span>
          )}
        </button>
        {colMenuOpen && (
          <div className="absolute right-0 top-full mt-1 z-20 bg-surface border border-border rounded shadow-xl p-2 flex flex-col gap-1 min-w-[140px]">
            {(Object.keys(COL_GROUP_LABELS) as ColumnGroup[]).map(group => {
              const hidden = hiddenColumnGroups.includes(group)
              return (
                <button
                  key={group}
                  onClick={() => dispatch({ type: 'TOGGLE_COLUMN_GROUP', group })}
                  className={`flex items-center gap-2 px-2 py-1 text-xs font-mono rounded text-left transition-colors ${
                    hidden ? 'text-muted' : 'text-gray-300'
                  } hover:bg-surface2`}
                >
                  <span className={`w-2 h-2 rounded-full ${hidden ? 'bg-surface2 border border-border' : 'bg-accent'}`} />
                  {COL_GROUP_LABELS[group]}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Fetch progress */}
      {isActive && (
        <div className="flex items-center gap-2 ml-auto text-xs font-mono text-muted">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          {fetchStatus.message}
          {fetchStatus.total > 0 && (
            <>
              <div className="w-24 h-1 bg-surface2 rounded overflow-hidden border border-border">
                <div
                  className="h-full bg-accent transition-all duration-300"
                  style={{ width: `${Math.min(100, (fetchStatus.current / fetchStatus.total) * 100)}%` }}
                />
              </div>
            </>
          )}
        </div>
      )}

      {fetchStatus.phase === 'done' && (
        <span className="ml-auto text-xs font-mono text-green-400">✓ {fetchStatus.message}</span>
      )}
      {fetchStatus.phase === 'error' && (
        <span className="ml-auto text-xs font-mono text-red-400">✗ {fetchStatus.message}</span>
      )}
    </div>
  )
}
