import { useAppState, useDisplayedInstruments } from '../store'
import type { TypeFilter } from '../types'

export function FilterBar() {
  const { state, dispatch } = useAppState()
  const displayed = useDisplayedInstruments()
  const { typeFilter, showDeduped } = state.tableState
  const { fetchStatus } = state

  const setTypeFilter = (f: TypeFilter) =>
    dispatch({ type: 'SET_TABLE_STATE', updates: { typeFilter: f } })

  const isActive = ['openfigi', 'prices', 'justetf', 'dedup', 'parsing'].includes(fetchStatus.phase)

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
      <button
        onClick={() =>
          dispatch({ type: 'SET_TABLE_STATE', updates: { showDeduped: !showDeduped } })
        }
        className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono rounded border transition-colors ${
          showDeduped
            ? 'bg-green-400/10 text-green-400 border-green-400/30'
            : 'text-muted border-border hover:text-gray-300'
        }`}
      >
        <span className={`w-2 h-2 rounded-full ${showDeduped ? 'bg-green-400' : 'bg-muted'}`} />
        Deduplicated
      </button>

      {/* Instrument count */}
      <span className="text-xs font-mono text-muted ml-1">
        {displayed.length.toLocaleString()} instruments
      </span>

      {/* Fetch status */}
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
        <span className="ml-auto text-xs font-mono text-green-400">
          ✓ {fetchStatus.message}
        </span>
      )}

      {fetchStatus.phase === 'error' && (
        <span className="ml-auto text-xs font-mono text-red-400">
          ✗ {fetchStatus.message}
        </span>
      )}
    </div>
  )
}
