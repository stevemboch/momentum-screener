import { useAppState } from '../store'
import { usePipeline } from '../hooks/usePipeline'
import { usePortfolioCheck } from '../hooks/usePortfolioCheck'

export function PortfolioPanel() {
  const { state, dispatch } = useAppState()
  const { fetchPortfolioPrices, fetchSingleInstrumentPrices, processManualInput } = usePipeline()
  const { result, loading, error, run, clear } = usePortfolioCheck()
  const portfolioCount = state.portfolioIsins.length

  const portfolio = state.instruments.filter((i) => i.inPortfolio)
  const missingIsins = state.portfolioIsins.filter((isin) => !portfolio.find((i) => i.isin === isin))
  const needsPriceLoad = portfolio.some((i) => !i.priceFetched || !i.closes || i.closes.length === 0)

  if (portfolio.length === 0 && missingIsins.length === 0) {
    return (
      <div className="text-[11px] font-mono text-muted">
        No portfolio instruments.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {portfolio.length > 0 && needsPriceLoad && (
          <button
            onClick={() => fetchPortfolioPrices(portfolio.map((i) => i.isin))}
            className="btn btn-muted"
          >
            Load prices
          </button>
        )}
        {missingIsins.length > 0 && (
          <button
            onClick={() => processManualInput(missingIsins.join('\n'), false)}
            className="btn btn-muted"
          >
            Load instruments
          </button>
        )}
        <span className="text-[10px] text-muted font-mono">
          {portfolio.length} items{missingIsins.length > 0 ? ` · ${missingIsins.length} missing` : ''}
        </span>
      </div>
      <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
        {portfolio.map((inst) => (
          <div key={inst.isin} className="flex items-center gap-2 text-[11px] font-mono">
            <span className="truncate flex-1 text-gray-300">{inst.displayName}</span>
            <button
              onClick={() => fetchSingleInstrumentPrices(inst.isin)}
              className="text-[10px] text-accent hover:text-accent/80"
              title="Load prices"
            >
              Load
            </button>
            <button
              onClick={() => dispatch({ type: 'TOGGLE_PORTFOLIO', isin: inst.isin })}
              className="text-[10px] text-muted hover:text-red-400"
              title="Remove from portfolio"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={run}
        disabled={loading || portfolioCount === 0}
        className="w-full mt-3 px-2 py-1.5 text-xs font-mono border border-border 
               text-muted hover:text-gray-300 hover:border-accent/50 
               disabled:opacity-40 disabled:cursor-not-allowed rounded transition-colors"
      >
        {loading ? '…analysiere' : '🔍 Portfolio analysieren'}
      </button>

      {result && (
        <div className={`mt-2 p-2 rounded border text-[11px] font-mono ${
          result.severity === 'ok'      ? 'border-green-400/30 bg-green-400/5' :
          result.severity === 'warning' ? 'border-amber-400/30 bg-amber-400/5' :
                                          'border-red-400/30 bg-red-400/5'
        }`}>
          <div className="flex items-center justify-between mb-1.5">
            <span className={
              result.severity === 'ok'      ? 'text-green-400' :
              result.severity === 'warning' ? 'text-amber-400' : 'text-red-400'
            }>
              {result.severity === 'ok' ? '✓ Ok' : result.severity === 'warning' ? '⚠ Warnung' : '✗ Kritisch'}
            </span>
            <button onClick={clear} className="text-muted hover:text-gray-300">×</button>
          </div>
          <ul className="space-y-1">
            {result.findings.map((f, i) => (
              <li key={i} className="text-gray-300 leading-snug">· {f}</li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="mt-2 text-[11px] font-mono text-red-400">Fehler: {error}</div>
      )}
    </div>
  )
}
