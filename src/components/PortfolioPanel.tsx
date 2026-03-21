import { useState } from 'react'
import { useAppState } from '../store'
import { usePipeline } from '../hooks/usePipeline'
import { usePortfolioAnalysis } from '../hooks/usePortfolioAnalysis'
import { ModalShell } from './ui/ModalShell'
import { StatusBadge } from './ui/StatusBadge'

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
      <div className="text-ui-sm font-mono text-muted">
        No portfolio instruments.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {portfolio.length > 0 && needsPriceLoad && (
          <button
            type="button"
            onClick={() => fetchPortfolioPrices(portfolio.map((i) => i.isin))}
            className="btn btn-sm btn-secondary focus-ring"
          >
            Load prices
          </button>
        )}
        {missingIsins.length > 0 && (
          <button
            type="button"
            onClick={() => processManualInput(missingIsins.join('\n'), false)}
            className="btn btn-sm btn-secondary focus-ring"
          >
            Load instruments
          </button>
        )}
        <span className="text-ui-xs text-muted font-mono">
          {portfolio.length} items{missingIsins.length > 0 ? ` · ${missingIsins.length} missing` : ''}
        </span>
      </div>
      <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
        {portfolio.map((inst) => (
          <div key={inst.isin} className="flex items-center gap-2 text-ui-sm font-mono">
            <span className="truncate flex-1 text-gray-300">{inst.displayName}</span>
            <button
              type="button"
              onClick={() => dispatch({ type: 'TOGGLE_PORTFOLIO', isin: inst.isin })}
              className="focus-ring text-ui-xs text-muted hover:text-red-400"
              title="Remove from portfolio"
              aria-label={`Remove ${inst.displayName} from portfolio`}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Hinweis für manuelle Instrumente */}
      {portfolioCount > 0 && (
        <div className="text-ui-xs text-muted font-mono mt-2 leading-snug">
          Best results with Xetra instruments — manual inputs have fewer
          exposure signals.
        </div>
      )}

      {/* ── Haupt-Button ── */}
      <div className="flex gap-2 mt-3 items-center">
        <button
          type="button"
          onClick={run}
          disabled={isRunning || portfolioCount === 0}
          className="btn btn-md btn-secondary focus-ring flex-1 font-semibold"
          title="Analyze portfolio structure and search for current market 
             developments (uses web search for briefing, cached 2h)"
        >
          {isRunning ? (
            <>
              <span className="w-2 h-2 rounded-full bg-accent animate-pulse shrink-0" />
              Analyzing...
            </>
          ) : (
            'Analyze portfolio'
          )}
        </button>

        {(structureResult || briefingResult) && !isRunning && (
          <button
            type="button"
            onClick={clear}
            className="focus-ring text-ui-sm font-mono text-muted hover:text-red-400
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

      {structureResult && (
        <div className={`mt-3 p-2 rounded border text-[11px] font-mono ${
          structureResult.severity === 'ok'
            ? 'border-green-400/30 bg-green-400/5'
            : structureResult.severity === 'warning'
            ? 'border-amber-400/30 bg-amber-400/5'
            : 'border-red-400/30 bg-red-400/5'
        }`}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-ui-xs text-muted uppercase tracking-wider font-mono">
              Structure
            </span>
            <StatusBadge
              tone={
                structureResult.severity === 'ok'
                  ? 'success'
                  : structureResult.severity === 'warning'
                    ? 'warning'
                    : 'danger'
              }
              className="ml-auto"
            >
              {structureResult.severity === 'ok'
                ? '✓ OK'
                : structureResult.severity === 'warning'
                  ? '⚠ Warning'
                  : '✗ Critical'}
            </StatusBadge>
          </div>
          <ul className="space-y-1">
            {structureResult.findings.map((f, i) => (
              <li key={i} className="text-gray-300 leading-snug">· {f}</li>
            ))}
          </ul>
        </div>
      )}

      {structureError && structureStatus === 'error' && (
        <div className="mt-2 text-ui-sm font-mono text-red-400">
          Structure error: {structureError}
        </div>
      )}

      {briefingResult && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-ui-xs text-muted uppercase tracking-wider font-mono">
              Market Briefing
            </span>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-ui-xs text-muted font-mono">
                {new Date(briefingResult.fetchedAt).toLocaleTimeString('en-GB')}
                {briefingIsStale && (
                  <span className="text-amber-400 ml-1">(stale)</span>
                )}
              </span>
              <button
                type="button"
                onClick={() => setBriefingExpanded(true)}
                className="btn btn-sm btn-ghost focus-ring"
                title="Expand briefing"
              >
                Expand
              </button>
            </div>
          </div>

          {briefingResult.macroContext && (
            <div className="px-2 py-1.5 rounded border border-border bg-surface2/40 text-ui-sm font-mono text-muted leading-snug italic">
              {briefingResult.macroContext}
            </div>
          )}

          {briefingResult.findings.map((f, i) => (
            <BriefingFindingCard key={i} finding={f} />
          ))}
        </div>
      )}

      {briefingError && briefingStatus === 'error' && (
        <div className="mt-2 text-ui-sm font-mono text-red-400">
          Briefing error: {briefingError}
        </div>
      )}

      {briefingExpanded && briefingResult && (
        <ModalShell
          title="Market Briefing"
          subtitle={`${new Date(briefingResult.fetchedAt).toLocaleTimeString('en-GB')}${briefingIsStale ? ' (stale)' : ''}`}
          onClose={() => setBriefingExpanded(false)}
          widthClass="max-w-4xl"
        >
          {briefingResult.macroContext && (
            <div className="px-2 py-1.5 rounded border border-border bg-surface2/40 text-ui-sm font-mono text-muted leading-snug italic">
              {briefingResult.macroContext}
            </div>
          )}
          <div className="mt-2 flex flex-col gap-2">
            {briefingResult.findings.map((f, i) => (
              <BriefingFindingCard key={i} finding={f} />
            ))}
          </div>
        </ModalShell>
      )}
    </div>
  )
}

function BriefingFindingCard({
  finding,
}: {
  finding: {
    headline: string
    detail: string
    instruments: string[]
    priority: 'high' | 'medium' | 'low'
    sentiment: 'positive' | 'negative' | 'neutral'
  }
}) {
  return (
    <div
      className={`rounded border p-2 text-ui-sm font-mono ${
        finding.priority === 'high'
          ? finding.sentiment === 'negative'
            ? 'border-red-400/30 bg-red-400/5'
            : finding.sentiment === 'positive'
              ? 'border-green-400/30 bg-green-400/5'
              : 'border-amber-400/30 bg-amber-400/5'
          : 'border-border bg-surface2/30'
      }`}
    >
      <div className="mb-1 flex items-start justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {finding.instruments.map((name, j) => (
            <span
              key={j}
              className="rounded border border-border bg-surface2 px-1 py-0.5 text-ui-xs text-gray-400"
            >
              {name.length > 20 ? name.substring(0, 20) + '…' : name}
            </span>
          ))}
        </div>
        <span
          className={`shrink-0 text-ui-xs ${
            finding.priority === 'high'
              ? 'text-red-400'
              : finding.priority === 'medium'
                ? 'text-amber-400'
                : 'text-muted'
          }`}
        >
          {finding.priority}
        </span>
      </div>

      <div
        className={`mb-0.5 font-semibold ${
          finding.sentiment === 'positive'
            ? 'text-green-400'
            : finding.sentiment === 'negative'
              ? 'text-red-400'
              : 'text-gray-300'
        }`}
      >
        {finding.sentiment === 'positive' ? '↑ ' : finding.sentiment === 'negative' ? '↓ ' : '· '}
        {finding.headline}
      </div>

      <div className="leading-snug text-muted">{finding.detail}</div>
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
    <div className="flex items-center gap-2 text-ui-sm font-mono text-muted">
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
