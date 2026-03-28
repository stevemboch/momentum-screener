import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useAppState, useDisplayedInstruments } from '../store'
import { usePipeline } from '../hooks/usePipeline'
import { useInstrumentContext } from '../hooks/useInstrumentContext'
import type { ColumnGroup, SortColumn, Instrument } from '../types'
import { StatusBadge } from './ui/StatusBadge'
import {
  fmtAUM, fmtTER, fmtPct, fmtRatio, fmtVola, fmtPE, returnColor, scoreColor, rsiColor
} from '../utils/formatters'
import { generateTfaSummary } from '../utils/tfaSummary'

type Col = { key: string; label: string; title?: string; align?: 'right' | 'left' }
type ViewPreset = 'scan' | 'detail' | 'risk'
type StickyColumnKey = 'displayName' | 'combinedScore' | 'tfaPhase'

const CORE_STICKY_COLUMNS: StickyColumnKey[] = ['displayName', 'combinedScore', 'tfaPhase']
const STICKY_COLUMN_LEFT: Record<StickyColumnKey, number> = {
  displayName: 0,
  combinedScore: 320,
  tfaPhase: 430,
}
const STICKY_COLUMN_WIDTH_CLASS: Record<StickyColumnKey, string> = {
  displayName: 'min-w-[320px] max-w-[320px]',
  combinedScore: 'min-w-[110px]',
  tfaPhase: 'min-w-[140px]',
}
const ROW_CONTEXT_TTL = 6 * 60 * 60 * 1000

const VIEW_PRESET_CONFIG: Record<ViewPreset, { label: string; sortColumn: SortColumn; sortDirection: 'asc' | 'desc'; hiddenGroups: ColumnGroup[] }> = {
  scan: {
    label: 'Scan',
    sortColumn: 'combinedScore',
    sortDirection: 'desc',
    hiddenGroups: ['fundamentals', 'breakout', 'pullback', 'tfa'],
  },
  detail: {
    label: 'Detail',
    sortColumn: 'riskAdjustedScore',
    sortDirection: 'desc',
    hiddenGroups: [],
  },
  risk: {
    label: 'Risk',
    sortColumn: 'vola',
    sortDirection: 'asc',
    hiddenGroups: ['breakout', 'pullback'],
  },
}

const COLUMNS: Col[] = [
  { key: 'displayName',   label: 'Name',     align: 'left' },
  { key: 'riskAdjustedScore', label: 'Risk-Adj.', title: 'Momentum ÷ annualized volatility (rank)' },
  { key: 'momentumScore', label: 'Momentum', title: 'Weighted return score (rank)' },
  { key: 'combinedScore', label: 'Combined', title: 'Average of Momentum + Sharpe score (rank)' },
  { key: 'ma',            label: 'MA 10/50/100/200', title: '10/50/100/200 MA flags (green above, red below)', align: 'right' },
  { key: 'sellingThreshold', label: 'Stop',  title: 'Selling Threshold = Last Price − a × ATR(20)' },
  { key: 'r1m',           label: '1M',       title: '1-month return' },
  { key: 'r3m',           label: '3M',       title: '3-month return' },
  { key: 'r6m',           label: '6M',       title: '6-month return' },
  { key: 'vola',          label: 'Vola',     title: 'Annualised 6M volatility' },
  { key: 'rsi14',         label: 'RSI',      title: 'RSI(14)' },
  { key: 'aum',           label: 'AUM',      title: 'Assets under management' },
  { key: 'ter',           label: 'TER',      title: 'Total expense ratio' },
  { key: 'pe',            label: 'P/E',      title: 'Price / Earnings' },
  { key: 'pb',            label: 'P/B',      title: 'Price / Book' },
  { key: 'earningsYield', label: 'EY',       title: 'Earnings Yield (rank)' },
  { key: 'returnOnAssets', label: 'ROA',     title: 'Return on Assets — Net income / total assets (rank)' },
  { key: 'drawFromHigh',  label: '52W',      title: '% below 52-week high' },
  { key: 'drawFrom5YHigh', label: '5Y',      title: '% below 5-year high (weekly)' },
  { key: 'drawFrom7YHigh', label: '7Y',      title: '% below 7-year high (capped ATH)' },
  { key: 'levyRS',        label: 'Levy',     title: 'Levy RS (price / 26-week MA)' },
  { key: 'weeklyRsi14',   label: 'RSI(W)',   title: 'RSI(14) weekly' },
  { key: 'weeklyVolaRatio', label: 'VolaR',  title: 'Volatility ratio 3M/1Y weekly (< 0.7 = compression)' },
  { key: 'tfaTScore',     label: 'T-Score',  title: 'TFA technical score (0–1)' },
  { key: 'tfaFScore',     label: 'F-Score',  title: 'TFA fundamental score (0–1)' },
  { key: 'tfaTScore5Y',   label: 'T5Y',     title: 'TFA T-score 5Y/7Y (0–1)' },
  { key: 'tfaFScore5Y',   label: 'F5Y',     title: 'TFA F-score 5Y/7Y relaxed (0–1)' },
  { key: 'tfaScore',      label: 'TFA ⭐',   title: 'TFA total score (0–1)' },
  { key: 'tfaPhase',      label: 'TFA Status', title: 'TFA Pipeline Status' },
  { key: 'tfaCrossoverDaysAgo', label: 'Cross', title: 'Days since MA crossover' },
  { key: 'breakoutScore', label: 'Breakout Score', title: '0–5 points' },
  { key: 'breakoutAgeDays', label: 'Breakout Age', title: 'Days since breakout' },
  { key: 'pullbackScore',  label: '↩ Score',  title: 'Pullback score 0–1 (stocks above MA200 with positive 3M return)' },
  { key: 'pullbackStop',   label: 'PB Stop',  title: 'Stop-loss: previous low − 0.5×ATR' },
  { key: 'pullbackTarget', label: 'PB Target',  title: 'Target: entry + 1.5× risk' },
]

const COLUMN_GROUPS: Record<ColumnGroup, string[]> = {
  scores:       ['riskAdjustedScore', 'momentumScore', 'combinedScore'],
  returns:      ['r1m', 'r3m', 'r6m', 'vola'],
  technical:    ['ma', 'sellingThreshold'],
  fundamentals: ['aum', 'ter', 'pe', 'pb', 'earningsYield', 'returnOnAssets'],
  tfa:          [
    'drawFromHigh', 'rsi14', 'levyRS', 'tfaTScore', 'tfaFScore', 'tfaScore', 'tfaPhase',
    'tfaCrossoverDaysAgo',
    'drawFrom5YHigh', 'drawFrom7YHigh', 'weeklyRsi14', 'weeklyVolaRatio', 'tfaTScore5Y', 'tfaFScore5Y',
  ],
  breakout:     ['breakoutScore', 'breakoutAgeDays'],
  pullback:     ['pullbackScore', 'pullbackStop', 'pullbackTarget'],
}

const NON_SORTABLE = new Set(['displayName', 'ma', 'breakoutAgeDays', 'tfaPhase'])

// ─── Sub-components ───────────────────────────────────────────────────────────

function MaFlag({ above, label }: { above: boolean | null | undefined; label: string }) {
  const base = 'inline-flex w-2.5 h-2.5 rounded-full border shadow-sm'
  const color = above === null || above === undefined
    ? '#2a3045'
    : (above ? '#4ade80' : '#f87171')
  const borderColor = above === null || above === undefined
    ? '#2a3045'
    : 'rgba(255,255,255,0.45)'
  if (above === null || above === undefined) {
    return (
      <span
        className={base}
        style={{ backgroundColor: color, borderColor }}
        title={`${label}: no data`}
      />
    )
  }
  return (
    <span
      className={base}
      style={{ backgroundColor: color, borderColor }}
      title={`${label}: ${above ? 'above' : 'below'}`}
    />
  )
}

