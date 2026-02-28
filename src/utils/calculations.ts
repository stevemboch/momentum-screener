import type { Instrument, MomentumWeights } from '../types'

const TRADING_DAYS = { r1m: 21, r3m: 63, r6m: 125 }

// ─── Returns ─────────────────────────────────────────────────────────────────

export function calculateReturns(closes: number[]) {
  const n = closes.length
  const result = { r1m: null as number | null, r3m: null as number | null, r6m: null as number | null }
  if (n < 2) return result
  const last = closes[n - 1]
  const calc = (days: number) => {
    const target = n - 1 - days
    if (target < 0) return null
    const base = closes[target]
    if (!base || base === 0) return null
    return (last - base) / base
  }
  result.r1m = calc(TRADING_DAYS.r1m)
  result.r3m = calc(TRADING_DAYS.r3m)
  result.r6m = calc(TRADING_DAYS.r6m)
  return result
}

// ─── Volatility ──────────────────────────────────────────────────────────────

export function calculateVola(closes: number[]): number | null {
  const n = closes.length
  if (n < 22) return null
  const slice = closes.slice(Math.max(0, n - 127))
  const dailyReturns: number[] = []
  for (let i = 1; i < slice.length; i++) {
    if (slice[i - 1] > 0) dailyReturns.push((slice[i] - slice[i - 1]) / slice[i - 1])
  }
  if (dailyReturns.length < 10) return null
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
  const variance = dailyReturns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / (dailyReturns.length - 1)
  return Math.sqrt(variance) * Math.sqrt(252)
}

// ─── Moving Averages ─────────────────────────────────────────────────────────

export function calculateMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null
  const slice = closes.slice(closes.length - period)
  return slice.reduce((a, b) => a + b, 0) / period
}

export function calculateMAs(closes: number[]): {
  ma10: number | null
  ma50: number | null
  ma100: number | null
  ma200: number | null
  aboveMa10: boolean | null
  aboveMa50: boolean | null
  aboveMa100: boolean | null
  aboveMa200: boolean | null
} {
  if (!closes || closes.length === 0) {
    return { ma10: null, ma50: null, ma100: null, ma200: null,
             aboveMa10: null, aboveMa50: null, aboveMa100: null, aboveMa200: null }
  }
  const last = closes[closes.length - 1]
  const ma10 = calculateMA(closes, 10)
  const ma50 = calculateMA(closes, 50)
  const ma100 = calculateMA(closes, 100)
  const ma200 = calculateMA(closes, 200)
  return {
    ma10, ma50, ma100, ma200,
    aboveMa10:  ma10  !== null ? last > ma10  : null,
    aboveMa50:  ma50  !== null ? last > ma50  : null,
    aboveMa100: ma100 !== null ? last > ma100 : null,
    aboveMa200: ma200 !== null ? last > ma200 : null,
  }
}

// ─── ATR(20) ─────────────────────────────────────────────────────────────────
// True Range uses high/low when available, falls back to close-only approximation

export function calculateATR(
  closes: number[],
  highs?: number[],
  lows?: number[],
  period = 20
): number | null {
  const n = closes.length
  if (n < period + 1) return null

  const hasHL = highs && lows && highs.length === n && lows.length === n

  const trValues: number[] = []
  for (let i = 1; i < n; i++) {
    const prevClose = closes[i - 1]
    if (hasHL) {
      const h = highs![i]
      const l = lows![i]
      const tr = Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose))
      trValues.push(tr)
    } else {
      // Close-only approximation: TR ≈ |ΔClose|
      trValues.push(Math.abs(closes[i] - prevClose))
    }
  }

  // Wilder smoothing (EMA with alpha = 1/period)
  const alpha = 1 / period
  let atr = trValues.slice(0, period).reduce((a, b) => a + b, 0) / period
  for (let i = period; i < trValues.length; i++) {
    atr = atr * (1 - alpha) + trValues[i] * alpha
  }
  return atr
}

// ─── Selling Threshold ───────────────────────────────────────────────────────

