import { useAppState } from '../store'
import { usePipeline } from '../hooks/usePipeline'

export function PortfolioPanel() {
  const { state, dispatch } = useAppState()
  const { fetchPortfolioPrices, fetchSingleInstrumentPrices, processManualInput } = usePipeline()

  const portfolio = state.instruments.filter((i) => i.inPortfolio)
  const missingIsins = state.portfolioIsins.filter((isin) => !portfolio.find((i) => i.isin === isin))

  if (portfolio.length === 0) {
    return (
      <div className="text-[11px] font-mono text-muted">
        No portfolio instruments.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          onClick={() => fetchPortfolioPrices(portfolio.map((i) => i.isin))}
          className="text-[10px] px-2 py-1 rounded border border-border text-muted hover:text-gray-300 hover:border-accent/40 transition-colors"
        >
          Load prices
        </button>
        {missingIsins.length > 0 && (
          <button
            onClick={() => processManualInput(missingIsins.join('\n'), false)}
            className="text-[10px] px-2 py-1 rounded border border-border text-muted hover:text-gray-300 hover:border-accent/40 transition-colors"
          >
            Load instruments
          </button>
        )}
        <span className="text-[10px] text-muted font-mono">{portfolio.length} items</span>
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
    </div>
  )
}
