import { useAppState, useDisplayedInstruments } from '../store'
import type { TypeFilter } from '../types'

export function FilterBar() {
  const { state, dispatch } = useAppState()
  const displayed = useDisplayedInstruments()
  const { typeFilter, showDeduped, filterBelowRiskFree } = state.tableState
  const { fetchStatus, settings } = state

  const setTypeFilter = (f: TypeFilter) =>
    dispatch({ type: 'SET_TABLE_STATE', updates: { typeFilter: f } })

  const isActive = ['openfigi', 'prices', 'justetf', 'dedup', 'parsing'].includes(fetchStatus.phase)

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

      {/* Instrument count */}
      <span className="text-xs font-mono text-muted ml-1">
        {displayed.length.toLocaleString()} instruments
      </span>

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
              <span>{fetchStatus.current}/{fetchStatus.total}</span>
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
