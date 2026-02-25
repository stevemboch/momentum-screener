import { useState } from 'react'
import { useAppState, useDisplayedInstruments } from '../store'
import type { SortColumn } from '../types'
import {
  fmtAUM, fmtTER, fmtPct, fmtRatio, fmtScore, fmtVola, fmtPE, fmtEY, returnColor, scoreColor
} from '../utils/formatters'

type Col = { key: string; label: string; title?: string; align?: 'right' | 'left' }

const COLUMNS: Col[] = [
  { key: 'displayName',      label: 'Name',     align: 'left' },
  { key: 'type',             label: 'Type',     align: 'left' },
  { key: 'momentumScore',    label: 'Momentum', title: 'Weighted return score (rank)' },
  { key: 'sharpeScore',      label: 'Sharpe',   title: 'Momentum ÷ annualised volatility (rank)' },
  { key: 'r1m',              label: '1M',       title: '1-month return' },
  { key: 'r3m',              label: '3M',       title: '3-month return' },
  { key: 'r6m',              label: '6M',       title: '6-month return' },
  { key: 'vola',             label: 'Vola',     title: 'Annualised 6M volatility' },
  { key: 'ma',               label: 'MA',       title: '10/50/100/200 MA flags (▲ above, ▼ below)', align: 'right' },
  { key: 'sellingThreshold', label: 'Stop',     title: 'Selling Threshold = Last Price − a × ATR(20)' },
  { key: 'aum',              label: 'AUM',      title: 'Assets under management' },
  { key: 'ter',              label: 'TER',      title: 'Total expense ratio' },
  { key: 'pe',               label: 'P/E',      title: 'Price / Earnings' },
  { key: 'pb',               label: 'P/B',      title: 'Price / Book' },
  { key: 'valueScore',       label: 'Value',    title: 'ETFs: P/E+P/B rank. Stocks: Magic Formula. Lower = better.' },
]

// MA flag: ▲ green = above, ▼ red = below, · gray = no data
function MaFlag({ above, label }: { above: boolean | null | undefined; label: string }) {
  if (above === null || above === undefined) {
    return <span className="text-muted text-[9px]" title={`${label}: no data`}>·</span>
  }
  return (
    <span
      className={`text-[9px] font-bold ${above ? 'text-green-400' : 'text-red-400'}`}
      title={`${label}: ${above ? 'above' : 'below'}`}
    >
      {above ? '▲' : '▼'}
    </span>
  )
}

function MaCell({ inst }: { inst: any }) {
  return (
    <div className="flex items-center justify-end gap-[3px]">
      <span className="text-muted text-[9px] mr-0.5">10</span><MaFlag above={inst.aboveMa10} label="MA10" />
      <span className="text-muted text-[9px] ml-1 mr-0.5">50</span><MaFlag above={inst.aboveMa50} label="MA50" />
      <span className="text-muted text-[9px] ml-1 mr-0.5">100</span><MaFlag above={inst.aboveMa100} label="MA100" />
      <span className="text-muted text-[9px] ml-1 mr-0.5">200</span><MaFlag above={inst.aboveMa200} label="MA200" />
    </div>
  )
}

function fmtPrice(v: number | null | undefined): string {
  if (v == null) return '—'
  return v.toFixed(2)
}

