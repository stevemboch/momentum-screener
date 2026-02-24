import { useState } from 'react'
import { useAppState, useDisplayedInstruments } from '../store'
import type { SortColumn } from '../types'
import {
  fmtAUM, fmtTER, fmtPct, fmtRatio, fmtScore, fmtVola, fmtPE, fmtEY, returnColor, scoreColor
} from '../utils/formatters'

type Col = { key: SortColumn | string; label: string; title?: string; align?: 'right' | 'left' }

const COLUMNS: Col[] = [
  { key: 'displayName', label: 'Name', align: 'left' },
  { key: 'type', label: 'Type', align: 'left' },
  { key: 'momentumScore', label: 'Momentum', title: 'Weighted return score (rank in brackets)' },
  { key: 'sharpeScore', label: 'Sharpe', title: 'Momentum score ÷ annualised volatility (rank in brackets)' },
  { key: 'r1m', label: '1M', title: '1-month return' },
  { key: 'r3m', label: '3M', title: '3-month return' },
  { key: 'r6m', label: '6M', title: '6-month return' },
  { key: 'vola', label: 'Vola', title: 'Annualised 6-month volatility' },
  { key: 'aum', label: 'AUM', title: 'Assets under management (justETF)' },
  { key: 'ter', label: 'TER', title: 'Total expense ratio (justETF)' },
  { key: 'pe', label: 'P/E', title: 'Price / Earnings (Yahoo Finance)' },
  { key: 'pb', label: 'P/B', title: 'Price / Book (Yahoo Finance)' },
  { key: 'earningsYield', label: 'EY', title: 'Earnings Yield = 1/PE' },
  { key: 'valueScore', label: 'Value', title: 'ETFs: P/E + P/B rank sum. Stocks: Greenblatt Magic Formula. Lower = better value.' },
]

export function RankingTable() {
  const { state, dispatch } = useAppState()
  const instruments = useDisplayedInstruments()
  const { sortColumn, sortDirection } = state.tableState
  const [expandedISIN, setExpandedISIN] = useState<string | null>(null)

  const handleSort = (col: string) => {
    if (col === 'displayName' || col === 'type') return
    const newCol = col as SortColumn
    if (sortColumn === newCol) {
      dispatch({ type: 'SET_TABLE_STATE', updates: { sortDirection: sortDirection === 'desc' ? 'asc' : 'desc' } })
    } else {
      dispatch({ type: 'SET_TABLE_STATE', updates: { sortColumn: newCol, sortDirection: 'desc' } })
    }
  }

  const sortIcon = (col: string) => {
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
      <table className="w-full text-xs font-mono border-collapse min-w-[1200px]">
        <thead className="sticky top-0 z-10 bg-surface border-b border-border">
          <tr>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                title={col.title}
                onClick={() => handleSort(col.key)}
                className={`
                  px-3 py-2 font-semibold text-muted whitespace-nowrap
                  ${col.align === 'left' ? 'text-left' : 'text-right'}
                  ${col.key !== 'displayName' && col.key !== 'type' ? 'cursor-pointer hover:text-gray-300' : ''}
                  select-none
                `}
              >
                {col.label}{col.key !== 'displayName' && col.key !== 'type' ? sortIcon(col.key) : ''}
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
                  <td className="px-3 py-2 text-left max-w-[240px]">
                    <div className="truncate text-gray-200" title={inst.displayName}>
                      {inst.displayName}
                    </div>
                    <div className="text-muted text-[10px] mt-0.5">
                      {inst.isin}
                      {inst.currency && ` · ${inst.currency}`}
                    </div>
                  </td>

                  {/* Type */}
                  <td className="px-3 py-2 text-left">
                    <TypeBadge type={inst.type} />
                  </td>

                  {/* Momentum */}
                  <td className="px-3 py-2 text-right">
                    <span className={scoreColor(inst.momentumScore)}>
                      {fmtScore(inst.momentumScore, inst.momentumRank)}
                    </span>
                  </td>

                  {/* Sharpe */}
                  <td className="px-3 py-2 text-right">
                    <span className={scoreColor(inst.sharpeScore)}>
                      {fmtScore(inst.sharpeScore, inst.sharpeRank)}
                    </span>
                  </td>

                  {/* Returns */}
                  <td className={`px-3 py-2 text-right ${returnColor(inst.r1m)}`}>{fmtPct(inst.r1m)}</td>
                  <td className={`px-3 py-2 text-right ${returnColor(inst.r3m)}`}>{fmtPct(inst.r3m)}</td>
                  <td className={`px-3 py-2 text-right ${returnColor(inst.r6m)}`}>{fmtPct(inst.r6m)}</td>

                  {/* Vola */}
                  <td className="px-3 py-2 text-right text-muted">{fmtVola(inst.vola)}</td>

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

                  {/* Earnings Yield */}
                  <td className="px-3 py-2 text-right text-gray-300">
                    {inst.earningsYield != null ? fmtEY(inst.earningsYield) : (inst.fundamentalsFetched ? '—' : '')}
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

                {/* Expanded row */}
                {isExpanded && (
                  <tr key={`${inst.isin}-exp`} className={`${rowBg} border-b border-border`}>
                    <td colSpan={COLUMNS.length} className="px-4 py-3">
                      <ExpandedRow inst={inst} />
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

function ExpandedRow({ inst }: { inst: any }) {
  return (
    <div className="text-[11px] text-muted grid grid-cols-2 gap-4">
      <div>
        <div className="text-gray-400 font-semibold mb-1">Instrument Details</div>
        <div>ISIN: <span className="text-gray-300">{inst.isin}</span></div>
        {inst.wkn && <div>WKN: <span className="text-gray-300">{inst.wkn}</span></div>}
        {inst.mnemonic && <div>Mnemonic: <span className="text-gray-300">{inst.mnemonic}</span></div>}
        {inst.yahooTicker && <div>Yahoo Ticker: <span className="text-gray-300">{inst.yahooTicker}</span></div>}
        {inst.xetraGroup && <div>Group: <span className="text-gray-300">{inst.xetraGroup}</span></div>}
        {inst.longName && <div>OpenFIGI Name: <span className="text-gray-300">{inst.longName}</span></div>}
      </div>
      <div>
        <div className="text-gray-400 font-semibold mb-1">Data Status</div>
        <div>Price data: <span className={inst.priceFetched ? 'text-green-400' : 'text-muted'}>
          {inst.priceFetched ? `✓ ${inst.closes?.length || 0} days` : 'not loaded'}
        </span></div>
        <div>Fundamentals: <span className={inst.fundamentalsFetched ? 'text-green-400' : 'text-muted'}>
          {inst.fundamentalsFetched ? '✓' : 'not loaded'}
        </span></div>
        {(inst.type === 'ETF' || inst.type === 'ETC') && (
          <div>justETF: <span className={inst.justEtfFetched ? 'text-green-400' : 'text-muted'}>
            {inst.justEtfFetched ? '✓' : 'not loaded'}
            {inst.justEtfError && ` (${inst.justEtfError})`}
          </span></div>
        )}
        {inst.valueScoreModel && (
          <div>Value model: <span className="text-amber-400">{inst.valueScoreModel}</span></div>
        )}
        {inst.dedupGroup && (
          <div>Dedup group: <span className="text-gray-300 text-[10px]">{inst.dedupGroup.substring(0, 60)}</span></div>
        )}
        {inst.priceError && <div className="text-red-400">Error: {inst.priceError}</div>}
      </div>
    </div>
  )
}
