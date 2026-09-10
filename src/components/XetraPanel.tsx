import { useEffect, useState } from 'react'
import { Database, Loader, ChevronDown, ChevronUp } from 'lucide-react'
import { useAppState } from '../store'
import { usePipeline } from '../hooks/usePipeline'
import { StatusBadge } from './ui/StatusBadge'

export function XetraPanel() {
  const { state, dispatch } = useAppState()
  const { loadXetraBackground, activateXetra, loadFrankfurtBackground, activateFrankfurt, activateIndexUniverse } = usePipeline()
  const [showGroups, setShowGroups] = useState(false)
  const [showFrankfurtGroups, setShowFrankfurtGroups] = useState(false)

  const isLoading = ['openfigi', 'prices', 'justetf', 'dedup', 'parsing'].includes(state.fetchStatus.phase)

  // Load Xetra CSV in background on mount
  useEffect(() => {
    if (!state.xetraReady && !state.xetraLoading) {
      loadXetraBackground()
    }
  }, [])

  // Load Frankfurt CSV in background on mount
  useEffect(() => {
    if (!state.frankfurtReady && !state.frankfurtLoading) {
      loadFrankfurtBackground()
    }
  }, [])

  const enabledETFCount = state.etfGroups
    .filter((g) => g.enabled)
    .reduce((s, g) => s + g.count, 0)

  const enabledStockCount = state.stockGroups
    .filter((g) => g.enabled)
    .reduce((s, g) => s + g.count, 0)

  const enabledFrankfurtCount = state.frankfurtGroups
    .filter((g) => g.enabled)
    .reduce((s, g) => s + g.count, 0)

  return (
    <div className="flex flex-col gap-2">
      <div className="border-b border-border pb-3">
        <div className="mb-1 font-mono text-ui-sm text-gray-200">Index Global <span className="text-accent">DEFAULT</span></div>
        <p className="mb-2 text-ui-xs leading-relaxed text-muted">
          STOXX Europe 600 · S&amp;P 500 · MSCI Japan · MSCI Emerging Markets
        </p>
        <button
          type="button"
          onClick={activateIndexUniverse}
          disabled={isLoading}
          className="btn btn-md btn-primary focus-ring w-full font-semibold"
        >
          {isLoading ? <><Loader size={12} className="animate-spin" /> Processing...</> : <><Database size={12} /> Load Index Universe</>}
        </button>
        {state.universeSnapshot && state.activeUniverse === 'index_global' && (
          <div className={`mt-2 text-ui-xs font-mono ${state.universeSnapshot.status === 'stale' ? 'text-amber-400' : 'text-green-500'}`}>
            {state.universeSnapshot.status === 'stale' ? '● STALE fallback' : '● Snapshot'} · {state.universeSnapshot.asOfDate} · v{state.universeSnapshot.version}
          </div>
        )}
      </div>

      <div className="border-b border-border pb-2">
        <div className="mb-1 font-mono text-ui-xs uppercase tracking-wider text-muted">Legacy: Xetra listings</div>
        <button
          type="button"
          onClick={() => setShowGroups(!showGroups)}
          className="focus-ring flex w-full items-center justify-between py-1 font-mono text-ui-sm text-muted hover:text-gray-300"
          aria-expanded={showGroups}
          aria-label={showGroups ? 'Hide Xetra group filters' : 'Show Xetra group filters'}
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
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 pb-2">
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
            className="btn btn-sm btn-ghost focus-ring w-full mt-1"
          >
            Clear legacy Xetra data
          </button>
        )}
      </div>

      <div className="border-t border-border pt-2">
        <button
          type="button"
          onClick={() => setShowFrankfurtGroups(!showFrankfurtGroups)}
          className="focus-ring flex w-full items-center justify-between py-1 font-mono text-ui-sm text-muted hover:text-gray-300"
          aria-expanded={showFrankfurtGroups}
          aria-label={showFrankfurtGroups ? 'Hide Frankfurt group filters' : 'Show Frankfurt group filters'}
        >
          <span>
            {state.frankfurtReady ? (
              <>
                <span className="text-green-500 mr-1" aria-hidden>●</span>
                {enabledFrankfurtCount.toLocaleString()} Frankfurt shares selected
              </>
            ) : state.frankfurtLoading ? (
              <><span className="text-amber-400 mr-1" aria-hidden>◌</span> Loading Frankfurt...</>
            ) : (
              <><span className="text-muted mr-1" aria-hidden>○</span> Frankfurt universe</>
            )}
          </span>
          {showFrankfurtGroups ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>

        {showFrankfurtGroups && state.frankfurtReady && (
          <div className="pb-2">
            <div className="mb-1 text-ui-xs font-mono uppercase tracking-wider text-muted">Frankfurt groups</div>
            {state.frankfurtGroups.map((g) => (
              <GroupCheckbox
                key={g.groupKey}
                label={g.label}
                count={g.count}
                enabled={g.enabled}
                onChange={(v) => dispatch({ type: 'SET_FRANKFURT_GROUP', groupKey: g.groupKey, enabled: v })}
              />
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={activateFrankfurt}
          disabled={!state.frankfurtReady || isLoading}
          className="btn btn-md btn-secondary focus-ring w-full font-semibold"
        >
          {isLoading ? (
            <><Loader size={12} className="animate-spin" /> Processing...</>
          ) : (
            <><Database size={12} /> Load Frankfurt Equities</>
          )}
        </button>

        {state.frankfurtActive && !isLoading && (
          <button
            type="button"
            onClick={() => dispatch({ type: 'CLEAR_FRANKFURT' })}
            className="btn btn-sm btn-ghost focus-ring w-full mt-1"
          >
            Clear loaded data
          </button>
        )}
      </div>

      {state.xetraLoading && <StatusBadge tone="info">Universe parsing in background</StatusBadge>}
      {state.frankfurtLoading && <StatusBadge tone="info">Frankfurt parsing in background</StatusBadge>}
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
