import { useEffect, useRef, useState } from 'react'
import { apiFetchJson } from '../api/client'
import { useAppState, useDisplayedInstruments } from '../store'
import type { ColumnGroup, TypeFilter } from '../types'
import { isAiFilterPlan } from '../utils/aiFilter'
import { StatusBadge } from './ui/StatusBadge'
import { ANALYST_AUTO_TOP_N } from '../constants/analyst'

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
  const aboveAllMAs = displayed.filter((i) => i.tfaPhase === 'above_all_mas').length
  const watch = displayed.filter((i) => i.tfaPhase === 'watch').length
  const fetching = displayed.filter((i) => i.tfaPhase === 'fetching').length
  const qualified = displayed.filter((i) => i.tfaPhase === 'qualified').length
  const pullbackCount = displayed.filter(
    (i) =>
      i.type === 'Stock' &&
      i.aboveMa200 === true &&
      (i.r3m ?? -1) > 0 &&
      i.pullbackScore !== null &&
      i.pullbackScore !== undefined
  ).length
  const topNAvailable = state.instruments.filter(
    (i) => i.type === 'Stock' && i.priceFetched && (i.riskAdjustedRank ?? 9999) <= ANALYST_AUTO_TOP_N
  ).length
  const topNLoaded = state.instruments.filter(
    (i) =>
      i.type === 'Stock' &&
      i.priceFetched &&
      (i.riskAdjustedRank ?? 9999) <= ANALYST_AUTO_TOP_N &&
      i.analystFetched
  ).length
  const topNProgressPct = topNAvailable > 0 ? Math.min(100, (topNLoaded / topNAvailable) * 100) : 0

  type PrimaryFilter = TypeFilter | 'tfa' | 'pullback'
  const primaryFilter: PrimaryFilter = tfaMode ? 'tfa' : pullbackMode ? 'pullback' : typeFilter
  const isActive = ['openfigi', 'prices', 'justetf', 'dedup', 'parsing'].includes(fetchStatus.phase)

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

  useEffect(() => {
    if (!colMenuOpen) return
    const handleClick = (e: MouseEvent) => {
      if (!colMenuRef.current) return
      if (colMenuRef.current.contains(e.target as Node)) return
      setColMenuOpen(false)
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setColMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEscape)
    }
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
        setAiError(data.error ?? 'Error')
        return
      }
      if (!isAiFilterPlan(data.plan)) {
        setAiError('Invalid AI filter response')
        return
      }
      dispatch({
        type: 'SET_TABLE_STATE',
        updates: { aiFilterPlan: data.plan, aiFilterQuery: data.query, aiFilterActive: true },
      })
      setAiInput('')
    } catch (err: any) {
      setAiError(err?.message ?? 'Network error')
    } finally {
      setAiLoading(false)
    }
  }

  const clearAiFilter = () => {
    dispatch({
      type: 'SET_TABLE_STATE',
      updates: { aiFilterPlan: null, aiFilterQuery: null, aiFilterActive: false },
    })
    setAiError(null)
  }

  const editAiFilter = () => {
    if (!aiFilterQuery) return
    setAiInput(aiFilterQuery)
    dispatch({
      type: 'SET_TABLE_STATE',
      updates: { aiFilterPlan: null, aiFilterQuery: null, aiFilterActive: false },
    })
    setAiError(null)
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-0.5 rounded border border-border bg-surface2 p-0.5">
        {(['all', 'etf', 'stock', 'tfa', 'pullback'] as PrimaryFilter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setPrimaryFilter(f)}
            title={
              f === 'tfa'
                ? 'Shows turnaround candidates roughly 40% to 90% below 52-week high'
                : f === 'pullback'
                  ? 'Shows top momentum stocks with RSI pullback setups'
                  : undefined
            }
            className={`focus-ring rounded px-2.5 py-1 font-mono text-ui-sm transition-colors ${
              primaryFilter === f
                ? 'border border-accent/30 bg-accent/20 text-accent'
                : 'text-muted hover:text-gray-300'
            }`}
          >
            {f === 'all' && 'All'}
            {f === 'etf' && 'ETFs & ETCs'}
            {f === 'stock' && 'Stocks'}
            {f === 'tfa' &&
              `TFA ${
                tfaMode
                  ? `(${monitoring} / ${aboveAllMAs} / ${watch}${fetching > 0 ? ` / ${fetching}` : ''} / ${qualified})`
                  : ''
              }`}
            {f === 'pullback' && `Pullback ${pullbackMode ? `(${pullbackCount})` : ''}`}
          </button>
        ))}
      </div>

      <div className="flex max-w-[430px] min-w-[220px] flex-1 items-center gap-1.5">
        {aiFilterActive && aiFilterQuery ? (
          <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded border border-accent/30 bg-accent/10 px-2 py-1 font-mono text-ui-sm text-accent">
            <span className="shrink-0">✦</span>
            <span className="min-w-0 flex-1 truncate" title={aiFilterQuery}>
              {aiFilterQuery}
            </span>
            <button
              type="button"
              onClick={editAiFilter}
              className="focus-ring shrink-0 text-accent/70 transition-colors hover:text-accent"
              title="Edit filter text"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={clearAiFilter}
              className="focus-ring ml-1 shrink-0 text-accent/65 transition-colors hover:text-accent"
              title="Remove filter"
              aria-label="Remove AI filter"
            >
              ×
            </button>
          </div>
        ) : (
          <>
            <input
              type="text"
              value={aiInput}
              onChange={(e) => {
                setAiInput(e.target.value)
                setAiError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAiFilter()
              }}
              placeholder="AI filter: e.g. profitable stocks below MA50"
              className={`focus-ring flex-1 rounded border bg-bg px-2.5 py-1 font-mono text-ui-sm text-gray-300 placeholder:text-muted ${
                aiError ? 'border-red-400/50' : 'border-border'
              }`}
              aria-label="AI filter input"
            />
            <button
              type="button"
              onClick={handleAiFilter}
              disabled={!aiInput.trim() || aiLoading}
              className="focus-ring shrink-0 rounded border border-accent/30 px-2 py-1 font-mono text-ui-sm text-accent transition-colors hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-30"
              title="Apply AI filter (Enter)"
              aria-label="Apply AI filter"
            >
              {aiLoading ? '…' : '✦'}
            </button>
          </>
        )}

        {aiError && (
          <span
            className="max-w-[160px] shrink-0 truncate font-mono text-ui-xs text-red-400"
            title={aiError}
          >
            ✗ {aiError}
          </span>
        )}
      </div>

      <span className="ml-1 font-mono text-ui-sm text-muted">
        {displayed.length.toLocaleString()}
        {displayed.length !== state.instruments.length && (
          <span className="text-muted"> / {state.instruments.length.toLocaleString()}</span>
        )}{' '}
        instruments
      </span>

      {topNAvailable > 0 && (
        <div className="ml-1 flex items-center gap-2 font-mono text-ui-sm text-muted">
          <span>Analyst Top {ANALYST_AUTO_TOP_N}: {topNLoaded}/{topNAvailable}</span>
          <div className="h-1 w-20 overflow-hidden rounded border border-border bg-surface2">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${topNProgressPct}%` }}
            />
          </div>
        </div>
      )}

      <div className="relative ml-auto hidden lg:block" ref={colMenuRef}>
        <button
          type="button"
          onClick={() => setColMenuOpen(!colMenuOpen)}
          className="btn btn-sm btn-secondary focus-ring"
          aria-expanded={colMenuOpen}
          aria-haspopup="menu"
          aria-label="Toggle column visibility menu"
        >
          Columns
          {hiddenColumnGroups.length > 0 ? (
            <span className="text-accent">({hiddenColumnGroups.length} hidden)</span>
          ) : null}
        </button>
        {colMenuOpen && (
          <div
            className="absolute right-0 top-full z-20 mt-1 flex min-w-[160px] flex-col gap-1 rounded border border-border bg-surface p-2 shadow-xl"
            role="menu"
          >
            {(Object.keys(COL_GROUP_LABELS) as ColumnGroup[]).map((group) => {
              const hidden = hiddenColumnGroups.includes(group)
              return (
                <button
                  key={group}
                  type="button"
                  onClick={() => dispatch({ type: 'TOGGLE_COLUMN_GROUP', group })}
                  className={`focus-ring flex items-center gap-2 rounded px-2 py-1 text-left font-mono text-ui-sm transition-colors hover:bg-surface2 ${
                    hidden ? 'text-muted' : 'text-gray-300'
                  }`}
                  role="menuitemcheckbox"
                  aria-checked={!hidden}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      hidden ? 'border border-border bg-surface2' : 'bg-accent'
                    }`}
                  />
                  {COL_GROUP_LABELS[group]}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {isActive && (
        <div className="ml-auto flex items-center gap-2 font-mono text-ui-sm text-muted">
          <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
          {fetchStatus.message}
          {fetchStatus.total > 0 && (
            <div className="h-1 w-24 overflow-hidden rounded border border-border bg-surface2">
              <div
                className="h-full bg-accent transition-all duration-300"
                style={{ width: `${Math.min(100, (fetchStatus.current / fetchStatus.total) * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}

      {fetchStatus.phase === 'done' && <StatusBadge tone="success">✓ {fetchStatus.message}</StatusBadge>}
      {fetchStatus.phase === 'error' && <StatusBadge tone="danger">✗ {fetchStatus.message}</StatusBadge>}
    </div>
  )
}
