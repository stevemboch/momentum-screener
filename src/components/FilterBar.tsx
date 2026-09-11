import { useEffect, useMemo, useRef, useState } from 'react'
import { apiFetchJson } from '../api/client'
import { useAppState, useDisplayedInstruments } from '../store'
import type { ColumnGroup, TypeFilter } from '../types'
import { isAiFilterPlan } from '../utils/aiFilter'
import { StatusBadge } from './ui/StatusBadge'
import { ANALYST_AUTO_TOP_N } from '../constants/analyst'
import { selectTopAnalystStocks } from '../utils/analystTopN'

const COL_GROUP_LABELS: Record<ColumnGroup, string> = {
  scores: 'Scores',
  returns: 'Returns',
  technical: 'Technical',
  fundamentals: 'Fundamentals',
  breakout: 'Breakout',
  tfa: 'TFA',
  pullback: 'Pullback',
  botsi: 'BOTSI',
}

export function FilterBar() {
  const { state, dispatch } = useAppState()
  const displayed = useDisplayedInstruments()
  const {
    typeFilter,
    hiddenColumnGroups,
    tfaMode,
    pullbackMode,
    botsiMode,
    aiFilterQuery,
    aiFilterActive,
  } = state.tableState
  const { fetchStatus } = state
  const { regionFilter, excludedRegionFilters, primaryListingCountryFilter, sectorFilter } = state.tableState
  const [colMenuOpen, setColMenuOpen] = useState(false)
  const colMenuRef = useRef<HTMLDivElement | null>(null)
  const [aiInput, setAiInput] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(() => Boolean(regionFilter || primaryListingCountryFilter || sectorFilter || excludedRegionFilters.length))

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
  const botsiQualified = useMemo(
    () => state.instruments.filter((i) => i.botsiTop10 === true && i.botsiFilterPassed === true).length,
    [state.instruments]
  )
  const botsiQuotePct = useMemo(
    () => state.instruments.reduce((sum, i) => sum + (i.botsiTargetWeight ?? 0), 0),
    [state.instruments]
  )
  const botsiActionable = useMemo(
    () => state.instruments.filter((i) => i.botsiAdvisorAction != null).length,
    [state.instruments]
  )
  const { topNTarget, topNLoaded } = useMemo(() => {
    const topNStocks = selectTopAnalystStocks(state.instruments, ANALYST_AUTO_TOP_N)
    return {
      topNTarget: topNStocks.length,
      topNLoaded: topNStocks.filter((i) => i.analystFetched).length,
    }
  }, [state.instruments])
  const topNProgressPct = topNTarget > 0 ? Math.min(100, (topNLoaded / topNTarget) * 100) : 0
  const showTopNProgress = topNTarget > 0 && topNLoaded < topNTarget
  const classificationOptions = useMemo(() => {
    const unique = (values: Array<string | null | undefined>) =>
      [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b))
    // The snapshot is available before price/enrichment data. Include it so
    // the classifications never disappear while that background work runs.
    const constituents = state.universeSnapshot?.constituents ?? []
    return {
      regions: unique([...state.instruments.map((i) => i.indexRegion), ...constituents.map((i) => i.region)]),
      countries: unique([...state.instruments.map((i) => i.primaryListingCountry), ...constituents.map((i) => i.primaryListingCountry)]),
      sectors: unique([...state.instruments.map((i) => i.sector), ...constituents.map((i) => i.sector)]),
    }
  }, [state.instruments, state.universeSnapshot])

  type PrimaryFilter = TypeFilter | 'tfa' | 'pullback'
  const primaryFilter: PrimaryFilter = tfaMode ? 'tfa' : pullbackMode ? 'pullback' : typeFilter
  const isActive = ['openfigi', 'prices', 'justetf', 'dedup', 'parsing'].includes(fetchStatus.phase)

  const addExcludedRegion = (region: string) => {
    if (!region || excludedRegionFilters.includes(region)) return
    dispatch({
      type: 'SET_TABLE_STATE',
      updates: { excludedRegionFilters: [...excludedRegionFilters, region] },
    })
  }

  const removeExcludedRegion = (region: string) => {
    dispatch({
      type: 'SET_TABLE_STATE',
      updates: { excludedRegionFilters: excludedRegionFilters.filter((value) => value !== region) },
    })
  }

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
          botsiMode: false,
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
        botsiMode: false,
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
    <div className="flex w-full flex-wrap items-center gap-2.5">
      <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-surface2 p-0.5" aria-label="Instrument type">
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

      <button
        type="button"
        onClick={() => setFiltersOpen((open) => !open)}
        className={`btn btn-sm focus-ring shrink-0 ${filtersOpen ? 'btn-primary' : 'btn-ghost'}`}
        aria-expanded={filtersOpen}
        aria-controls="classification-filters"
      >
        Filters
        {(regionFilter || primaryListingCountryFilter || sectorFilter || excludedRegionFilters.length > 0) && (
          <span className="status-badge status-info !px-1 !py-0">active</span>
        )}
      </button>

      {filtersOpen && (
      <div id="classification-filters" className="order-4 flex w-full flex-wrap items-center gap-1.5 border-t border-border/70 pt-2.5">
        <span className="mr-1 font-mono text-ui-xs uppercase tracking-widest text-muted">Narrow results</span>
        <select
          value={regionFilter}
          onChange={(event) => dispatch({ type: 'SET_TABLE_STATE', updates: { regionFilter: event.target.value } })}
          className="filter-select"
          aria-label="Include only index region"
        >
          <option value="">All regions</option>
          {classificationOptions.regions.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>

        <select
          value=""
          onChange={(event) => addExcludedRegion(event.target.value)}
          className="filter-select text-muted"
          aria-label="Exclude an index region"
        >
          <option value="">Exclude region…</option>
          {classificationOptions.regions
            .filter((value) => !excludedRegionFilters.includes(value))
            .map((value) => <option key={value} value={value}>Exclude {value}</option>)}
        </select>

        {excludedRegionFilters.map((region) => (
          <button
            key={region}
            type="button"
            onClick={() => removeExcludedRegion(region)}
            className="focus-ring inline-flex items-center gap-1 rounded border border-red-400/30 bg-red-400/5 px-1.5 py-1 font-mono text-ui-xs text-red-300 transition-colors hover:bg-red-400/15"
            title={`${region} aus dem Ergebnis entfernen`}
            aria-label={`Remove excluded region ${region}`}
          >
            − {region} <span aria-hidden="true">×</span>
          </button>
        ))}
      <select
        value={primaryListingCountryFilter}
        onChange={(event) => dispatch({ type: 'SET_TABLE_STATE', updates: { primaryListingCountryFilter: event.target.value } })}
        className="filter-select"
        aria-label="Filter by primary listing country"
      >
        <option value="">All listing countries</option>
        {classificationOptions.countries.map((value) => <option key={value} value={value}>{value}</option>)}
      </select>

      <select
        value={sectorFilter}
        onChange={(event) => dispatch({ type: 'SET_TABLE_STATE', updates: { sectorFilter: event.target.value } })}
        className="filter-select"
        aria-label="Filter by GICS sector"
      >
        <option value="">All GICS sectors</option>
        {classificationOptions.sectors.map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
      </div>
      )}

      <div className="order-2 flex min-w-[240px] flex-1 items-center gap-1.5">
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

      <span className="order-3 ml-1 whitespace-nowrap font-mono text-ui-sm text-muted">
        {displayed.length.toLocaleString()}
        {displayed.length !== state.instruments.length && (
          <span className="text-muted"> / {state.instruments.length.toLocaleString()}</span>
        )}{' '}
        instruments
      </span>

      {showTopNProgress && (
        <div className="ml-1 flex items-center gap-2 font-mono text-ui-sm text-muted">
          <span>Analyst Top {ANALYST_AUTO_TOP_N}: {topNLoaded}/{topNTarget}</span>
          <div className="h-1 w-20 overflow-hidden rounded border border-border bg-surface2">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${topNProgressPct}%` }}
            />
          </div>
        </div>
      )}

      {botsiMode && (
        <div className="ml-1 flex flex-wrap items-center gap-2 font-mono text-ui-sm text-muted">
          <StatusBadge tone="info">BOTSI</StatusBadge>
          <span>{botsiQualified}/10 qualifiziert</span>
          <span className="text-muted">|</span>
          <span>Aktienquote: {(botsiQuotePct * 100).toFixed(0)}%</span>
          <span className="text-muted">|</span>
          <span>Aktionen: {botsiActionable}</span>
          <span className="text-muted">|</span>
          <span>GD130 0%</span>
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
