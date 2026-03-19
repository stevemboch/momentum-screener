import { useEffect, useRef, useState } from 'react'
import { useAppState, useDisplayedInstruments } from '../store'
import type { ColumnGroup, TypeFilter } from '../types'

const COL_GROUP_LABELS: Record<ColumnGroup, string> = {
  scores: 'Scores',
  returns: 'Returns',
  technical: 'Technical',
  fundamentals: 'Fundamentals',
  breakout: 'Breakout',
  tfa: 'TFA',
  pullback: 'Pullback',
}

export function FilterBar() {
  const { state, dispatch } = useAppState()
  const displayed = useDisplayedInstruments()
  const { typeFilter, filterBelowAllMAs, hiddenColumnGroups, tfaMode, pullbackMode } = state.tableState
  const { fetchStatus } = state
  const [colMenuOpen, setColMenuOpen] = useState(false)
  const colMenuRef = useRef<HTMLDivElement | null>(null)
  const monitoring = displayed.filter((i) => i.tfaPhase === 'monitoring').length
  const aboveAllMAs = displayed.filter(i => i.tfaPhase === 'above_all_mas').length
  const watch = displayed.filter((i) => i.tfaPhase === 'watch').length
  const qualified = displayed.filter((i) => i.tfaPhase === 'qualified').length
  const pullbackCount = displayed.filter(
    (i) => i.pullbackScore !== null && i.pullbackScore !== undefined
  ).length

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

      {/* MA filter toggle */}
      {toggleSwitch(
        filterBelowAllMAs,
        () => dispatch({ type: 'SET_TABLE_STATE', updates: { filterBelowAllMAs: !filterBelowAllMAs } }),
        'Above All MAs',
        'Hide instruments whose last price is not above all computed MAs (10/50/100/200)'
      )}

      {/* TFA mode toggle */}
      {toggleSwitch(
        tfaMode,
        () => dispatch({ type: 'SET_TABLE_STATE', updates: {
          tfaMode: !tfaMode,
          typeFilter: !tfaMode ? 'stock' : typeFilter,
          sortColumn: !tfaMode ? 'tfaScore' : 'combinedScore',
          sortDirection: 'desc',
        } }),
        `TFA Mode ${tfaMode ? `(${monitoring} 👁 / ${aboveAllMAs} 🚀 / ${watch} ⚡ / ${qualified} ✓)` : ''}`,
        'Zeigt nur Turnaround-Kandidaten: −40% bis −90% unter 52W-Hoch'
      )}

      {/* Pullback mode toggle */}
      {toggleSwitch(
        pullbackMode,
        () => dispatch({
          type: 'SET_TABLE_STATE',
          updates: {
            pullbackMode: !pullbackMode,
            tfaMode: false,
            typeFilter: !pullbackMode ? 'stock' : typeFilter,
            sortColumn: !pullbackMode ? 'pullbackScore' : 'combinedScore',
            sortDirection: 'desc',
          },
        }),
        `Pullback ${pullbackMode ? `(${pullbackCount} ↩)` : ''}`,
        'Zeigt Top-Momentum-Stocks mit RSI-Rücksetzer — potenzielle Swing-Einstiege',
      )}

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