function MaCell({ inst }: { inst: any }) {
  return (
    <div className="flex items-center justify-end gap-[4px]">
      <MaFlag above={inst.aboveMa10} label="MA10" />
      <MaFlag above={inst.aboveMa50} label="MA50" />
      <MaFlag above={inst.aboveMa100} label="MA100" />
      <MaFlag above={inst.aboveMa200} label="MA200" />
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

function openIsinSearch(isin: string) {
  if (!isin || typeof window === 'undefined') return
  const query = encodeURIComponent(isin)
  window.open(`https://www.google.com/search?q=${query}`, '_blank', 'noopener,noreferrer')
}

function ScoreCell({ score, rank, colorFn }: { score: number | null | undefined; rank: number | undefined; colorFn?: (v: any) => string }) {
  if (score == null) return <span className="text-muted">—</span>
  const color = colorFn ? colorFn(score) : scoreColor(score)
  return (
    <span className={color}>
      {score.toFixed(2)}
      {rank !== undefined && (
        <span className="text-gray-400 text-[10px] ml-1">#{rank}</span>
      )}
    </span>
  )
}

function TfaScoreCell({ score, ko }: { score: number | null | undefined; ko?: boolean }) {
  if (score == null && !ko) return <span className="text-muted">—</span>
  const cls = score != null && score >= 0.8
    ? 'text-yellow-300 font-bold'
    : score != null && score >= 0.65
      ? 'text-green-400'
      : 'text-muted'
  return (
    <span className={cls}>
      {score != null ? score.toFixed(2) : '—'}
      {ko && ' ⛔'}
    </span>
  )
}

function PullbackScoreCell({ score }: { score: number | null | undefined }) {
  if (score == null) return <span className="text-muted">—</span>
  const color = score >= 0.7 ? 'text-green-400 font-semibold'
    : score >= 0.5 ? 'text-yellow-400'
    : score >= 0.3 ? 'text-orange-400'
    : 'text-muted'
  return <span className={color}>{score.toFixed(2)}</span>
}

function SignalValue({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-muted">—</span>
  const cls = value >= 1 ? 'text-green-400' : value >= 0.5 ? 'text-amber-300' : 'text-red-400'
  const label = Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)
  return <span className={cls}>{label}</span>
}

function nearestMADistance(inst: Instrument): { ma: string; pct: number } | null {
  const last = inst.closes?.[inst.closes.length - 1]
  if (!last) return null
  const candidates = [
    { ma: 'MA50', val: inst.ma50 },
    { ma: 'MA100', val: inst.ma100 },
    { ma: 'MA200', val: inst.ma200 },
  ].filter((c) => c.val != null && last < (c.val as number))
  if (candidates.length === 0) return null
  const nearest = candidates.reduce((a, b) =>
    Math.abs((a.val as number) - last) < Math.abs((b.val as number) - last) ? a : b
  )
  return { ma: nearest.ma, pct: ((nearest.val as number) - last) / last }
}

function TfaPhaseBadge({
  phase,
  reason,
  summary,
  inst,
}: {
  phase: string | null | undefined
  reason?: string
  summary?: string
  inst?: Instrument | null
}) {
  const tooltip = summary ?? reason
  switch (phase) {
    case 'monitoring': {
      const dist = inst ? nearestMADistance(inst) : null
      return (
        <span
          className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-gray-400/10 text-gray-400 border border-gray-400/20"
          title={tooltip}
          style={{ cursor: 'help' }}
        >
          👁 Monitoring
          {dist != null && (
            <span className="ml-1 text-gray-500">
              {dist.ma} +{(dist.pct * 100).toFixed(1)}%
            </span>
          )}
        </span>
      )
    }
    case 'above_all_mas':
      return (
        <span
          className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-blue-400/10 text-blue-400 border border-blue-400/20"
          title={tooltip}
          style={{ cursor: 'help' }}
        >
          🚀 Breakout
        </span>
      )
    case 'watch':
      return (
        <span
          className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-yellow-400/10 text-yellow-400 border border-yellow-400/20"
          title={tooltip}
          style={{ cursor: 'help' }}
        >
          ⚡ Watch
        </span>
      )
    case 'fetching':
      return (
        <span
          className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-blue-400/10 text-blue-300 border border-blue-400/20"
          title={tooltip}
        >
          ⏳ Analyzing...
        </span>
      )
    case 'qualified':
      return (
        <span
          className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-green-400/10 text-green-400 border border-green-400/20"
          title={tooltip}
          style={{ cursor: 'help' }}
        >
          ✓ Qualifiziert
        </span>
      )
    case 'rejected':
      return (
        <span
          className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-red-400/10 text-red-400 border border-red-400/20"
          title={tooltip}
        >
          ✗ Rejected
        </span>
      )
    case 'ko':
      return (
        <span
          className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-red-500/10 text-red-500 border border-red-500/20"
          title={tooltip}
        >
          ⛔ KO
        </span>
      )
    default:
      return <span className="text-muted" title={tooltip}>—</span>
  }
}

function fmtPrice(v: number | null | undefined): string {
  if (v == null) return '—'
  return v.toFixed(2)
}

function MetricCell({ value, rank, fmt }: { value: number | null | undefined; rank?: number; fmt: (v: number) => string }) {
  if (value == null) return <span className="text-muted">—</span>
  return (
    <span className="text-gray-300">
      {fmt(value)}
      {rank !== undefined && (
        <span className="text-gray-400 text-[10px] ml-1">#{rank}</span>
      )}
    </span>
  )
}

function fmtDate(ts: number | null | undefined): string {
  if (!ts) return '—'
  try {
  return new Date(ts * 1000).toLocaleDateString('en-GB')
  } catch {
    return '—'
  }
}

function fmtAge(days: number | null | undefined): string {
  if (days == null) return '—'
  return `${days}d`
}

function bankruptcyRiskLabel(level: 'low' | 'medium' | 'high' | null | undefined): string {
  if (!level) return 'N/A'
  return level.toUpperCase()
}

function financialHealthLabel(status: 'healthy' | 'watch' | 'stressed' | null | undefined): string {
  if (!status) return 'N/A'
  return status.toUpperCase()
}

type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'muted'

function bankruptcyRiskTone(level: 'low' | 'medium' | 'high' | null | undefined): BadgeTone {
  if (level === 'low') return 'success'
  if (level === 'medium') return 'warning'
  if (level === 'high') return 'danger'
  return 'muted'
}

function financialHealthTone(status: 'healthy' | 'watch' | 'stressed' | null | undefined): BadgeTone {
  if (status === 'healthy') return 'success'
  if (status === 'watch') return 'warning'
  if (status === 'stressed') return 'danger'
  return 'muted'
}

function dataQualityTone(quality: 'high' | 'medium' | 'low' | null | undefined): BadgeTone {
  if (quality === 'high') return 'success'
  if (quality === 'medium') return 'warning'
  if (quality === 'low') return 'danger'
  return 'muted'
}

function pullbackScoreTone(score: number | null | undefined): BadgeTone {
  if (score == null) return 'muted'
  if (score >= 0.7) return 'success'
  if (score >= 0.5) return 'warning'
  if (score >= 0.3) return 'info'
  return 'muted'
}

function isStickyColumnKey(key: string): key is StickyColumnKey {
  return CORE_STICKY_COLUMNS.includes(key as StickyColumnKey)
}

function stickyColumnStyle(key: string): React.CSSProperties | undefined {
  if (!isStickyColumnKey(key)) return undefined
  return { left: STICKY_COLUMN_LEFT[key] }
}

function stickyWidthClass(key: string): string {
  if (!isStickyColumnKey(key)) return ''
  return STICKY_COLUMN_WIDTH_CLASS[key]
}

type RowContextPreview = {
  financialHealthStatus: 'healthy' | 'watch' | 'stressed' | null
  bankruptcyRiskLevel: 'low' | 'medium' | 'high' | null
  newsCount: number
  asOf: string | null
  fetchedAt: number | null
}

function parseDateSafe(value: string | null | undefined): number | null {
  if (!value) return null
  const ts = Date.parse(value)
  return Number.isFinite(ts) ? ts : null
}

function asOfTone(asOf: string | null, fetchedAt: number | null): BadgeTone {
  const ts = parseDateSafe(asOf) ?? fetchedAt
  if (ts == null) return 'muted'
  if (Date.now() - ts > ROW_CONTEXT_TTL) return 'warning'
  return 'info'
}

function formatAsOfLabel(asOf: string | null, fetchedAt: number | null): string {
  const ts = parseDateSafe(asOf) ?? fetchedAt
  if (ts == null) return 'n/a'
  return new Date(ts).toLocaleDateString('en-GB')
}

function readRowContextPreview(isin: string): RowContextPreview | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(`cache:context:${isin}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const healthRaw = parsed?.financialHealth?.status
    const bankruptcyRaw = parsed?.bankruptcyRisk?.level
    const asOfRaw = typeof parsed?.asOf === 'string' && parsed.asOf.trim().length > 0 ? parsed.asOf.trim() : null
    const fetchedAtRaw = typeof parsed?.fetchedAt === 'number' && Number.isFinite(parsed.fetchedAt) ? parsed.fetchedAt : null
    const newsCount = Array.isArray(parsed?.news) ? parsed.news.length : 0
    return {
      financialHealthStatus: healthRaw === 'healthy' || healthRaw === 'watch' || healthRaw === 'stressed' ? healthRaw : null,
      bankruptcyRiskLevel: bankruptcyRaw === 'low' || bankruptcyRaw === 'medium' || bankruptcyRaw === 'high' ? bankruptcyRaw : null,
      newsCount,
      asOf: asOfRaw,
      fetchedAt: fetchedAtRaw,
    }
  } catch {
    return null
  }
}

function evidenceConfidenceClass(confidence: 'high' | 'medium' | 'low' | undefined): string {
  if (confidence === 'high') return 'border-green-400/30 text-green-300 bg-green-400/5'
  if (confidence === 'medium') return 'border-amber-400/30 text-amber-300 bg-amber-400/5'
  return 'border-border text-gray-400 bg-surface2/40'
}

function ContextAccordionSection({
  title,
  isOpen,
  onToggle,
  badges,
  children,
}: {
  title: string
  isOpen: boolean
  onToggle: () => void
  badges?: React.ReactNode[]
  children: React.ReactNode
}) {
  return (
    <section className="panel-shell min-w-0">
      <button
        type="button"
        onClick={onToggle}
        className="focus-ring panel-header w-full text-left hover:bg-surface2/40 transition-colors"
        aria-expanded={isOpen}
      >
        <span className="inline-flex items-center gap-1.5 min-w-0">
          <span className="text-muted shrink-0 text-[11px]">{isOpen ? '▾' : '▸'}</span>
          <span className="panel-title normal-case tracking-normal text-gray-200 truncate">{title}</span>
        </span>
        {!!badges?.length && (
          <span className="flex items-center gap-1 flex-wrap justify-end">
            {badges}
          </span>
        )}
      </button>
      {isOpen && (
        <div className="p-2.5 space-y-1 min-w-0">
          {children}
        </div>
      )}
    </section>
  )
}

function RowSummaryChips({ preview }: { preview: RowContextPreview | null }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      <StatusBadge tone={financialHealthTone(preview?.financialHealthStatus)}>
        FH: {financialHealthLabel(preview?.financialHealthStatus)}
      </StatusBadge>
      <StatusBadge tone={bankruptcyRiskTone(preview?.bankruptcyRiskLevel)}>
        BK: {bankruptcyRiskLabel(preview?.bankruptcyRiskLevel)}
      </StatusBadge>
      <StatusBadge tone={(preview?.newsCount ?? 0) > 0 ? 'info' : 'muted'}>
        News: {preview?.newsCount ?? 0}
      </StatusBadge>
      <StatusBadge tone={asOfTone(preview?.asOf ?? null, preview?.fetchedAt ?? null)}>
        As-of: {formatAsOfLabel(preview?.asOf ?? null, preview?.fetchedAt ?? null)}
      </StatusBadge>
    </div>
  )
}

function BreakoutBadge({
  score,
  flags,
}: {
  score: number | null | undefined
  flags?: {
    ma200Rising?: boolean
    goldenCross?: boolean
    relStrength?: boolean
    volumeConfirm?: boolean
    retest?: boolean
  }
}) {
  if (score == null) return <span className="text-muted">—</span>
  const tooltip = flags ? [
    `${flags.ma200Rising ? '✅' : '❌'} MA200 rising`,
    `${flags.goldenCross ? '✅' : '❌'} Golden Cross`,
    `${flags.relStrength ? '✅' : '❌'} Rel. strength vs MSCI World`,
    `${flags.volumeConfirm ? '✅' : '❌'} Volume confirmed`,
    `${flags.retest ? '✅' : '❌'} Retest successful`,
  ].join(' · ') : undefined
  const base = 'text-[10px] px-1.5 py-0.5 rounded font-semibold'
  if (score <= 2) return <span className={`${base} text-gray-300 bg-surface2`} title={tooltip}>{score}</span>
  if (score === 3) return <span className={`${base} text-amber-300 bg-amber-400/10`} title={tooltip}>{score}</span>
  if (score === 4) return <span className={`${base} text-green-400 bg-green-400/10`} title={tooltip}>{score}</span>
  return <span className={`${base} text-green-200 bg-green-500/20`} title={tooltip}>5 ✅</span>
}

// ─── MARow for expanded detail ────────────────────────────────────────────────

function MARow({ label, value, above, lastPrice }: { label: string; value: number | null | undefined; above: boolean | null | undefined; lastPrice: number | undefined }) {
  const numericValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numericValue)) return null
  const diff = lastPrice != null ? ((lastPrice - numericValue) / numericValue * 100) : null
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted w-12">{label}:</span>
      <span className="text-gray-300">{numericValue.toFixed(2)}</span>
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

function Sparkline({ closes }: { closes: number[] | undefined }) {
  if (!closes || closes.length < 5) return null

  // Letzten 21 Tage (ca. 1 Monat Handelstage)
  const slice = closes
    .map((v) => (typeof v === 'number' ? v : Number(v)))
    .filter((v) => Number.isFinite(v))
    .slice(-21)
  if (slice.length < 5) return null
  const n = slice.length
  const min = Math.min(...slice)
  const max = Math.max(...slice)
  const range = max - min

  // Wenn kaum Bewegung: trotzdem zeigen (flache Linie)
  const norm = (v: number) =>
    range === 0 ? 10 : 18 - ((v - min) / range) * 16 // Y: 2..18 (SVG top=0)

  const w = 60
  const h = 20

  // Polyline-Punkte
  const points = slice
    .map((v, i) => `${(i / (n - 1)) * (w - 2) + 1},${norm(v).toFixed(1)}`)
    .join(' ')

  // Farbe: grün wenn End > Start, rot wenn gefallen
  const isUp = slice[n - 1] >= slice[0]
  const color = isUp ? '#4ade80' : '#f87171'
  const fillColor = isUp ? '#4ade8018' : '#f8717118'

  // Fill-Polygon: Linie + runter zur Basis + zurück
  const fillPoints = [
    ...slice.map((v, i) => `${(i / (n - 1)) * (w - 2) + 1},${norm(v).toFixed(1)}`),
    `${w - 1},${h - 1}`,
    `1,${h - 1}`,
  ].join(' ')

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="shrink-0 opacity-70 group-hover:opacity-100 transition-opacity"
    >
      <title>{`1M: ${slice[0].toFixed(2)} -> ${slice[n - 1].toFixed(2)}`}</title>
      {/* Fill unter der Linie */}
      <polygon points={fillPoints} fill={fillColor} />
      {/* Linie */}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Letzter Punkt als Dot */}
      <circle
        cx={(w - 2).toFixed(1)}
        cy={norm(slice[n - 1]).toFixed(1)}
        r="1.5"
        fill={color}
      />
    </svg>
  )
}

// ─── Candidate row (non-winner ETFs in dedup group) ──────────────────────────

function CandidateRow({
  candidate,
  onLoad,
  hiddenKeys,
  colCount,
}: {
  candidate: any
  onLoad: (isin: string) => void
  hiddenKeys: Set<string>
  colCount: number
}) {
  const [loading, setLoading] = useState(false)
  const hasPrices = candidate.priceFetched
  const nameColSpan = Math.max(1, Math.min(colCount, 1))

  const handleLoad = async () => {
    setLoading(true)
    await onLoad(candidate.isin)
    setLoading(false)
  }

  return (
    <tr className="border-t border-border/20 bg-surface2/40 text-[11px] font-mono">
      {/* Name */}
      <td
        className={`px-2 py-1.5 text-left sticky z-[3] left-0 bg-surface2/40 border-r border-border/40 ${stickyWidthClass('displayName')}`}
        style={stickyColumnStyle('displayName')}
        colSpan={nameColSpan}
      >
        <div className="truncate text-gray-400 max-w-[240px]" title={candidate.displayName}>
          {candidate.displayName}
        </div>
        <div className="text-muted text-[10px] flex items-center gap-1.5">
          <TypeBadge type={candidate.type} />
          <span>
            <span
              className="cursor-pointer hover:text-gray-200"
              title="Double-click to search ISIN"
              onDoubleClick={(e) => { e.stopPropagation(); openIsinSearch(candidate.isin) }}
            >
              {candidate.isin}
            </span>
            {candidate.currency && ` · ${candidate.currency}`}
            {candidate.aum != null && ` · ${fmtAUM(candidate.aum)}`}
            {candidate.ter != null && ` · ${fmtTER(candidate.ter)}`}
          </span>
        </div>
      </td>
      {!hiddenKeys.has('riskAdjustedScore') && (
        <td className="px-2 py-1.5 text-right">
          <ScoreCell score={candidate.riskAdjustedScore} rank={candidate.riskAdjustedRank} />
        </td>
      )}
      {!hiddenKeys.has('momentumScore') && (
        <td className="px-2 py-1.5 text-right">
          <ScoreCell score={candidate.momentumScore} rank={candidate.momentumRank} />
        </td>
      )}
      {!hiddenKeys.has('combinedScore') && (
        <td
          className={`px-2 py-1.5 text-right sticky z-[2] bg-surface2/40 border-r border-border/40 ${stickyWidthClass('combinedScore')}`}
          style={stickyColumnStyle('combinedScore')}
        >
          <ScoreCell score={candidate.combinedScore} rank={candidate.combinedRank} />
        </td>
      )}
      {!hiddenKeys.has('ma') && (
        <td className="px-2 py-1.5 text-right text-muted">—</td>
      )}
      {!hiddenKeys.has('sellingThreshold') && (
        <td className="px-2 py-1.5 text-right text-muted">—</td>
      )}
      {!hiddenKeys.has('r1m') && (
        <td className={`px-2 py-1.5 text-right ${returnColor(candidate.r1m)}`}>{fmtPct(candidate.r1m)}</td>
      )}
      {!hiddenKeys.has('r3m') && (
        <td className={`px-2 py-1.5 text-right ${returnColor(candidate.r3m)}`}>{fmtPct(candidate.r3m)}</td>
      )}
      {!hiddenKeys.has('r6m') && (
        <td className={`px-2 py-1.5 text-right ${returnColor(candidate.r6m)}`}>{fmtPct(candidate.r6m)}</td>
      )}
      {!hiddenKeys.has('vola') && (
        <td className="px-2 py-1.5 text-right text-muted">{fmtVola(candidate.vola)}</td>
      )}
      {!hiddenKeys.has('rsi14') && (
        <td className={`px-2 py-1.5 text-right ${rsiColor(candidate.rsi14)}`}>
          {candidate.rsi14 != null ? candidate.rsi14.toFixed(1) : '—'}
        </td>
      )}
      {!hiddenKeys.has('aum') && (
        <td className="px-2 py-1.5 text-right text-gray-400">{candidate.aum != null ? fmtAUM(candidate.aum) : '—'}</td>
      )}
      {!hiddenKeys.has('ter') && (
        <td className="px-2 py-1.5 text-right text-gray-400">{candidate.ter != null ? fmtTER(candidate.ter) : '—'}</td>
      )}
      {!hiddenKeys.has('pe') && (
        <td className="px-2 py-1.5 text-right text-gray-400">{candidate.pe != null ? fmtPE(candidate.pe) : '—'}</td>
      )}
      {!hiddenKeys.has('pb') && (
        <td className="px-2 py-1.5 text-right text-gray-400">{candidate.pb != null ? fmtRatio(candidate.pb) : '—'}</td>
      )}
      {!hiddenKeys.has('earningsYield') && (
        <td className="px-2 py-1.5 text-right text-gray-300">
          <MetricCell value={candidate.earningsYield} rank={candidate.earningsYieldRank} fmt={(v) => fmtPct(v)} />
        </td>
      )}
      {!hiddenKeys.has('returnOnAssets') && (
        <td className="px-2 py-1.5 text-right text-gray-300">
          {!hasPrices ? (
            <button
              type="button"
              onClick={handleLoad}
              disabled={loading}
              className="btn btn-sm btn-secondary focus-ring disabled:opacity-50"
              aria-label={`Load prices for ${candidate.displayName}`}
            >
              {loading ? '…' : '⬇ Load'}
            </button>
          ) : (
            <MetricCell value={candidate.returnOnAssets} rank={candidate.returnOnAssetsRank} fmt={(v) => fmtPct(v)} />
          )}
        </td>
      )}
      {!hiddenKeys.has('drawFromHigh') && (
        <td className={`px-2 py-1.5 text-right ${returnColor(candidate.drawFromHigh)}`}>{fmtPct(candidate.drawFromHigh)}</td>
      )}
      {!hiddenKeys.has('drawFrom5YHigh') && (
        <td className={`px-2 py-1.5 text-right ${returnColor(candidate.drawFrom5YHigh)}`}>
          {fmtPct(candidate.drawFrom5YHigh)}
        </td>
      )}
      {!hiddenKeys.has('drawFrom7YHigh') && (
        <td className={`px-2 py-1.5 text-right ${returnColor(candidate.drawFrom7YHigh)}`}>
          {fmtPct(candidate.drawFrom7YHigh)}
        </td>
      )}
      {!hiddenKeys.has('levyRS') && (
        <td className="px-2 py-1.5 text-right text-gray-300">
          {candidate.levyRS != null ? candidate.levyRS.toFixed(2) : '—'}
        </td>
      )}
      {!hiddenKeys.has('weeklyRsi14') && (
        <td className="px-2 py-1.5 text-right text-muted">—</td>
      )}
      {!hiddenKeys.has('weeklyVolaRatio') && (
        <td className="px-2 py-1.5 text-right text-muted">—</td>
      )}
      {!hiddenKeys.has('tfaTScore') && (
        <td className="px-2 py-1.5 text-right">
          {candidate.tfaTScore != null ? candidate.tfaTScore.toFixed(2) : <span className="text-muted">—</span>}
        </td>
      )}
      {!hiddenKeys.has('tfaFScore') && (
        <td className="px-2 py-1.5 text-right">
          {candidate.tfaFScore != null ? candidate.tfaFScore.toFixed(2) : <span className="text-muted">—</span>}
        </td>
      )}
      {!hiddenKeys.has('tfaTScore5Y') && (
        <td className="px-2 py-1.5 text-right text-muted">—</td>
      )}
      {!hiddenKeys.has('tfaFScore5Y') && (
        <td className="px-2 py-1.5 text-right text-muted">—</td>
      )}
      {!hiddenKeys.has('tfaScore') && (
        <td className="px-2 py-1.5 text-right">
          <TfaScoreCell score={candidate.tfaScore} ko={candidate.tfaKO} />
        </td>
      )}
      {!hiddenKeys.has('tfaPhase') && (
        <td
          className={`px-2 py-1.5 text-right sticky z-[2] bg-surface2/40 border-r border-border/40 ${stickyWidthClass('tfaPhase')}`}
          style={stickyColumnStyle('tfaPhase')}
        >
          <TfaPhaseBadge
            phase={candidate.tfaPhase}
            reason={candidate.tfaRejectReason}
            summary={generateTfaSummary(candidate)}
            inst={candidate}
          />
        </td>
      )}
      {!hiddenKeys.has('tfaCrossoverDaysAgo') && (
        <td className="px-2 py-1.5 text-right text-muted">—</td>
      )}
      {!hiddenKeys.has('breakoutScore') && (
        <td className="px-2 py-1.5 text-right text-gray-400">—</td>
      )}
      {!hiddenKeys.has('breakoutAgeDays') && (
        <td className="px-2 py-1.5 text-right text-gray-400">—</td>
      )}
      {!hiddenKeys.has('pullbackScore') && (
        <td className="px-2 py-1.5 text-right text-muted">—</td>
      )}
      {!hiddenKeys.has('pullbackStop') && (
        <td className="px-2 py-1.5 text-right text-muted">—</td>
      )}
      {!hiddenKeys.has('pullbackTarget') && (
        <td className="px-2 py-1.5 text-right text-muted">—</td>
      )}
    </tr>
  )
}

// ─── Expanded detail row ─────────────────────────────────────────────────────

function ExpandedDetail({
  inst,
  atrMultiplier,
  allInstruments,
  onLoadPrices,
  onLoadAnalyst,
  viewPreset,
  onContextUpdated,
  onTogglePortfolio,
  onRemove,
  colSpan,
  hiddenKeys,
}: {
  inst: any
  atrMultiplier: number
  allInstruments: any[]
  onLoadPrices: (isin: string) => void
  onLoadAnalyst: (isin: string) => void
  viewPreset: ViewPreset
  onContextUpdated: (isin: string) => void
  onTogglePortfolio: (isin: string) => void
  onRemove: (isin: string) => void
  colSpan: number
  hiddenKeys: Set<string>
}) {
  const lastPrice = inst.closes?.length > 0 ? inst.closes[inst.closes.length - 1] : undefined
  const priceCurrency = inst.priceCurrency ?? inst.currency ?? null
  const analystCurrency = inst.analystCurrency ?? null
  const currencyMismatch = analystCurrency != null && priceCurrency != null && analystCurrency !== priceCurrency
  const targetDisplay = inst.targetCurrencyUnknown ? null : (inst.targetPriceAdj ?? inst.targetPrice)
  const targetDisplayCurrency = inst.targetCurrencyUnknown
    ? priceCurrency
    : (inst.targetPriceAdj != null ? priceCurrency : (analystCurrency ?? priceCurrency))
  const targetForUpside = inst.targetPriceAdj != null
    ? inst.targetPriceAdj
    : (analystCurrency && priceCurrency && analystCurrency !== priceCurrency ? null : inst.targetPrice)
  const referencePrice = lastPrice
  const upside = (targetForUpside != null && referencePrice != null)
    ? (targetForUpside / referencePrice - 1)
    : null
  const { result: ctx, loading: ctxLoading, load: loadCtx, invalidate } =
    useInstrumentContext(inst.isin)
  const [combinedLoading, setCombinedLoading] = useState(false)
  const hasContext = !!ctx && !ctx.error
  type ContextSection = 'analyst' | 'earnings' | 'news' | 'risk'
  type DetailSection = 'tfa' | 'pullback'

  const contextOpenByPreset = (preset: ViewPreset): Record<ContextSection, boolean> => {
    if (preset === 'detail') return { analyst: true, earnings: true, news: true, risk: true }
    if (preset === 'risk') return { analyst: false, earnings: false, news: true, risk: true }
    return { analyst: true, earnings: false, news: false, risk: true }
  }

  const [contextOpen, setContextOpen] = useState<Record<ContextSection, boolean>>(() => contextOpenByPreset(viewPreset))
  const [detailOpen, setDetailOpen] = useState<Record<DetailSection, boolean>>({
    tfa: false,
    pullback: false,
  })

  useEffect(() => {
    setContextOpen(contextOpenByPreset(viewPreset))
    setDetailOpen({ tfa: false, pullback: false })
  }, [viewPreset])

  const toggleContextSection = (section: ContextSection) => {
    setContextOpen((prev) => ({ ...prev, [section]: !prev[section] }))
  }
  const toggleDetailSection = (section: DetailSection) => {
    setDetailOpen((prev) => ({ ...prev, [section]: !prev[section] }))
  }

  // Resolve dedup candidates from full instrument list
  const candidates = (inst.dedupCandidates ?? [])
    .map((isin: string) => allInstruments.find(i => i.isin === isin))
    .filter(Boolean)

  return (
    <>
      {/* Detail panel */}
      <tr className="border-b border-border bg-surface/70">
        <td colSpan={colSpan} className="px-4 py-3">
          <div className="text-[11px] text-muted grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-4">
            {/* Instrument details */}
            <div>
              <div className="text-gray-400 font-semibold mb-1">Instrument</div>
              <div>
                ISIN:{' '}
                <span
                  className="text-gray-300 cursor-pointer hover:text-gray-200"
                  title="Double-click to search ISIN"
                  onDoubleClick={(e) => { e.stopPropagation(); openIsinSearch(inst.isin) }}
                >
                  {inst.isin}
                </span>
              </div>
              {inst.wkn && <div>WKN: <span className="text-gray-300">{inst.wkn}</span></div>}
              {inst.mnemonic && <div>Mnemonic: <span className="text-gray-300">{inst.mnemonic}</span></div>}
              {inst.yahooTicker && <div>Yahoo: <span className="text-gray-300">{inst.yahooTicker}</span></div>}
              {inst.xetraGroup && <div>Group: <span className="text-gray-300">{inst.xetraGroup}</span></div>}
              {inst.sector && (
                <div>Sector: <span className="text-gray-300">{inst.sector}</span></div>
              )}
              {inst.industry && (
                <div>Industry: <span className="text-gray-300">{inst.industry}</span></div>
              )}
              {inst.longName && <div>OpenFIGI: <span className="text-gray-300">{inst.longName}</span></div>}
              {inst.yahooLongName && <div>Yahoo long name: <span className="text-gray-300">{inst.yahooLongName}</span></div>}
              <div className="mt-1 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onLoadPrices(inst.isin)}
                  className="btn btn-sm btn-secondary focus-ring"
                >
                  ⬇ Load prices
                </button>
                <span className="text-[10px] text-muted">Portfolio:</span>
                <button
                  type="button"
                  onClick={() => onTogglePortfolio(inst.isin)}
                  className={`focus-ring text-[10px] ${inst.inPortfolio ? 'text-amber-400' : 'text-muted hover:text-gray-300'}`}
                  title={inst.inPortfolio ? 'Remove from portfolio' : 'Add to portfolio'}
                  aria-label={inst.inPortfolio ? `Remove ${inst.displayName} from portfolio` : `Add ${inst.displayName} to portfolio`}
                >
                  ★
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(inst.isin)}
                  className="focus-ring text-[10px] text-muted hover:text-red-400"
                  title="Hide/remove instrument"
                  aria-label={`Hide ${inst.displayName}`}
                >
                  ×
                </button>
              </div>
              {lastPrice != null && <div className="mt-1">Last Price: <span className="text-gray-300">{lastPrice.toFixed(2)}</span></div>}
              {inst.dedupGroup && (
                <div className="mt-1 text-[10px]">
                  Dedup key: <span className="text-gray-400">{inst.dedupGroup}</span>
                </div>
              )}
            </div>

            {/* Moving averages */}
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
                  <div>Stop ({atrMultiplier}× ATR): <span className="text-amber-400">
                    {inst.sellingThreshold?.toFixed(2) ?? '—'}
                  </span>
                    {lastPrice != null && inst.sellingThreshold != null && (
                      <span className="text-muted text-[10px] ml-1">
                        {fmtPct(inst.sellingThreshold / lastPrice - 1)}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Data status */}
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
              {inst.priceError && <div className="text-red-400 mt-1">Error: {inst.priceError}</div>}
            </div>
          </div>
          {(inst.type === 'Stock' || inst.type === 'Unknown') && inst.yahooTicker && (
            <div className="mt-3 pt-3 border-t border-border">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-gray-400 font-mono">
                    🌐 Analyst & Macro Context
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      setCombinedLoading(true)
                      try {
                        if (ctx) invalidate()
                        await Promise.all([
                          onLoadAnalyst(inst.isin),
                          loadCtx(
                            inst.yahooTicker,
                            inst.displayName,
                            lastPrice ?? null,
                            targetForUpside ?? null
                          ),
                        ])
                      } finally {
                        setCombinedLoading(false)
                        onContextUpdated(inst.isin)
                      }
                    }}
                    disabled={ctxLoading || combinedLoading}
                    className="btn btn-sm btn-ghost focus-ring disabled:opacity-40"
                    aria-label={ctx ? 'Refresh analyst and context data' : 'Load analyst and context data'}
                  >
                    {(ctxLoading || combinedLoading) ? '…' : ctx ? '↺ Refresh' : '⬇ Load'}
                  </button>
                  {(ctxLoading || combinedLoading) && (
                    <span className="text-[10px] text-muted font-mono">
                      {ctxLoading ? 'Searching…' : 'Loading…'}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {ctx && (
                    <span className="text-[10px] text-muted font-mono">
                      {new Date(ctx.fetchedAt).toLocaleTimeString('en-GB')}
                    </span>
                  )}
                </div>
              </div>

              {(inst.analystFetched || hasContext) && (
                <div className="space-y-2 text-[11px] font-mono min-w-0">
                  <ContextAccordionSection
                    title="Analyst Snapshot"
                    isOpen={contextOpen.analyst}
                    onToggle={() => toggleContextSection('analyst')}
                    badges={[
                      <StatusBadge key="rating" tone="muted">
                        {inst.analystRatingKey ? String(inst.analystRatingKey).toUpperCase() : 'n/a'}
                      </StatusBadge>,
                      <StatusBadge key="opinions" tone="muted">
                        {inst.analystOpinions != null ? `${inst.analystOpinions} an.` : '—'}
                      </StatusBadge>,
                    ]}
                  >
                    {inst.type === 'Stock' ? (
                      inst.analystFetched ? (
                        <>
                          <div>Rating: <span className="text-gray-300" title={inst.analystSource ? `Source: ${inst.analystSource}` : undefined}>
                            {inst.analystRatingKey ? String(inst.analystRatingKey).toUpperCase() : '—'}
                            {inst.analystRating != null ? ` (${inst.analystRating.toFixed(2)})` : ''}
                          </span>
                            {inst.analystOpinions != null && (
                              <span className="text-muted"> · {inst.analystOpinions} analysts</span>
                            )}
                          </div>
                          <div>Target: <span className="text-gray-300" title={inst.analystSource ? `Source: ${inst.analystSource}` : undefined}>
                            {targetDisplay != null ? targetDisplay.toFixed(2) : '—'}
                            {targetDisplayCurrency ? ` ${targetDisplayCurrency}` : ''}
                          </span>
                            {upside != null && (
                              <span className={upside >= 0 ? 'text-green-400' : 'text-red-400'}>
                                {upside >= 0 ? ' +' : ' '}{(upside * 100).toFixed(1)}%
                              </span>
                            )}
                          </div>
                          {(inst.targetLowAdj != null || inst.targetHighAdj != null || inst.targetLow != null || inst.targetHigh != null) && (
                            <div className="text-muted break-words">
                              Range: {inst.targetLowAdj != null ? inst.targetLowAdj.toFixed(2) : (inst.targetLow != null ? inst.targetLow.toFixed(2) : '—')}
                              {' – '}
                              {inst.targetHighAdj != null ? inst.targetHighAdj.toFixed(2) : (inst.targetHigh != null ? inst.targetHigh.toFixed(2) : '—')}
                              {targetDisplayCurrency ? ` ${targetDisplayCurrency}` : ''}
                            </div>
                          )}
                          {inst.targetFxApplied && inst.targetFxRate != null && (
                            <div className="text-muted text-[10px] break-words">
                              FX adjusted ×{inst.targetFxRate.toFixed(3)}
                              {analystCurrency && priceCurrency && analystCurrency !== priceCurrency
                                ? ` (${analystCurrency} → ${priceCurrency})`
                                : ''}
                            </div>
                          )}
                          {inst.targetFxApplied && inst.targetPrice != null && analystCurrency && (
                            <div className="text-muted text-[10px]">
                              Original: {inst.targetPrice.toFixed(2)} {analystCurrency}
                            </div>
                          )}
                          {inst.targetCurrencyUnknown && (
                            <div className="text-amber-400 text-[10px]">
                              ⚠ Could not verify target-price currency — value may be in a different currency
                            </div>
                          )}
                          {currencyMismatch && !inst.targetFxApplied && (
                            <div className="text-amber-300 text-[10px] break-words">
                              Currency mismatch: {analystCurrency} target vs {priceCurrency} price
                            </div>
                          )}
                          {inst.analystError && <div className="text-red-400 mt-1">Error: {inst.analystError}</div>}
                        </>
                      ) : (
                        <div className="text-muted">Not loaded</div>
                      )
                    ) : (
                      <div className="text-muted">Not available for this instrument type</div>
                    )}
                  </ContextAccordionSection>

                  <ContextAccordionSection
                    title="Earnings"
                    isOpen={contextOpen.earnings}
                    onToggle={() => toggleContextSection('earnings')}
                    badges={[
                      <StatusBadge key="next" tone="info">
                        {ctx?.nextEarnings ? `Next: ${ctx.nextEarnings}` : 'Next: n/a'}
                      </StatusBadge>,
                    ]}
                  >
                    {hasContext ? (
                      <>
                        {ctx.lastEarnings && (
                          <>
                            <div>
                              <span className="text-muted">Last earnings: </span>
                              <span className="text-gray-300">{ctx.lastEarnings.date ?? '—'}</span>
                              {ctx.lastEarnings.result && (
                                <span className={`ml-1 ${
                                  ctx.lastEarnings.result === 'beat'   ? 'text-green-400' :
                                  ctx.lastEarnings.result === 'miss'   ? 'text-red-400'   :
                                                                         'text-gray-400'
                                }`}>
                                  · {ctx.lastEarnings.result.toUpperCase()}
                                </span>
                              )}
                            </div>
                            {ctx.lastEarnings.detail && (
                              <div className="text-muted leading-snug break-words">
                                {ctx.lastEarnings.detail}
                              </div>
                            )}
                          </>
                        )}
                        {ctx.nextEarnings && (
                          <div>
                            <span className="text-muted">Next earnings: </span>
                            <span className="text-gray-300">{ctx.nextEarnings}</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-muted">Not loaded</div>
                    )}
                  </ContextAccordionSection>

                  <ContextAccordionSection
                    title="News & Macro"
                    isOpen={contextOpen.news}
                    onToggle={() => toggleContextSection('news')}
                    badges={[
                      <StatusBadge key="news" tone="muted">
                        {ctx?.news?.length ?? 0} news
                      </StatusBadge>,
                      <StatusBadge key="macro" tone={ctx?.macroRisk ? 'warning' : 'muted'}>
                        {ctx?.macroRisk ? 'macro risk' : 'no macro risk'}
                      </StatusBadge>,
                    ]}
                  >
                    {hasContext ? (
                      <>
                        {ctx.news.map((n, i) => (
                          <div key={i} className="flex items-start gap-1.5">
                            <span className={`shrink-0 ${
                              n.sentiment === 'positive' ? 'text-green-400' :
                              n.sentiment === 'negative' ? 'text-red-400'   :
                                                           'text-gray-400'
                            }`}>●</span>
                            <span className="text-gray-300 leading-snug break-words">{n.headline}</span>
                          </div>
                        ))}
                        {ctx.macroRisk && (
                          <div className="flex items-start gap-1.5 mt-1">
                            <span className="text-amber-400 shrink-0">⚠</span>
                            <span className="text-amber-400 leading-snug break-words">{ctx.macroRisk}</span>
                          </div>
                        )}
                        {ctx.macroRiskEvidence.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {ctx.macroRiskEvidence.slice(0, 2).map((ev, i) => (
                              <span
                                key={`ctx-macro-ev-${i}`}
                                className={`rounded border px-1 py-0.5 text-[10px] ${evidenceConfidenceClass(ev.confidence)}`}
                                title={ev.confidenceReason ?? undefined}
                              >
                                {(ev.sourceName ?? 'source')} · {ev.publishedAt ?? 'n/a'} · {ev.confidence}
                              </span>
                            ))}
                          </div>
                        )}
                        {ctx.macroRiskEvidence.length === 0 && ctx.macroRiskInsufficientEvidenceReason && (
                          <div className="text-[10px] text-amber-400 break-words">{ctx.macroRiskInsufficientEvidenceReason}</div>
                        )}
                      </>
                    ) : (
                      <div className="text-muted">Not loaded</div>
                    )}
                  </ContextAccordionSection>

                  <ContextAccordionSection
                    title="Risk & Evidence"
                    isOpen={contextOpen.risk}
                    onToggle={() => toggleContextSection('risk')}
                    badges={[
                      <StatusBadge key="health" tone={financialHealthTone(ctx?.financialHealth?.status)}>
                        FH: {financialHealthLabel(ctx?.financialHealth?.status)}
                      </StatusBadge>,
                      <StatusBadge key="bank" tone={bankruptcyRiskTone(ctx?.bankruptcyRisk?.level)}>
                        BK: {bankruptcyRiskLabel(ctx?.bankruptcyRisk?.level)}
                      </StatusBadge>,
                      <StatusBadge key="quality" tone={dataQualityTone(ctx?.dataQuality)}>
                        Q: {ctx?.dataQuality?.toUpperCase() ?? 'N/A'}
                      </StatusBadge>,
                    ]}
                  >
                    {hasContext ? (
                      <div className="space-y-2">
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-gray-300">Financial health:</span>
                            <StatusBadge tone={financialHealthTone(ctx.financialHealth?.status)} className="font-semibold">
                              {financialHealthLabel(ctx.financialHealth?.status)}
                            </StatusBadge>
                          </div>
                          {ctx.financialHealth?.detail && (
                            <div className="text-gray-300 leading-snug break-words">
                              {ctx.financialHealth.detail}
                            </div>
                          )}
                          {(ctx.financialHealth?.evidence?.length ?? 0) > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {(ctx.financialHealth?.evidence ?? []).slice(0, 2).map((ev, i) => (
                                <span
                                  key={`ctx-health-ev-${i}`}
                                  className={`rounded border px-1 py-0.5 text-[10px] ${evidenceConfidenceClass(ev.confidence)}`}
                                  title={ev.confidenceReason ?? undefined}
                                >
                                  {(ev.sourceName ?? 'source')} · {ev.publishedAt ?? 'n/a'} · {ev.confidence}
                                </span>
                              ))}
                            </div>
                          )}
                          {(ctx.financialHealth?.evidence?.length ?? 0) === 0 && ctx.financialHealth?.insufficientEvidenceReason && (
                            <div className="text-[10px] text-amber-400 break-words">{ctx.financialHealth.insufficientEvidenceReason}</div>
                          )}
                        </div>

                        <div className="space-y-1 border-t border-border/50 pt-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-gray-300">Bankruptcy risk:</span>
                            <StatusBadge tone={bankruptcyRiskTone(ctx.bankruptcyRisk?.level)}>
                              {bankruptcyRiskLabel(ctx.bankruptcyRisk?.level)}
                            </StatusBadge>
                          </div>
                          {ctx.bankruptcyRisk?.detail && (
                            <div className="text-gray-300 leading-snug break-words">
                              {ctx.bankruptcyRisk.detail}
                            </div>
                          )}
                          {ctx.bankruptcyRisk?.signals?.map((signal, i) => (
                            <div key={`risk-${i}`} className="flex items-start gap-1.5">
                              <span className="text-gray-500 shrink-0">•</span>
                              <span className="text-gray-300 leading-snug break-words">{signal}</span>
                            </div>
                          ))}
                          {(ctx.bankruptcyRisk?.evidence?.length ?? 0) > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {(ctx.bankruptcyRisk?.evidence ?? []).slice(0, 2).map((ev, i) => (
                                <span
                                  key={`ctx-bank-ev-${i}`}
                                  className={`rounded border px-1 py-0.5 text-[10px] ${evidenceConfidenceClass(ev.confidence)}`}
                                  title={ev.confidenceReason ?? undefined}
                                >
                                  {(ev.sourceName ?? 'source')} · {ev.publishedAt ?? 'n/a'} · {ev.confidence}
                                </span>
                              ))}
                            </div>
                          )}
                          {(ctx.bankruptcyRisk?.evidence?.length ?? 0) === 0 && ctx.bankruptcyRisk?.insufficientEvidenceReason && (
                            <div className="text-[10px] text-amber-400 break-words">{ctx.bankruptcyRisk.insufficientEvidenceReason}</div>
                          )}
                        </div>

                        {(ctx.asOf || ctx.dataQuality) && (
                          <div className="text-[10px] text-gray-400 mt-1 border-t border-border/50 pt-2">
                            {ctx.asOf && <>As-of: {new Date(ctx.asOf).toLocaleString('en-GB')}</>}
                            {ctx.dataQuality && (
                              <span className={`ml-1 ${
                                ctx.dataQuality === 'high' ? 'text-green-300'
                                  : ctx.dataQuality === 'medium' ? 'text-amber-300'
                                    : 'text-red-300'
                              }`}>
                                {ctx.dataQuality.toUpperCase()}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-muted">Not loaded</div>
                    )}
                  </ContextAccordionSection>
                </div>
              )}

              {ctx?.error && (
                <div className="text-[11px] font-mono text-red-400">
                  Error: {ctx.error}
                </div>
              )}
            </div>
          )}

          {inst.type === 'Stock' && (
            <div className="mt-3 pt-3 border-t border-border">
              <ContextAccordionSection
                title="TFA Breakdown"
                isOpen={detailOpen.tfa}
                onToggle={() => toggleDetailSection('tfa')}
                badges={[
                  inst.tfaScenario ? (
                    <StatusBadge key="scenario" tone="info">
                      {inst.tfaScenario === '7y' ? '7Y Deep Value' : inst.tfaScenario === '5y' ? '5Y Consolidation' : '52W Crash'}
                    </StatusBadge>
                  ) : (
                    <StatusBadge key="scenario-empty" tone="muted">Scenario n/a</StatusBadge>
                  ),
                  <span key="phase"><TfaPhaseBadge phase={inst.tfaPhase} reason={inst.tfaRejectReason} summary={generateTfaSummary(inst)} inst={inst} /></span>,
                  inst.tfaPhase === 'above_all_mas' && inst.tfaFetched ? (
                    <StatusBadge key="estate" tone={inst.tfaKO ? 'danger' : 'muted'}>
                      {inst.tfaKO ? 'KO' : inst.tfaEScore != null ? `E: ${inst.tfaEScore.toFixed(2)}` : 'Analyzed'}
                    </StatusBadge>
                  ) : null,
                ].filter(Boolean) as React.ReactNode[]}
              >
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {inst.tfaPhase === 'above_all_mas' && !inst.analystFetched && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onLoadAnalyst(inst.isin)
                        }}
                        className="btn btn-sm btn-secondary focus-ring"
                        title="Load fundamentals and Gemini catalyst check"
                      >
                        Load analysis
                      </button>
                    )}
                    {inst.tfaPhase === 'above_all_mas' && inst.analystFetched && !inst.tfaFetched && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onLoadAnalyst(inst.isin)
                        }}
                        className="btn btn-sm btn-secondary focus-ring"
                        title="Load Gemini catalyst check"
                      >
                        Load Gemini
                      </button>
                    )}
                  </div>

                  {inst.tfaPhase !== 'none' && (
                    <div className="text-[11px] text-gray-300 leading-snug italic border-l-2 border-yellow-400/30 pl-2">
                      {generateTfaSummary(inst)}
                    </div>
                  )}
                  {inst.tfaRejectReason && (
                    <div className={`text-[10px] ${inst.tfaPhase === 'rejected' || inst.tfaPhase === 'none' ? 'text-red-400' : 'text-muted'}`}>
                      {inst.tfaRejectReason}
                    </div>
                  )}
                  <div className="text-[10px] text-muted">
                    Stabilization: {
                      [
                        (inst.tfaTSignals?.t1 ?? 0) >= 1 ? 'RSI' : null,
                        inst.aboveMa50 === true ? 'MA50' : null,
                        inst.higherLow === true ? 'HigherLow' : null,
                      ].filter(Boolean).join(', ') || '—'
                    }
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-4 text-[11px] font-mono">
                    <div className="space-y-1">
                      <div className="text-gray-300 font-semibold">T-Score (Technical)</div>
                      <div>Score: <span className="text-gray-200">{inst.tfaTScore != null ? inst.tfaTScore.toFixed(2) : '—'}</span></div>
                      {inst.maCrossover?.stillValid && inst.maCrossover.risingMa && (
                        <div className="text-yellow-400 font-semibold">
                          ⚡ {inst.maCrossover.risingMa.toUpperCase()} Cross
                          {inst.tfaCrossoverDaysAgo != null ? ` ${inst.tfaCrossoverDaysAgo}d ago` : ''}
                        </div>
                      )}
                      {inst.maCrossover && !inst.maCrossover.stillValid &&
                        (inst.maCrossover.ma50 || inst.maCrossover.ma100 || inst.maCrossover.ma200) && (
                        <div className="text-orange-400 text-[10px]">
                          ⚠ Cross no longer valid (price below MA)
                        </div>
                      )}
                      <div>T1 RSI turns: <SignalValue value={inst.tfaTSignals?.t1} /></div>
                      <div>T2 MA-Cross/MA50: <SignalValue value={inst.tfaTSignals?.t2} /></div>
                      <div>T3 Higher Low: <SignalValue value={inst.tfaTSignals?.t3} /></div>
                      <div>T4 Volume: <SignalValue value={inst.tfaTSignals?.t4} /></div>
                      <div>T5 Drawdown: <SignalValue value={inst.tfaTSignals?.t5} /></div>
                      {(inst.tfaScenario === '5y' || inst.tfaScenario === '7y') && (
                        <>
                          <div className="text-gray-300 font-semibold mt-2">
                            T-Score ({inst.tfaScenario === '7y' ? '7Y' : '5Y'} Weekly)
                          </div>
                          <div>Score: <span className="text-gray-200">{inst.tfaTScore5Y != null ? inst.tfaTScore5Y.toFixed(2) : '—'}</span></div>
                          <div>T1 RSI turns (W): <SignalValue value={inst.tfaTSignals5Y?.t1} /></div>
                          <div>T2 LevyRS (W): <SignalValue value={inst.tfaTSignals5Y?.t2} /></div>
                          <div>T3 Higher Low (W): <SignalValue value={inst.tfaTSignals5Y?.t3} /></div>
                          <div>T4 Vola compression (W): <SignalValue value={inst.tfaTSignals5Y?.t4} /></div>
                          <div>T5 Drawdown: <SignalValue value={inst.tfaTSignals5Y?.t5} /></div>
                        </>
                      )}
                    </div>

                    <div className="space-y-1">
                      <div className="text-gray-300 font-semibold">F-Score (Fundamental)</div>
                      <div>Score: <span className="text-gray-200">{inst.tfaFScore != null ? inst.tfaFScore.toFixed(2) : '—'}</span></div>
                      <div>F1 PB: <SignalValue value={inst.tfaFSignals?.f1} /></div>
                      <div>F2 EV/EBITDA: <SignalValue value={inst.tfaFSignals?.f2} /></div>
                      <div>F3 Upside: <SignalValue value={inst.tfaFSignals?.f3} /></div>
                      {(inst.tfaScenario === '5y' || inst.tfaScenario === '7y') && (
                        <>
                          <div className="text-gray-300 font-semibold mt-2">
                            F-Score ({inst.tfaScenario === '7y' ? '7Y' : '5Y'} relaxed)
                          </div>
                          <div>Score: <span className="text-gray-200">{inst.tfaFScore5Y != null ? inst.tfaFScore5Y.toFixed(2) : '—'}</span></div>
                          <div>F1 PB: <SignalValue value={inst.tfaFSignals5Y?.f1} /></div>
                          <div>F2 EV/EBITDA: <SignalValue value={inst.tfaFSignals5Y?.f2} /></div>
                          <div>F3 ROA: <SignalValue value={inst.tfaFSignals5Y?.f3} /></div>
                          <div>F4 Analyst: <SignalValue value={inst.tfaFSignals5Y?.f4} /></div>
                          <div>F5 Upside: <SignalValue value={inst.tfaFSignals5Y?.f5} /></div>
                        </>
                      )}
                    </div>

                    <div className="space-y-1">
                      <div className="text-gray-300 font-semibold">E-Score (Gemini)</div>
                      <div>E-Score: <span className={
                        inst.tfaEScore == null ? 'text-muted'
                          : inst.tfaEScore > 0.6 ? 'text-green-300'
                          : inst.tfaEScore > 0.3 ? 'text-yellow-300' : 'text-orange-300'
                      }>
                        {inst.tfaEScore == null ? 'no data' : inst.tfaEScore.toFixed(2)}
                      </span></div>
                      <div>Final TFA: <span className="text-gray-200">{inst.tfaScore != null ? inst.tfaScore.toFixed(2) : '—'}</span></div>
                      {(['earningsBeatRecent','earningsBeatPrior','guidanceRaised','analystUpgrade','insiderBuying','restructuring'] as const).map((key) => {
                        const sig = inst.tfaCatalyst?.[key]
                        const label: Record<string, string> = {
                          earningsBeatRecent: 'Earnings Beat (recent)',
                          earningsBeatPrior: 'Earnings Beat (prior)',
                          guidanceRaised: 'Guidance raised',
                          analystUpgrade: 'Analyst upgrade',
                          insiderBuying: 'Insider buying',
                          restructuring: 'Restructuring',
                        }
                        const confColor = !sig ? 'text-muted'
                          : sig.confidence === 'high' ? 'text-green-300'
                          : sig.confidence === 'medium' ? 'text-yellow-300'
                          : sig.confidence === 'low' ? 'text-orange-300'
                          : 'text-muted'
                        return (
                          <div key={key} className="text-[10px]">
                            <span className="text-gray-400">{label[key]}: </span>
                            <span className={confColor}>
                              {!sig ? '—' : sig.confidence === 'not_found' ? 'n/a'
                                : `${sig.value} (${sig.confidence})`}
                            </span>
                            {!!sig && (sig.source || sig.evidence?.[0]?.sourceName) && (
                              <div className="text-[10px] text-muted ml-2">
                                {(sig.evidence?.[0]?.sourceName ?? sig.source ?? 'source')}
                                {sig.evidence?.[0]?.publishedAt ? ` · ${sig.evidence[0].publishedAt}` : ''}
                                {sig.evidence?.[0]?.confidence ? ` · ${sig.evidence[0].confidence}` : ''}
                              </div>
                            )}
                          </div>
                        )
                      })}
                      {inst.tfaCatalyst?.koRisk?.value && (
                        <div className="text-red-300 font-semibold">
                          ⛔ KO risk ({inst.tfaCatalyst.koRisk.confidence})
                        </div>
                      )}
                      {inst.tfaCatalyst?.summary && (
                        <div className="text-gray-300 text-[10px] leading-snug mt-1">{inst.tfaCatalyst.summary}</div>
                      )}
                      {inst.tfaPhase === 'watch' && !inst.tfaFetched && (
                        <div className="text-yellow-300 text-[10px]">Gemini not loaded yet</div>
                      )}
                      {inst.tfaPhase === 'monitoring' && (
                        <div className="text-gray-400 text-[10px]">Waiting for MA crossover</div>
                      )}
                    </div>
                  </div>
                </div>
              </ContextAccordionSection>
            </div>
          )}

          {inst.type === 'Stock' && inst.pullbackScore !== null && inst.pullbackScore !== undefined && (
            <div className="mt-3 pt-3 border-t border-border">
              <ContextAccordionSection
                title="Pullback Setup"
                isOpen={detailOpen.pullback}
                onToggle={() => toggleDetailSection('pullback')}
                badges={[
                  <StatusBadge key="pullback-score" tone={pullbackScoreTone(inst.pullbackScore)}>
                    Score: {inst.pullbackScore != null ? inst.pullbackScore.toFixed(2) : '—'}
                  </StatusBadge>,
                ]}
              >
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 text-[11px] font-mono mb-2">
                  <div className="space-y-1">
                    <div className="text-gray-300 font-semibold">Signals</div>
                    <div>S1 RSI + MA50: <SignalValue value={inst.pullbackSignals?.s1} /></div>
                    <div>S2 RSI turns: <SignalValue value={inst.pullbackSignals?.s2} /></div>
                    <div>S3 Volume fades: <SignalValue value={inst.pullbackSignals?.s3} /></div>
                    <div>S4 Near MA50: <SignalValue value={inst.pullbackSignals?.s4} /></div>
                    <div>S5 Stabilization: <SignalValue value={inst.pullbackSignals?.s5} /></div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-gray-300 font-semibold">Trade Setup</div>
                    <div>
                      Entry (current):
                      <span className="text-gray-200 ml-1">
                        {inst.closes && inst.closes.length > 0
                          ? inst.closes[inst.closes.length - 1].toFixed(2)
                          : '—'}
                      </span>
                    </div>
                    <div>
                      Stop: <span className="text-red-300 ml-1">
                        {inst.pullbackStop != null ? inst.pullbackStop.toFixed(2) : '—'}
                      </span>
                    </div>
                    <div>
                      Target: <span className="text-green-300 ml-1">
                        {inst.pullbackTarget != null ? inst.pullbackTarget.toFixed(2) : '—'}
                      </span>
                    </div>
                    <div>
                      R/R: <span className="text-gray-200 ml-1">
                        {inst.pullbackRR != null ? `1:${inst.pullbackRR.toFixed(1)}` : '—'}
                      </span>
                    </div>
                    <div className="text-muted text-[10px] mt-1">
                      Momentum Rank: #{inst.momentumRank ?? '—'}
                      {' · '}RSI: {inst.rsi14 != null ? inst.rsi14.toFixed(1) : '—'}
                    </div>
                  </div>
                </div>

                {(() => {
                  const group = inst.xetraGroup ?? ''
                  const isDaxMdax = ['DAX', 'MDAX'].includes(group)
                  const isSdax = group === 'SDAX'
                  return (
                    <div className={`text-[10px] border-t border-border/40 pt-1 mt-1 ${
                      isDaxMdax ? 'text-muted' : 'text-orange-300'
                    }`}>
                      {isDaxMdax && (
                        <>⚠ Not investment advice. Respect your stop-loss. Gettex execution preferred.</>
                      )}
                      {isSdax && (
                        <>⚠ SDAX: spread can be 0.3–0.8% — use limit orders, avoid market orders, respect stop-loss.</>
                      )}
                      {!isDaxMdax && !isSdax && (
                        <>⚠ International/smaller names: check spread before entry. Spread can exceed 0.5%. Use limit orders and respect stop-loss.</>
                      )}
                    </div>
                  )
                })()}
              </ContextAccordionSection>
            </div>
          )}
        </td>
      </tr>

      {/* Dedup group candidates */}
      {candidates.length > 0 && (
        <>
          <tr className="bg-surface border-b border-border/40">
            <td colSpan={colSpan} className="px-4 py-1">
              <span className="text-[10px] text-muted font-mono">
                {candidates.length} more ETF{candidates.length > 1 ? 's' : ''} in this dedup group — price data can be loaded individually
              </span>
            </td>
          </tr>
          {candidates.map((c: any) => (
            <CandidateRow key={c.isin} candidate={c} onLoad={onLoadPrices} hiddenKeys={hiddenKeys} colCount={colSpan} />
          ))}
        </>
      )}
    </>
  )
}

function TableToolbar({
  total,
  shown,
  hiddenGroupCount,
  sortColumn,
  sortDirection,
  isUpdating,
  activePreset,
  onPresetChange,
}: {
  total: number
  shown: number
  hiddenGroupCount: number
  sortColumn: string
  sortDirection: 'asc' | 'desc'
  isUpdating: boolean
  activePreset: ViewPreset
  onPresetChange: (preset: ViewPreset) => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-3 py-2">
      <div className="flex items-center gap-2 text-ui-sm font-mono text-muted">
        <span>Showing {shown.toLocaleString()} / {total.toLocaleString()} instruments</span>
        <span className="hidden xl:inline">|</span>
        <span className="hidden xl:inline">Sort: {sortColumn} {sortDirection === 'desc' ? '↓' : '↑'}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-ui-xs font-mono">
        {(['scan', 'detail', 'risk'] as const).map((preset) => {
          const active = activePreset === preset
          return (
            <button
              key={preset}
              type="button"
              onClick={() => onPresetChange(preset)}
              className={`focus-ring rounded border px-2 py-1 transition-colors ${
                active
                  ? 'border-accent/40 bg-accent/15 text-accent'
                  : 'border-border text-muted hover:text-gray-300'
              }`}
              aria-label={`Switch to ${VIEW_PRESET_CONFIG[preset].label} preset`}
            >
              {VIEW_PRESET_CONFIG[preset].label}
            </button>
          )
        })}
        {isUpdating ? <span className="text-gray-400 ml-1">Updating data...</span> : null}
        {hiddenGroupCount > 0 ? <span className="text-muted ml-1">{hiddenGroupCount} groups hidden</span> : null}
      </div>
    </div>
  )
}

function MobileInstrumentCard({
  inst,
  expanded,
  onToggleExpanded,
  onTogglePortfolio,
  onRemove,
}: {
  inst: Instrument
  expanded: boolean
  onToggleExpanded: () => void
  onTogglePortfolio: () => void
  onRemove: () => void
}) {
  return (
    <article className="rounded border border-border bg-surface px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onToggleExpanded}
          className="focus-ring min-w-0 text-left"
          aria-expanded={expanded}
          aria-label={`Toggle details for ${inst.displayName}`}
        >
          <div className="truncate font-mono text-ui-sm text-gray-200">{inst.displayName}</div>
          <div className="mt-0.5 flex items-center gap-1.5 font-mono text-ui-xs text-muted">
            <TypeBadge type={inst.type} />
            <span className="truncate">{inst.isin}</span>
          </div>
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onTogglePortfolio}
            className={`focus-ring text-sm ${inst.inPortfolio ? 'text-amber-400' : 'text-muted hover:text-gray-300'}`}
            aria-label={inst.inPortfolio ? 'Remove from portfolio' : 'Add to portfolio'}
            title={inst.inPortfolio ? 'Remove from portfolio' : 'Add to portfolio'}
          >
            ★
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="focus-ring text-sm text-muted hover:text-red-400"
            aria-label={`Remove ${inst.displayName}`}
            title="Remove instrument"
          >
            ×
          </button>
        </div>
      </div>

      {inst.priceFetched && inst.closes && inst.closes.length > 0 && (
        <div className="mt-2 flex justify-end">
          <Sparkline closes={inst.closes} />
        </div>
      )}

      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-ui-sm">
        <div>
          <span className="text-muted">Combined:</span>{' '}
          <span className={scoreColor(inst.combinedScore)}>{inst.combinedScore?.toFixed(2) ?? '—'}</span>
        </div>
        <div>
          <span className="text-muted">1M:</span>{' '}
          <span className={returnColor(inst.r1m)}>{fmtPct(inst.r1m)}</span>
        </div>
        <div>
          <span className="text-muted">3M:</span>{' '}
          <span className={returnColor(inst.r3m)}>{fmtPct(inst.r3m)}</span>
        </div>
        <div>
          <span className="text-muted">6M:</span>{' '}
          <span className={returnColor(inst.r6m)}>{fmtPct(inst.r6m)}</span>
        </div>
        <div>
          <span className="text-muted">RSI:</span>{' '}
          <span className={rsiColor(inst.rsi14)}>{inst.rsi14 != null ? inst.rsi14.toFixed(1) : '—'}</span>
        </div>
      </div>

      {expanded && (
        <div className="mt-2 border-t border-border/50 pt-2 font-mono text-ui-sm text-muted">
          <div>Momentum rank: #{inst.momentumRank ?? '—'}</div>
          <div>TFA: <TfaPhaseBadge phase={inst.tfaPhase} reason={inst.tfaRejectReason} summary={generateTfaSummary(inst)} inst={inst} /></div>
          <div>Breakout: <BreakoutBadge score={inst.breakoutScore} flags={inst.breakoutFlags} /></div>
        </div>
      )}
    </article>
  )
}

// ─── Main Table ───────────────────────────────────────────────────────────────

export function RankingTable({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const { state, dispatch } = useAppState()
  const { fetchSingleInstrumentPrices, fetchSingleInstrumentAnalyst } = usePipeline()
  const instruments = useDisplayedInstruments()
  const isPriceUpdating = state.fetchStatus.phase === 'prices'
  const allInstruments = state.instruments   // full list incl. non-winners
  const { sortColumn, sortDirection } = state.tableState
  const isMomentumMode = !state.tableState.tfaMode && !state.tableState.pullbackMode
  const [viewPreset, setViewPreset] = useState<ViewPreset>('detail')
  const [expandedISIN, setExpandedISIN] = useState<string | null>(null)
  const [renderSnapshot, setRenderSnapshot] = useState<Instrument[]>(instruments)
  const [contextPreviewTick, setContextPreviewTick] = useState(0)
  const interactionKey = [
    sortColumn,
    sortDirection,
    state.tableState.typeFilter,
    state.tableState.showDeduped ? '1' : '0',
    state.tableState.filterBelowRiskFree ? '1' : '0',
    state.tableState.filterBelowAllMAs ? '1' : '0',
    state.tableState.tfaMode ? '1' : '0',
    state.tableState.pullbackMode ? '1' : '0',
    state.tableState.aiFilterActive ? '1' : '0',
    state.tableState.aiFilterQuery ?? '',
    state.settings.aumFloor.toString(),
    state.settings.riskFreeRate.toString(),
  ].join('|')
  const lastInteractionKeyRef = useRef(interactionKey)

  useEffect(() => {
    const interactionChanged = lastInteractionKeyRef.current !== interactionKey
    lastInteractionKeyRef.current = interactionKey
    if (!isPriceUpdating || interactionChanged) {
      setRenderSnapshot(instruments)
    }
  }, [instruments, interactionKey, isPriceUpdating])

  const visibleInstruments = isPriceUpdating ? renderSnapshot : instruments

  const refreshContextPreview = () => {
    setContextPreviewTick((prev) => prev + 1)
  }

  const contextPreviewByIsin = useMemo(() => {
    const map = new Map<string, RowContextPreview | null>()
    visibleInstruments.forEach((inst) => {
      map.set(inst.isin, readRowContextPreview(inst.isin))
    })
    return map
  }, [visibleInstruments, contextPreviewTick])

  const handlePresetChange = (preset: ViewPreset) => {
    setViewPreset(preset)
    const cfg = VIEW_PRESET_CONFIG[preset]
    dispatch({
      type: 'SET_TABLE_STATE',
      updates: {
        hiddenColumnGroups: cfg.hiddenGroups,
        sortColumn: cfg.sortColumn,
        sortDirection: cfg.sortDirection,
      },
    })
  }

  const forcedVisible = new Set<string>(CORE_STICKY_COLUMNS)
  const hiddenKeys = new Set(
    state.tableState.hiddenColumnGroups.flatMap((g) => COLUMN_GROUPS[g])
      .filter((key) => !forcedVisible.has(key))
  )
  const visibleColumns = COLUMNS.filter((col) => !hiddenKeys.has(col.key))
  const tableMinWidthClass = viewPreset === 'scan'
    ? 'lg:min-w-[1280px] xl:min-w-[1440px] 2xl:min-w-[1720px]'
    : viewPreset === 'risk'
      ? 'lg:min-w-[1500px] xl:min-w-[1820px] 2xl:min-w-[2140px]'
      : 'lg:min-w-[1760px] xl:min-w-[2100px] 2xl:min-w-[2420px]'

  const handleSort = (col: string) => {
    if (NON_SORTABLE.has(col)) return
    const newCol = col as SortColumn
    if (sortColumn === newCol) {
      dispatch({ type: 'SET_TABLE_STATE', updates: { sortDirection: sortDirection === 'desc' ? 'asc' : 'desc' } })
    } else {
      dispatch({ type: 'SET_TABLE_STATE', updates: { sortColumn: newCol, sortDirection: 'desc' } })
    }
  }

  const sortIcon = (col: string) => {
    if (NON_SORTABLE.has(col)) return ''
    if (sortColumn !== col) return <span className="text-muted ml-1">↕</span>
    return <span className="text-accent ml-1">{sortDirection === 'desc' ? '↓' : '↑'}</span>
  }

  if (visibleInstruments.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted font-mono">
        <div className="text-sm">No instruments loaded.</div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onOpenSidebar}
            className="btn btn-md btn-secondary focus-ring"
          >
            Load Xetra Universe
          </button>
          <span className="text-muted self-center">or enter tickers in the sidebar</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <TableToolbar
        total={state.instruments.length}
        shown={visibleInstruments.length}
        hiddenGroupCount={state.tableState.hiddenColumnGroups.length}
        sortColumn={sortColumn}
        sortDirection={sortDirection}
        isUpdating={isPriceUpdating}
        activePreset={viewPreset}
        onPresetChange={handlePresetChange}
      />

      <div className="lg:hidden space-y-2 p-3">
        {isMomentumMode && (
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            {([
              { key: 'combinedScore', label: 'Combined' },
              { key: 'riskAdjustedScore', label: 'Risk-Adj' },
              { key: 'momentumScore', label: 'Momentum' },
            ] as const).map((opt) => {
              const active = sortColumn === opt.key
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => handleSort(opt.key)}
                  className={`focus-ring rounded border px-2 py-1 font-mono text-ui-xs transition-colors ${
                    active
                      ? 'border-accent/40 bg-accent/15 text-accent'
                      : 'border-border text-muted hover:text-gray-300'
                  }`}
                  aria-label={`Sort by ${opt.label}`}
                >
                  {opt.label}
                  {active ? ` ${sortDirection === 'desc' ? '↓' : '↑'}` : ''}
                </button>
              )
            })}
          </div>
        )}

        {visibleInstruments.map((inst) => (
          <MobileInstrumentCard
            key={inst.isin}
            inst={inst}
            expanded={expandedISIN === inst.isin}
            onToggleExpanded={() => setExpandedISIN(expandedISIN === inst.isin ? null : inst.isin)}
            onTogglePortfolio={() => dispatch({ type: 'TOGGLE_PORTFOLIO', isin: inst.isin })}
            onRemove={() => dispatch({ type: 'REMOVE_INSTRUMENT', isin: inst.isin })}
          />
        ))}
      </div>

      <div className="hidden lg:block">
      <table className={`w-full text-xs font-mono border-collapse ${tableMinWidthClass}`}>
        <thead className="sticky top-0 z-10 bg-surface border-b border-border">
          <tr>
            {visibleColumns.map((col) => (
              <th
                key={col.key}
                title={col.title}
                className={`px-2 py-1.5 font-semibold text-muted whitespace-nowrap
                  ${col.align === 'left' ? 'text-left' : 'text-right'}
                  ${isStickyColumnKey(col.key) ? `sticky z-20 bg-surface border-r border-border/50 ${stickyWidthClass(col.key)}` : ''}
                  select-none`}
                style={stickyColumnStyle(col.key)}
              >
                {NON_SORTABLE.has(col.key) ? (
                  col.label
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSort(col.key)}
                    className="focus-ring inline-flex items-center hover:text-gray-300"
                    aria-label={`Sort by ${col.label}`}
                  >
                    {col.label}
                    {sortIcon(col.key)}
                  </button>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody key={`${sortColumn}:${sortDirection}:${state.tableState.typeFilter}:${state.tableState.showDeduped}:${state.tableState.tfaMode}:${state.tableState.pullbackMode}`}>
          {visibleInstruments.map((inst, idx) => {
            const isExpanded = expandedISIN === inst.isin
            const rowBg = idx % 2 === 0 ? 'bg-bg' : 'bg-surface'
            const portfolioClass = inst.inPortfolio ? 'bg-accent/5' : ''
            const stickyBgClass = inst.inPortfolio ? 'bg-accent/5' : rowBg
            const hasGroup = inst.dedupCandidates && inst.dedupCandidates.length > 0
            const contextPreview = contextPreviewByIsin.get(inst.isin) ?? null

            return (
              <React.Fragment key={inst.isin}>
                <tr
                  id={`row-${inst.isin}`}
                  data-isin={inst.isin}
                  className={`${rowBg} ${portfolioClass} hover:bg-surface2 border-b border-border/30 cursor-pointer group`}
                  onClick={() => setExpandedISIN(isExpanded ? null : inst.isin)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setExpandedISIN(isExpanded ? null : inst.isin)
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-expanded={isExpanded}
                >
                  {/* Name */}
                  <td
                    className={`px-2 py-1.5 text-left sticky z-[5] left-0 border-r border-border/50 ${stickyBgClass} ${stickyWidthClass('displayName')}`}
                    style={stickyColumnStyle('displayName')}
                  >
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); dispatch({ type: 'TOGGLE_PORTFOLIO', isin: inst.isin }) }}
                        className={`focus-ring text-[12px] leading-none ${inst.inPortfolio ? 'text-amber-400' : 'text-muted hover:text-gray-300'}`}
                        title={inst.inPortfolio ? 'Remove from portfolio' : 'Add to portfolio'}
                        aria-label={inst.inPortfolio ? `Remove ${inst.displayName} from portfolio` : `Add ${inst.displayName} to portfolio`}
                      >
                        ★
                      </button>
                      <span className="truncate text-gray-200" title={inst.displayName}>{inst.displayName}</span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); dispatch({ type: 'REMOVE_INSTRUMENT', isin: inst.isin }) }}
                        className="focus-ring text-[11px] text-muted hover:text-red-400 ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Hide/remove instrument"
                        aria-label={`Hide ${inst.displayName}`}
                      >
                        ×
                      </button>
                      {hasGroup && (
                        <span className="text-[9px] text-accent/70 ml-1 shrink-0" title={`${inst.dedupCandidates!.length} more ETFs in this group`}>
                          +{inst.dedupCandidates!.length}
                        </span>
                      )}
                      {inst.priceFetched && (
                        <Sparkline closes={inst.closes} />
                      )}
                    </div>
                    <div className="text-muted text-[10px] mt-0.5 flex items-center gap-1.5">
                      <TypeBadge type={inst.type} />
                      <span>
                        <span
                          className="cursor-pointer hover:text-gray-200"
                          title="Double-click to search ISIN"
                          onDoubleClick={(e) => { e.stopPropagation(); openIsinSearch(inst.isin) }}
                        >
                          {inst.isin}
                        </span>
                        {inst.isin?.startsWith('WKN:') && <span className="text-[9px] ml-1 text-amber-300">(temp)</span>}
                        {inst.isin?.startsWith('TICKER:') && <span className="text-[9px] ml-1 text-amber-300">(temp)</span>}
                        {inst.currency && ` · ${inst.currency}`}
                      </span>
                    </div>
                    {inst.type === 'Stock' && inst.sector && (
                      <div className="text-[10px] text-muted mt-0.5 truncate" title={inst.industry ?? inst.sector}>
                        {inst.sector}
                        {inst.industry && (
                          <span className="text-muted/60"> · {inst.industry}</span>
                        )}
                      </div>
                    )}
                    {(inst.type === 'Stock' || inst.type === 'Unknown') && (
                      <RowSummaryChips preview={contextPreview} />
                    )}
                  </td>

                  {!hiddenKeys.has('riskAdjustedScore') && (
                    <td className="px-2 py-1.5 text-right">
                      <ScoreCell score={inst.riskAdjustedScore} rank={inst.riskAdjustedRank} colorFn={scoreColor} />
                    </td>
                  )}

                  {!hiddenKeys.has('momentumScore') && (
                    <td className="px-2 py-1.5 text-right">
                      <ScoreCell score={inst.momentumScore} rank={inst.momentumRank} colorFn={scoreColor} />
                    </td>
                  )}

                  {!hiddenKeys.has('combinedScore') && (
                    <td
                      className={`px-2 py-1.5 text-right sticky z-[4] border-r border-border/50 ${stickyBgClass} ${stickyWidthClass('combinedScore')}`}
                      style={stickyColumnStyle('combinedScore')}
                    >
                      <ScoreCell score={inst.combinedScore} rank={inst.combinedRank} colorFn={scoreColor} />
                    </td>
                  )}

                  {!hiddenKeys.has('ma') && (
                    <td className="px-2 py-1.5 text-right"><MaCell inst={inst} /></td>
                  )}

                  {!hiddenKeys.has('sellingThreshold') && (
                    <td className="px-2 py-1.5 text-right">
                      {inst.sellingThreshold != null ? (
                        <span className="text-amber-400" title={`ATR(20): ${inst.atr20?.toFixed(4) ?? '—'}`}>
                          {fmtPrice(inst.sellingThreshold)}
                          {inst.closes?.length ? (
                            <span className="text-muted text-[10px] ml-1">
                              {fmtPct(inst.sellingThreshold / inst.closes[inst.closes.length - 1] - 1)}
                            </span>
                          ) : null}
                        </span>
                      ) : inst.priceFetched ? '—' : ''}
                    </td>
                  )}

                  {!hiddenKeys.has('r1m') && (
                    <td className={`px-2 py-1.5 text-right ${returnColor(inst.r1m)}`}>{fmtPct(inst.r1m)}</td>
                  )}
                  {!hiddenKeys.has('r3m') && (
                    <td className={`px-2 py-1.5 text-right ${returnColor(inst.r3m)}`}>{fmtPct(inst.r3m)}</td>
                  )}
                  {!hiddenKeys.has('r6m') && (
                    <td className={`px-2 py-1.5 text-right ${returnColor(inst.r6m)}`}>{fmtPct(inst.r6m)}</td>
                  )}

                  {!hiddenKeys.has('vola') && (
                    <td className="px-2 py-1.5 text-right text-muted">{fmtVola(inst.vola)}</td>
                  )}

                  {!hiddenKeys.has('rsi14') && (
                    <td className={`px-2 py-1.5 text-right ${rsiColor(inst.rsi14)}`}>
                      {inst.rsi14 != null ? inst.rsi14.toFixed(1) : '—'}
                    </td>
                  )}

                  {!hiddenKeys.has('aum') && (
                    <td className="px-2 py-1.5 text-right text-gray-300">
                      {inst.aum != null ? fmtAUM(inst.aum) : (inst.justEtfFetched ? '—' : '')}
                    </td>
                  )}

                  {!hiddenKeys.has('ter') && (
                    <td className="px-2 py-1.5 text-right text-gray-300">
                      {inst.ter != null ? fmtTER(inst.ter) : (inst.justEtfFetched ? '—' : '')}
                    </td>
                  )}

                  {!hiddenKeys.has('pe') && (
                    <td className="px-2 py-1.5 text-right text-gray-300">
                      {inst.pe != null ? fmtPE(inst.pe) : (inst.fundamentalsFetched ? '—' : '')}
                    </td>
                  )}

                  {!hiddenKeys.has('pb') && (
                    <td className="px-2 py-1.5 text-right text-gray-300">
                      {inst.pb != null ? fmtRatio(inst.pb) : (inst.fundamentalsFetched ? '—' : '')}
                    </td>
                  )}

                  {!hiddenKeys.has('earningsYield') && (
                    <td className="px-2 py-1.5 text-right">
                      <MetricCell value={inst.earningsYield} rank={inst.earningsYieldRank} fmt={(v) => fmtPct(v)} />
                    </td>
                  )}

                  {!hiddenKeys.has('returnOnAssets') && (
                    <td className="px-2 py-1.5 text-right">
                      <MetricCell value={inst.returnOnAssets} rank={inst.returnOnAssetsRank} fmt={(v) => fmtPct(v)} />
                    </td>
                  )}

                  {!hiddenKeys.has('drawFromHigh') && (
                    <td className={`px-2 py-1.5 text-right ${returnColor(inst.drawFromHigh)}`}>{fmtPct(inst.drawFromHigh)}</td>
                  )}

                  {!hiddenKeys.has('drawFrom5YHigh') && (
                    <td className={`px-2 py-1.5 text-right ${returnColor(inst.drawFrom5YHigh)}`}>{fmtPct(inst.drawFrom5YHigh)}</td>
                  )}

                  {!hiddenKeys.has('drawFrom7YHigh') && (
                    <td className={`px-2 py-1.5 text-right ${returnColor(inst.drawFrom7YHigh)}`}>{fmtPct(inst.drawFrom7YHigh)}</td>
                  )}

                  {!hiddenKeys.has('levyRS') && (
                    <td className="px-2 py-1.5 text-right text-gray-300">
                      {inst.levyRS != null ? inst.levyRS.toFixed(2) : '—'}
                    </td>
                  )}

                  {!hiddenKeys.has('weeklyRsi14') && (
                    <td className="px-2 py-1.5 text-right text-gray-300">
                      {inst.weeklyRsi14 != null ? inst.weeklyRsi14.toFixed(1) : '—'}
                    </td>
                  )}

                  {!hiddenKeys.has('weeklyVolaRatio') && (
                    <td className="px-2 py-1.5 text-right text-gray-300">
                      {inst.weeklyVolaRatio != null ? inst.weeklyVolaRatio.toFixed(2) : '—'}
                    </td>
                  )}

                  {!hiddenKeys.has('tfaTScore') && (
                    <td className="px-2 py-1.5 text-right">
                      {inst.tfaTScore != null ? inst.tfaTScore.toFixed(2) : <span className="text-muted">—</span>}
                    </td>
                  )}

                  {!hiddenKeys.has('tfaFScore') && (
                    <td className="px-2 py-1.5 text-right">
                      {inst.tfaFScore != null ? inst.tfaFScore.toFixed(2) : <span className="text-muted">—</span>}
                    </td>
                  )}

                  {!hiddenKeys.has('tfaTScore5Y') && (
                    <td className="px-2 py-1.5 text-right">
                      {inst.tfaTScore5Y != null ? inst.tfaTScore5Y.toFixed(2) : <span className="text-muted">—</span>}
                    </td>
                  )}

                  {!hiddenKeys.has('tfaFScore5Y') && (
                    <td className="px-2 py-1.5 text-right">
                      {inst.tfaFScore5Y != null ? inst.tfaFScore5Y.toFixed(2) : <span className="text-muted">—</span>}
                    </td>
                  )}

                  {!hiddenKeys.has('tfaScore') && (
                    <td className="px-2 py-1.5 text-right">
                      <TfaScoreCell score={inst.tfaScore} ko={inst.tfaKO} />
                    </td>
                  )}

                  {!hiddenKeys.has('tfaPhase') && (
                    <td
                      className={`px-2 py-1.5 text-right sticky z-[4] border-r border-border/50 ${stickyBgClass} ${stickyWidthClass('tfaPhase')}`}
                      style={stickyColumnStyle('tfaPhase')}
                    >
                      <TfaPhaseBadge
                        phase={inst.tfaPhase}
                        reason={inst.tfaRejectReason}
                        summary={generateTfaSummary(inst)}
                        inst={inst}
                      />
                    </td>
                  )}

                  {!hiddenKeys.has('tfaCrossoverDaysAgo') && (
                    <td className="px-2 py-1.5 text-right text-gray-300">
                      {fmtAge(inst.tfaCrossoverDaysAgo)}
                    </td>
                  )}

                  {!hiddenKeys.has('breakoutScore') && (
                    <td className="px-2 py-1.5 text-right">
                      <BreakoutBadge score={inst.breakoutScore} flags={inst.breakoutFlags} />
                    </td>
                  )}

                  {!hiddenKeys.has('breakoutAgeDays') && (
                    <td className="px-2 py-1.5 text-right text-gray-300">
                      {fmtAge(inst.breakoutAgeDays)}
                    </td>
                  )}

                  {!hiddenKeys.has('pullbackScore') && (
                    <td className="px-2 py-1.5 text-right">
                      <PullbackScoreCell score={inst.pullbackScore} />
                    </td>
                  )}
                  {!hiddenKeys.has('pullbackStop') && (
                    <td className="px-2 py-1.5 text-right font-mono text-[12px] text-red-400">
                      {inst.pullbackStop != null
                        ? inst.pullbackStop.toFixed(2)
                        : <span className="text-muted">—</span>}
                    </td>
                  )}
                  {!hiddenKeys.has('pullbackTarget') && (
                    <td className="px-2 py-1.5 text-right font-mono text-[12px] text-green-400">
                      {inst.pullbackTarget != null
                        ? inst.pullbackTarget.toFixed(2)
                        : <span className="text-muted">—</span>}
                    </td>
                  )}
                </tr>

                {isExpanded && (
                  <ExpandedDetail
                    inst={inst}
                    atrMultiplier={state.settings.atrMultiplier}
                    allInstruments={allInstruments}
                    onLoadPrices={fetchSingleInstrumentPrices}
                    onLoadAnalyst={fetchSingleInstrumentAnalyst}
                    viewPreset={viewPreset}
                    onContextUpdated={refreshContextPreview}
                    onTogglePortfolio={(isin) => dispatch({ type: 'TOGGLE_PORTFOLIO', isin })}
                    onRemove={(isin) => dispatch({ type: 'REMOVE_INSTRUMENT', isin })}
                    colSpan={visibleColumns.length}
                    hiddenKeys={hiddenKeys}
                  />
                )}
              </React.Fragment>
            )
          })}
        </tbody>
      </table>
      </div>
    </div>
  )
}