export function RankingTable() {
  const { state, dispatch } = useAppState()
  const instruments = useDisplayedInstruments()
  const { sortColumn, sortDirection } = state.tableState
  const [expandedISIN, setExpandedISIN] = useState<string | null>(null)

  const handleSort = (col: string) => {
    if (['displayName', 'type', 'ma'].includes(col)) return
    const newCol = col as SortColumn
    if (sortColumn === newCol) {
      dispatch({ type: 'SET_TABLE_STATE', updates: { sortDirection: sortDirection === 'desc' ? 'asc' : 'desc' } })
    } else {
      dispatch({ type: 'SET_TABLE_STATE', updates: { sortColumn: newCol, sortDirection: 'desc' } })
    }
  }

  const sortIcon = (col: string) => {
    if (['displayName', 'type', 'ma'].includes(col)) return ''
    if (sortColumn !== col) return <span className="text-muted ml-1">↕</span>
    return <span className="text-accent ml-1">{sortDirection === 'desc' ? '↓' : '↑'}</span>
  }

  if (instruments.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted font-mono text-sm">
        No instruments loaded. Use the input panel or load the Xetra universe.
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full text-xs font-mono border-collapse min-w-[1400px]">
        <thead className="sticky top-0 z-10 bg-surface border-b border-border">
          <tr>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                title={col.title}
                onClick={() => handleSort(col.key)}
                className={`px-3 py-2 font-semibold text-muted whitespace-nowrap
                  ${col.align === 'left' ? 'text-left' : 'text-right'}
                  ${!['displayName','type','ma'].includes(col.key) ? 'cursor-pointer hover:text-gray-300' : ''}
                  select-none`}
              >
                {col.label}{sortIcon(col.key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {instruments.map((inst, idx) => {
            const isExpanded = expandedISIN === inst.isin
            const rowBg = idx % 2 === 0 ? 'bg-bg' : 'bg-surface'
            return (
              <>
                <tr
                  key={inst.isin}
                  className={`${rowBg} hover:bg-surface2 border-b border-border/30 cursor-pointer`}
                  onClick={() => setExpandedISIN(isExpanded ? null : inst.isin)}
                >
                  {/* Name */}
                  <td className="px-3 py-2 text-left max-w-[220px]">
                    <div className="truncate text-gray-200" title={inst.displayName}>{inst.displayName}</div>
                    <div className="text-muted text-[10px] mt-0.5">{inst.isin}{inst.currency && ` · ${inst.currency}`}</div>
                  </td>

                  {/* Type */}
                  <td className="px-3 py-2 text-left"><TypeBadge type={inst.type} /></td>

                  {/* Momentum */}
                  <td className="px-3 py-2 text-right">
                    <span className={scoreColor(inst.momentumScore)}>{fmtScore(inst.momentumScore, inst.momentumRank)}</span>
                  </td>

                  {/* Sharpe */}
                  <td className="px-3 py-2 text-right">
                    <span className={scoreColor(inst.sharpeScore)}>{fmtScore(inst.sharpeScore, inst.sharpeRank)}</span>
                  </td>

                  {/* Returns */}
                  <td className={`px-3 py-2 text-right ${returnColor(inst.r1m)}`}>{fmtPct(inst.r1m)}</td>
                  <td className={`px-3 py-2 text-right ${returnColor(inst.r3m)}`}>{fmtPct(inst.r3m)}</td>
                  <td className={`px-3 py-2 text-right ${returnColor(inst.r6m)}`}>{fmtPct(inst.r6m)}</td>

                  {/* Vola */}
                  <td className="px-3 py-2 text-right text-muted">{fmtVola(inst.vola)}</td>

                  {/* MA flags */}
                  <td className="px-3 py-2 text-right"><MaCell inst={inst} /></td>

                  {/* Selling Threshold */}
                  <td className="px-3 py-2 text-right">
                    {inst.sellingThreshold != null ? (
                      <span className="text-amber-400" title={`ATR(20): ${inst.atr20?.toFixed(4) ?? '—'}`}>
                        {fmtPrice(inst.sellingThreshold)}
                      </span>
                    ) : inst.priceFetched ? '—' : ''}
                  </td>

                  {/* AUM */}
                  <td className="px-3 py-2 text-right text-gray-300">
                    {inst.aum != null ? fmtAUM(inst.aum) : (inst.justEtfFetched ? '—' : '')}
                  </td>

                  {/* TER */}
                  <td className="px-3 py-2 text-right text-gray-300">
                    {inst.ter != null ? fmtTER(inst.ter) : (inst.justEtfFetched ? '—' : '')}
                  </td>

                  {/* P/E */}
                  <td className="px-3 py-2 text-right text-gray-300">
                    {inst.pe != null ? fmtPE(inst.pe) : (inst.fundamentalsFetched ? '—' : '')}
                  </td>

                  {/* P/B */}
                  <td className="px-3 py-2 text-right text-gray-300">
                    {inst.pb != null ? fmtRatio(inst.pb) : (inst.fundamentalsFetched ? '—' : '')}
                  </td>

                  {/* Value Score */}
                  <td className="px-3 py-2 text-right">
                    {inst.valueScore != null ? (
                      <span className="text-amber-400" title={`Model: ${inst.valueScoreModel}`}>
                        {inst.valueScore.toFixed(0)} ({inst.valueRank})
                      </span>
                    ) : inst.fundamentalsFetched ? '—' : ''}
                  </td>
                </tr>

                {isExpanded && (
                  <tr key={`${inst.isin}-exp`} className={`${rowBg} border-b border-border`}>
                    <td colSpan={COLUMNS.length} className="px-4 py-3">
                      <ExpandedRow inst={inst} atrMultiplier={state.settings.atrMultiplier} />
                    </td>
                  </tr>
                )}
              </>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    ETF: 'text-blue-400 bg-blue-400/10',
    ETC: 'text-amber-400 bg-amber-400/10',
    Stock: 'text-green-400 bg-green-400/10',
    Unknown: 'text-muted bg-surface2',
  }
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${colors[type] || colors.Unknown}`}>
      {type}
    </span>
  )
}

function MARow({ label, value, above, lastPrice }: { label: string; value: number | null | undefined; above: boolean | null | undefined; lastPrice: number | undefined }) {
  if (value == null) return null
  const diff = lastPrice != null ? ((lastPrice - value) / value * 100) : null
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted w-12">{label}:</span>
      <span className="text-gray-300">{value.toFixed(2)}</span>
      {diff != null && (
        <span className={diff >= 0 ? 'text-green-400' : 'text-red-400'}>
          {diff >= 0 ? '+' : ''}{diff.toFixed(1)}%
        </span>
      )}
      {above !== null && above !== undefined && (
        <span className={above ? 'text-green-400' : 'text-red-400'}>{above ? '▲ above' : '▼ below'}</span>
      )}
    </div>
  )
}

function ExpandedRow({ inst, atrMultiplier }: { inst: any; atrMultiplier: number }) {
  const lastPrice = inst.closes?.length > 0 ? inst.closes[inst.closes.length - 1] : undefined
  return (
    <div className="text-[11px] text-muted grid grid-cols-3 gap-4">
      {/* Instrument Details */}
      <div>
        <div className="text-gray-400 font-semibold mb-1">Instrument</div>
        <div>ISIN: <span className="text-gray-300">{inst.isin}</span></div>
        {inst.wkn && <div>WKN: <span className="text-gray-300">{inst.wkn}</span></div>}
        {inst.mnemonic && <div>Mnemonic: <span className="text-gray-300">{inst.mnemonic}</span></div>}
        {inst.yahooTicker && <div>Yahoo: <span className="text-gray-300">{inst.yahooTicker}</span></div>}
        {inst.xetraGroup && <div>Group: <span className="text-gray-300">{inst.xetraGroup}</span></div>}
        {inst.longName && <div>OpenFIGI: <span className="text-gray-300">{inst.longName}</span></div>}
        {lastPrice != null && <div className="mt-1">Last Price: <span className="text-gray-300">{lastPrice.toFixed(2)}</span></div>}
      </div>

      {/* Moving Averages */}
      <div>
        <div className="text-gray-400 font-semibold mb-1">Moving Averages</div>
        {(inst.ma10 == null && inst.ma50 == null && inst.ma100 == null && inst.ma200 == null) ? (
          <div className="text-muted">No price data</div>
        ) : (
          <>
            <MARow label="MA10"  value={inst.ma10}  above={inst.aboveMa10}  lastPrice={lastPrice} />
            <MARow label="MA50"  value={inst.ma50}  above={inst.aboveMa50}  lastPrice={lastPrice} />
            <MARow label="MA100" value={inst.ma100} above={inst.aboveMa100} lastPrice={lastPrice} />
            <MARow label="MA200" value={inst.ma200} above={inst.aboveMa200} lastPrice={lastPrice} />
          </>
        )}
        {inst.atr20 != null && (
          <div className="mt-2">
            <div>ATR(20): <span className="text-gray-300">{inst.atr20.toFixed(4)}</span></div>
            <div>Stop ({atrMultiplier}× ATR): <span className="text-amber-400">{inst.sellingThreshold?.toFixed(2) ?? '—'}</span></div>
          </div>
        )}
      </div>

      {/* Data Status */}
      <div>
        <div className="text-gray-400 font-semibold mb-1">Data Status</div>
        <div>Prices: <span className={inst.priceFetched ? 'text-green-400' : 'text-muted'}>
          {inst.priceFetched ? `✓ ${inst.closes?.length || 0} days` : 'not loaded'}
        </span></div>
        <div>Fundamentals: <span className={inst.fundamentalsFetched ? 'text-green-400' : 'text-muted'}>
          {inst.fundamentalsFetched ? '✓' : 'not loaded'}
        </span></div>
        {(inst.type === 'ETF' || inst.type === 'ETC') && (
          <div>AUM data: <span className={inst.justEtfFetched ? 'text-green-400' : 'text-muted'}>
            {inst.justEtfFetched ? '✓' : 'not loaded'}{inst.justEtfError && ` (${inst.justEtfError})`}
          </span></div>
        )}
        {inst.valueScoreModel && <div>Value model: <span className="text-amber-400">{inst.valueScoreModel}</span></div>}
        {inst.dedupGroup && <div className="mt-1">Dedup: <span className="text-gray-300 text-[10px]">{inst.dedupGroup.substring(0, 50)}</span></div>}
        {inst.priceError && <div className="text-red-400 mt-1">Error: {inst.priceError}</div>}
      </div>
    </div>
  )
}
