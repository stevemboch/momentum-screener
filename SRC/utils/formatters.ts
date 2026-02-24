// ─── Number Formatters ────────────────────────────────────────────────────────

export function fmtAUM(value: number | null | undefined): string {
  if (value == null) return '—'
  if (value >= 1e12) return `€${(value / 1e12).toFixed(2)}T`
  if (value >= 1e9) return `€${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `€${(value / 1e6).toFixed(0)}M`
  return `€${value.toFixed(0)}`
}

export function fmtTER(value: number | null | undefined): string {
  if (value == null) return '—'
  return `${value.toFixed(2)}%`
}

export function fmtPct(value: number | null | undefined, decimals = 1): string {
  if (value == null) return '—'
  return `${(value * 100).toFixed(decimals)}%`
}

export function fmtRatio(value: number | null | undefined, decimals = 1): string {
  if (value == null) return '—'
  return value.toFixed(decimals)
}

export function fmtScore(value: number | null | undefined, rank: number | undefined): string {
  if (value == null) return '—'
  const scoreStr = value.toFixed(3)
  if (rank !== undefined) return `${scoreStr} (${rank})`
  return scoreStr
}

export function fmtVola(value: number | null | undefined): string {
  if (value == null) return '—'
  return `${(value * 100).toFixed(1)}%`
}

export function fmtPE(value: number | null | undefined): string {
  if (value == null) return '—'
  return value.toFixed(1)
}

export function fmtEY(value: number | null | undefined): string {
  if (value == null) return '—'
  return `${(value * 100).toFixed(2)}%`
}

// Return color class based on value
export function returnColor(value: number | null | undefined): string {
  if (value == null) return 'text-muted'
  if (value > 0.02) return 'text-green-400'
  if (value > 0) return 'text-green-600'
  if (value < -0.02) return 'text-red-400'
  if (value < 0) return 'text-red-600'
  return 'text-gray-400'
}

export function scoreColor(value: number | null | undefined): string {
  if (value == null) return 'text-muted'
  if (value > 0.1) return 'text-green-400'
  if (value > 0.05) return 'text-green-600'
  if (value > 0) return 'text-gray-300'
  if (value < -0.05) return 'text-red-400'
  return 'text-red-600'
}