export function calculateSellingThreshold(
  closes: number[],
  atrMultiplier: number,
  highs?: number[],
  lows?: number[]
): { atr20: number | null; sellingThreshold: number | null } {
  const atr20 = calculateATR(closes, highs, lows, 20)
  if (atr20 === null || closes.length === 0) return { atr20: null, sellingThreshold: null }
  const lastPrice = closes[closes.length - 1]
  return { atr20, sellingThreshold: lastPrice - atrMultiplier * atr20 }
}

// ─── Momentum Score ───────────────────────────────────────────────────────────

export function calculateMomentumScore(
  r1m: number | null, r3m: number | null, r6m: number | null,
  weights: MomentumWeights
): number | null {
  const available: { val: number; w: number }[] = []
  if (r1m !== null) available.push({ val: r1m, w: weights.w1m })
  if (r3m !== null) available.push({ val: r3m, w: weights.w3m })
  if (r6m !== null) available.push({ val: r6m, w: weights.w6m })
  if (available.length === 0) return null
  const totalW = available.reduce((s, a) => s + a.w, 0)
  if (totalW === 0) return null
  return available.reduce((sum, a) => sum + a.val * (a.w / totalW), 0)
}

export function calculateSharpeScore(momentumScore: number | null, vola: number | null): number | null {
  if (momentumScore === null || vola === null || vola === 0) return null
  return momentumScore / vola
}

// ─── Combined Score ──────────────────────────────────────────────────────────
// Simple average of momentumScore and sharpeScore, both higher = better.
// Gives a single "best of both" metric to sort by.

export function calculateCombinedScore(
  momentumPercentile: number | null | undefined,
  sharpePercentile: number | null | undefined,
): number | null {
  if (momentumPercentile != null && sharpePercentile != null) {
    return (momentumPercentile + sharpePercentile) / 2
  }
  if (momentumPercentile != null) return momentumPercentile
  if (sharpePercentile != null) return sharpePercentile
  return null
}

function buildPercentileMap(
  instruments: Instrument[],
  field: keyof Instrument
): Map<string, number> {
  const items = instruments
    .map((inst) => ({ isin: inst.isin, value: inst[field] as number | null | undefined }))
    .filter((x) => x.value != null) as { isin: string; value: number }[]
  if (items.length === 0) return new Map()

  // Higher is better
  items.sort((a, b) => b.value - a.value)

  const n = items.length
  const map = new Map<string, number>()
  let i = 0
  while (i < n) {
    let j = i + 1
    while (j < n && items[j].value === items[i].value) j++
    const avgRankIdx = (i + (j - 1)) / 2
    const percentile = n === 1 ? 1 : 1 - (avgRankIdx / (n - 1))
    for (let k = i; k < j; k++) map.set(items[k].isin, percentile)
    i = j
  }
  return map
}

// ─── Ranks ───────────────────────────────────────────────────────────────────

export function applyRanks(instruments: Instrument[]): Instrument[] {
  const result = instruments.map((inst) => ({ ...inst }))

  const rank = (
    arr: { inst: Instrument; i: number }[],
    field: keyof Instrument,
    desc: boolean
  ) => {
    arr
      .filter(({ inst }) => inst[field] !== null && inst[field] !== undefined)
      .sort((a, b) => {
        const av = (a.inst[field] as number)
        const bv = (b.inst[field] as number)
        return desc ? bv - av : av - bv
      })
      .forEach(({ inst }, rank) => {
        const idx = result.findIndex((r) => r.isin === inst.isin)
        if (idx >= 0) (result[idx] as any)[`${String(field)}Rank`] = rank + 1
      })
  }

  const indexed = instruments.map((inst, i) => ({ inst, i }))
  rank(indexed, 'momentumScore', true)
  rank(indexed, 'sharpeScore', true)
  rank(indexed, 'combinedScore', true)
  rank(indexed, 'valueScore', false) // lower = better

  return result
}

// ─── Value Score ─────────────────────────────────────────────────────────────

