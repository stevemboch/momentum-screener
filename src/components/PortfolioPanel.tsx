import { useState } from 'react'
import { useAppState } from '../store'
import { usePipeline } from '../hooks/usePipeline'
import { usePortfolioAnalysis } from '../hooks/usePortfolioAnalysis'

export function PortfolioPanel() {
  const { state, dispatch } = useAppState()
  const { fetchPortfolioPrices, processManualInput } = usePipeline()
  const {
    structureStatus, structureResult, structureError,
    briefingStatus,  briefingResult,  briefingError, briefingIsStale,
    isRunning,
    run,
    clear,
  } = usePortfolioAnalysis()
  const [briefingExpanded, setBriefingExpanded] = useState(false)
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
              onClick={() => dispatch({ type: 'TOGGLE_PORTFOLIO', isin: inst.isin })}
              className="text-[10px] text-muted hover:text-red-400"
              title="Remove from portfolio"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Hinweis für manuelle Instrumente */}
      {portfolioCount > 0 && (
        <div className="text-[10px] text-muted font-mono mt-2 leading-snug">
          Best results with Xetra instruments — manual inputs have fewer
          exposure signals.
        </div>
      )}

      {/* ── Haupt-Button ── */}
      <div className="flex gap-2 mt-3 items-center">
        <button
          onClick={run}
          disabled={isRunning || portfolioCount === 0}
          className="flex-1 px-2 py-1.5 text-xs font-mono border border-border
                 text-muted hover:text-gray-300 hover:border-accent/50
                 disabled:opacity-40 disabled:cursor-not-allowed rounded
                 transition-colors flex items-center justify-center gap-1.5"
          title="Analyse portfolio structure and search for current market 
             developments (uses web search for briefing, cached 2h)"
        >
          {isRunning ? (
            <>
              <span className="w-2 h-2 rounded-full bg-accent animate-pulse shrink-0" />
              Analysing…
            </>
          ) : (
            '🔍 Analyse Portfolio'
          )}
        </button>

        {(structureResult || briefingResult) && !isRunning && (
          <button
            onClick={clear}
            className="text-[11px] font-mono text-muted hover:text-red-400
                   transition-colors shrink-0"
            title="Clear all results"
          >
            × clear
          </button>
        )}
      </div>

      {/* ── Progress Rows — nur während des Ladens sichtbar ── */}
      {isRunning && (
        <div className="mt-2 flex flex-col gap-1">
          <AnalysisProgressRow
            label="Structure"
            icon="🔍"
            status={structureStatus}
          />
          <AnalysisProgressRow
            label="Market Briefing"
            icon="🌐"
            status={briefingStatus}
          />
        </div>
      )}

      {/* ── Structure Result — erscheint sobald verfügbar ── */}
      {structureResult && (
        <div className={`mt-3 p-2 rounded border text-[11px] font-mono ${
          structureResult.severity === 'ok'
            ? 'border-green-400/30 bg-green-400/5'
            : structureResult.severity === 'warning'
            ? 'border-amber-400/30 bg-amber-400/5'
            : 'border-red-400/30 bg-red-400/5'
        }`}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[10px] text-muted uppercase tracking-wider font-mono">
              Structure
            </span>
            <span className={`ml-auto font-semibold ${
              structureResult.severity === 'ok'      ? 'text-green-400' :
              structureResult.severity === 'warning' ? 'text-amber-400' : 'text-red-400'
            }`}>
              {structureResult.severity === 'ok'
                ? '✓ OK'
                : structureResult.severity === 'warning'
                ? '⚠ Warning'
                : '✗ Critical'}
            </span>
          </div>
          <ul className="space-y-1">
            {structureResult.findings.map((f, i) => (
              <li key={i} className="text-gray-300 leading-snug">· {f}</li>
            ))}
          </ul>
        </div>
      )}

      {structureError && structureStatus === 'error' && (
        <div className="mt-2 text-[11px] font-mono text-red-400">
          Structure error: {structureError}
        </div>
      )}

      {/* ── Briefing Result — erscheint sobald verfügbar ── */}
      {briefingResult && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted uppercase tracking-wider font-mono">
              Market Briefing
            </span>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[10px] text-muted font-mono">
                {new Date(briefingResult.fetchedAt).toLocaleTimeString('en-GB')}
                {briefingIsStale && (
                  <span className="text-amber-400 ml-1">(stale)</span>
                )}
              </span>
              <button
                onClick={() => setBriefingExpanded(true)}
                className="text-[10px] font-mono text-muted hover:text-gray-300"
                title="Expand briefing"
              >
                ⤢ expand
              </button>
            </div>
          </div>

          {briefingResult.macroContext && (
            <div className="px-2 py-1.5 rounded border border-border bg-surface2/40
                        text-[11px] font-mono text-muted leading-snug italic">
              {briefingResult.macroContext}
            </div>
          )}

          {briefingResult.findings.map((f, i) => (
            <div
              key={i}
              className={`p-2 rounded border text-[11px] font-mono ${
                f.priority === 'high'
                  ? f.sentiment === 'negative'
                    ? 'border-red-400/30 bg-red-400/5'
                    : f.sentiment === 'positive'
                    ? 'border-green-400/30 bg-green-400/5'
                    : 'border-amber-400/30 bg-amber-400/5'
                  : 'border-border bg-surface2/30'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="flex flex-wrap gap-1">
                  {f.instruments.map((name, j) => (
                    <span
                      key={j}
                      className="text-[10px] px-1 py-0.5 rounded bg-surface2
                             border border-border text-gray-400"
                    >
                      {name.length > 20 ? name.substring(0, 20) + '…' : name}
                    </span>
                  ))}
                </div>
                <span className={`shrink-0 text-[10px] ${
                  f.priority === 'high'   ? 'text-red-400' :
                  f.priority === 'medium' ? 'text-amber-400' : 'text-muted'
                }`}>
                  {f.priority}
                </span>
              </div>

              <div className={`font-semibold mb-0.5 ${
                f.sentiment === 'positive' ? 'text-green-400' :
                f.sentiment === 'negative' ? 'text-red-400'   : 'text-gray-300'
              }`}>
                {f.sentiment === 'positive' ? '↑ ' :
                 f.sentiment === 'negative' ? '↓ ' : '· '}
                {f.headline}
              </div>

              <div className="text-muted leading-snug">{f.detail}</div>
            </div>
          ))}
        </div>
      )}

      {briefingError && briefingStatus === 'error' && (
        <div className="mt-2 text-[11px] font-mono text-red-400">
          Briefing error: {briefingError}
        </div>
      )}

      {briefingExpanded && briefingResult && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setBriefingExpanded(false)}
        >
          <div
            className="w-full max-w-3xl max-h-[85vh] overflow-hidden rounded border border-border bg-surface2 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
              <span className="text-[11px] text-muted uppercase tracking-wider font-mono">
                Market Briefing
              </span>
              <span className="text-[10px] text-muted font-mono ml-auto">
                {new Date(briefingResult.fetchedAt).toLocaleTimeString('en-GB')}
                {briefingIsStale && (
                  <span className="text-amber-400 ml-1">(stale)</span>
                )}
              </span>
              <button
                onClick={() => setBriefingExpanded(false)}
                className="text-[11px] font-mono text-muted hover:text-red-400"
                title="Close"
              >
                × close
              </button>
            </div>

            <div className="p-3 overflow-y-auto max-h-[80vh]">
              {briefingResult.macroContext && (
                <div className="px-2 py-1.5 rounded border border-border bg-surface2/40
                        text-[11px] font-mono text-muted leading-snug italic">
                  {briefingResult.macroContext}
                </div>
              )}

              <div className="mt-2 flex flex-col gap-2">
                {briefingResult.findings.map((f, i) => (
                  <div
                    key={i}
                    className={`p-2 rounded border text-[11px] font-mono ${
                      f.priority === 'high'
                        ? f.sentiment === 'negative'
                          ? 'border-red-400/30 bg-red-400/5'
                          : f.sentiment === 'positive'
                          ? 'border-green-400/30 bg-green-400/5'
                          : 'border-amber-400/30 bg-amber-400/5'
                        : 'border-border bg-surface2/30'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="flex flex-wrap gap-1">
                        {f.instruments.map((name, j) => (
                          <span
                            key={j}
                            className="text-[10px] px-1 py-0.5 rounded bg-surface2
                             border border-border text-gray-400"
                          >
                            {name.length > 20 ? name.substring(0, 20) + '…' : name}
                          </span>
                        ))}
                      </div>
                      <span className={`shrink-0 text-[10px] ${
                        f.priority === 'high'   ? 'text-red-400' :
                        f.priority === 'medium' ? 'text-amber-400' : 'text-muted'
                      }`}>
                        {f.priority}
                      </span>
                    </div>

                    <div className={`font-semibold mb-0.5 ${
                      f.sentiment === 'positive' ? 'text-green-400' :
                      f.sentiment === 'negative' ? 'text-red-400'   : 'text-gray-300'
                    }`}>
                      {f.sentiment === 'positive' ? '↑ ' :
                       f.sentiment === 'negative' ? '↓ ' : '· '}
                      {f.headline}
                    </div>

                    <div className="text-muted leading-snug">{f.detail}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function AnalysisProgressRow({
  label,
  icon,
  status,
}: {
  label: string
  icon: string
  status: 'idle' | 'loading' | 'done' | 'error'
}) {
  return (
    <div className="flex items-center gap-2 text-[11px] font-mono text-muted">
      <span>{icon}</span>
      <span>{label}</span>
      <span className="ml-auto">
        {status === 'loading' && (
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            running
          </span>
        )}
        {status === 'done'  && <span className="text-green-400">✓ done</span>}
        {status === 'error' && <span className="text-red-400">✗ error</span>}
        {status === 'idle'  && <span className="text-muted">—</span>}
      </span>
    </div>
  )
}
