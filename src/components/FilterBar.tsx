import { useEffect, useRef, useState } from 'react'
import { useAppState, useDisplayedInstruments } from '../store'
import type { ColumnGroup, TypeFilter } from '../types'
import { isAiFilterPlan } from '../utils/aiFilter'
import { apiFetchJson } from '../api/client'

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
  const {
    typeFilter,
    hiddenColumnGroups,
    tfaMode,
    pullbackMode,
    aiFilterQuery,
    aiFilterActive,
  } = state.tableState
  const { fetchStatus } = state
  const [colMenuOpen, setColMenuOpen] = useState(false)
  const colMenuRef = useRef<HTMLDivElement | null>(null)
  const [aiInput, setAiInput] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const monitoring = displayed.filter((i) => i.tfaPhase === 'monitoring').length
  const aboveAllMAs = displayed.filter(i => i.tfaPhase === 'above_all_mas').length
  const watch = displayed.filter((i) => i.tfaPhase === 'watch').length
  const fetching = displayed.filter((i) => i.tfaPhase === 'fetching').length
  const qualified = displayed.filter((i) => i.tfaPhase === 'qualified').length
  const pullbackCount = displayed.filter(
    (i) => i.type === 'Stock'
      && i.aboveMa200 === true
      && (i.r3m ?? -1) > 0
      && i.pullbackScore !== null
      && i.pullbackScore !== undefined
  ).length

  type PrimaryFilter = TypeFilter | 'tfa' | 'pullback'
  const primaryFilter: PrimaryFilter = tfaMode ? 'tfa' : pullbackMode ? 'pullback' : typeFilter

  const setPrimaryFilter = (f: PrimaryFilter) => {
    if (f === 'tfa') {
      dispatch({
        type: 'SET_TABLE_STATE',
        updates: {
          tfaMode: true,
          pullbackMode: false,
          typeFilter: 'stock',
          sortColumn: 'tfaScore',
          sortDirection: 'desc',
        },
      })
      return
    }

    if (f === 'pullback') {
      dispatch({
        type: 'SET_TABLE_STATE',
        updates: {
          pullbackMode: true,
          tfaMode: false,
          typeFilter: 'stock',
          sortColumn: 'pullbackScore',
          sortDirection: 'desc',
        },
      })
      return
    }

    dispatch({
      type: 'SET_TABLE_STATE',
      updates: {
        typeFilter: f,
        tfaMode: false,
        pullbackMode: false,
        ...(tfaMode || pullbackMode ? { sortColumn: 'combinedScore', sortDirection: 'desc' } : {}),
      },
    })
  }

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

  const handleAiFilter = async () => {
    const q = aiInput.trim()
    if (!q || aiLoading) return
    setAiLoading(true)
    setAiError(null)
    try {
      const data = await apiFetchJson<any>('/api/ai-filter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      })
      if (data.error) {
        setAiError(data.error ?? 'Fehler')
        return
      }
      if (!isAiFilterPlan(data.plan)) {
        setAiError('Ungültiger KI-Filter')
        return
      }
      dispatch({
        type: 'SET_TABLE_STATE',
        updates: { aiFilterPlan: data.plan, aiFilterQuery: data.query, aiFilterActive: true },
      })
      setAiInput('')
    } catch (err: any) {
      setAiError(err?.message ?? 'Netzwerkfehler')
    } finally {
      setAiLoading(false)
    }
  }

  const clearAiFilter = () => {
    dispatch({ type: 'SET_TABLE_STATE', updates: { aiFilterPlan: null, aiFilterQuery: null, aiFilterActive: false } })
    setAiError(null)
  }

  const editAiFilter = () => {
    if (!aiFilterQuery) return
    setAiInput(aiFilterQuery)
    dispatch({ type: 'SET_TABLE_STATE', updates: { aiFilterPlan: null, aiFilterQuery: null, aiFilterActive: false } })
    setAiError(null)
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Type filter */}
      <div className="flex items-center gap-0.5 bg-surface2 rounded p-0.5 border border-border">
        {(['all', 'etf', 'stock', 'tfa', 'pullback'] as PrimaryFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setPrimaryFilter(f)}
            title={
              f === 'tfa'
                ? 'Zeigt nur Turnaround-Kandidaten: −40% bis −90% unter 52W-Hoch'
                : f === 'pullback'
                  ? 'Zeigt Top-Momentum-Stocks mit RSI-Rücksetzer — potenzielle Swing-Einstiege'
                  : undefined
            }
            className={`px-2.5 py-1 text-xs font-mono rounded transition-colors ${
              primaryFilter === f
                ? 'bg-accent/20 text-accent border border-accent/30'
                : 'text-muted hover:text-gray-300'
            }`}
          >
            {f === 'all' && 'All'}
            {f === 'etf' && 'ETFs & ETCs'}
            {f === 'stock' && 'Stocks'}
            {f === 'tfa' && `TFA ${tfaMode ? `(${monitoring} / ${aboveAllMAs} / ${watch}${fetching > 0 ? ` / ${fetching}` : ''} / ${qualified})` : ''}`}
            {f === 'pullback' && `Pullback ${pullbackMode ? `(${pullbackCount})` : ''}`}
          </button>
        ))}
      </div>

      {/* KI-Freitext-Filter */}
      <div className="flex items-center gap-1.5 flex-1 min-w-[200px] max-w-[400px]">
        {aiFilterActive && aiFilterQuery ? (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-purple-400/10 border border-purple-400/30 rounded text-[11px] font-mono text-purple-300 flex-1 min-w-0">
            <span className="shrink-0">✦</span>
            <span className="truncate flex-1" title={aiFilterQuery}>{aiFilterQuery}</span>
            <button
              onClick={editAiFilter}
              className="shrink-0 text-purple-400/70 hover:text-purple-200 transition-colors"
              title="Filtertext übernehmen und bearbeiten"
            >
              Edit
            </button>
            <button
              onClick={clearAiFilter}
              className="shrink-0 text-purple-400/60 hover:text-purple-300 transition-colors ml-1"
              title="Filter entfernen"
            >
              ×
            </button>
          </div>
        ) : (
          <>
            <input
              type="text"
              value={aiInput}
              onChange={(e) => { setAiInput(e.target.value); setAiError(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAiFilter() }}
              placeholder="KI-Filter: z.B. profitable Stocks unter MA50…"
              className={`flex-1 bg-bg border rounded px-2.5 py-1 text-[11px] font-mono text-gray-300
                placeholder:text-muted outline-none transition-colors
                ${aiError ? 'border-red-400/50' : 'border-border focus:border-purple-400/50'}`}
            />
            <button
              onClick={handleAiFilter}
              disabled={!aiInput.trim() || aiLoading}
              className="shrink-0 px-2 py-1 text-[11px] font-mono rounded border
                border-purple-400/30 text-purple-400 hover:bg-purple-400/10
                disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="KI-Filter anwenden (Enter)"
            >
              {aiLoading ? '…' : '✦'}
            </button>
          </>
        )}
        {aiError && (
          <span className="text-[10px] text-red-400 font-mono shrink-0 max-w-[140px] truncate" title={aiError}>
            ✗ {aiError}
          </span>
        )}
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