export function calculateValueScores(instruments: Instrument[]): Instrument[] {
  const etfs = instruments.filter((i) => i.type === 'ETF' || i.type === 'ETC')
  const stocks = instruments.filter((i) => i.type === 'Stock')

  const etfEY = etfs.filter((e) => e.pe != null && e.pe! > 0)
    .map((e) => ({ isin: e.isin, ey: 1 / e.pe! })).sort((a, b) => b.ey - a.ey)
  const etfBY = etfs.filter((e) => e.pb != null && e.pb! > 0)
    .map((e) => ({ isin: e.isin, by: 1 / e.pb! })).sort((a, b) => b.by - a.by)

  const etfEYRanks = new Map(etfEY.map((e, i) => [e.isin, i + 1]))
  const etfBYRanks = new Map(etfBY.map((e, i) => [e.isin, i + 1]))

  const stockEY = stocks
    .filter((s) => s.ebitda != null && s.enterpriseValue != null && s.enterpriseValue! > 0)
    .map((s) => ({ isin: s.isin, ey: s.ebitda! / s.enterpriseValue! }))
    .sort((a, b) => b.ey - a.ey)
  const stockROC = stocks.filter((s) => s.returnOnAssets != null)
    .map((s) => ({ isin: s.isin, roc: s.returnOnAssets! })).sort((a, b) => b.roc - a.roc)

  const stockEYRanks = new Map(stockEY.map((s, i) => [s.isin, i + 1]))
  const stockROCRanks = new Map(stockROC.map((s, i) => [s.isin, i + 1]))

  return instruments.map((inst) => {
    const updated = { ...inst }
    if (inst.type === 'ETF' || inst.type === 'ETC') {
      const eyR = etfEYRanks.get(inst.isin)
      const byR = etfBYRanks.get(inst.isin)
      if (eyR !== undefined && byR !== undefined) { updated.valueScore = eyR + byR; updated.valueScoreModel = 'etf' }
      else if (eyR !== undefined) { updated.valueScore = eyR * 2; updated.valueScoreModel = 'etf' }
      else if (byR !== undefined) { updated.valueScore = byR * 2; updated.valueScoreModel = 'etf' }
      else updated.valueScore = null
    }
    if (inst.type === 'Stock') {
      const eyR = stockEYRanks.get(inst.isin)
      const rocR = stockROCRanks.get(inst.isin)
      if (eyR !== undefined && rocR !== undefined) { updated.valueScore = eyR + rocR; updated.valueScoreModel = 'magic-formula' }
      else updated.valueScore = null
    }
    return updated
  })
}

// ─── Recalculate All ──────────────────────────────────────────────────────────

export function recalculateAll(
  instruments: Instrument[],
  weights: MomentumWeights,
  atrMultiplier = 4
): Instrument[] {
  const withScores = instruments.map((inst) => {
    const updated = { ...inst }
    if (inst.closes && inst.closes.length > 0) {
      const { r1m, r3m, r6m } = calculateReturns(inst.closes)
      updated.r1m = r1m
      updated.r3m = r3m
      updated.r6m = r6m
      updated.vola = calculateVola(inst.closes)
      updated.momentumScore = calculateMomentumScore(r1m, r3m, r6m, weights)
      updated.sharpeScore = calculateSharpeScore(updated.momentumScore, updated.vola)
      updated.combinedScore = calculateCombinedScore(updated.momentumScore, updated.sharpeScore)

      // Moving averages
      const mas = calculateMAs(inst.closes)
      updated.ma10 = mas.ma10
      updated.ma50 = mas.ma50
      updated.ma100 = mas.ma100
      updated.ma200 = mas.ma200
      updated.aboveMa10 = mas.aboveMa10
      updated.aboveMa50 = mas.aboveMa50
      updated.aboveMa100 = mas.aboveMa100
      updated.aboveMa200 = mas.aboveMa200

      // ATR + Selling Threshold
      const { atr20, sellingThreshold } = calculateSellingThreshold(
        inst.closes, atrMultiplier, inst.highs, inst.lows
      )
      updated.atr20 = atr20
      updated.sellingThreshold = sellingThreshold
    }
    if (inst.pe != null && inst.pe > 0) updated.earningsYield = 1 / inst.pe
    return updated
  })

  const momentumPct = buildPercentileMap(withScores, 'momentumScore')
  const sharpePct = buildPercentileMap(withScores, 'sharpeScore')
  const withCombined = withScores.map((inst) => {
    const combinedScore = calculateCombinedScore(
      momentumPct.get(inst.isin),
      sharpePct.get(inst.isin)
    )
    return { ...inst, combinedScore }
  })

  const withValue = calculateValueScores(withCombined)
  return applyRanks(withValue)
}
