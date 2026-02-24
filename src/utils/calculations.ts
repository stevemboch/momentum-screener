import type { Instrument, MomentumWeights } from '../types'

// ─── Return Calculation ──────────────────────────────────────────────────────

// Trading days per period — use slightly fewer than exact to tolerate missing days/holidays
const TRADING_DAYS = { r1m: 21, r3m: 63, r6m: 125 }

export function calculateReturns(closes: number[]): {
  r1m: number | null
  r3m: number | null
  r6m: number | null
} {
  const n = closes.length
  const result = { r1m: null as number | null, r3m: null as number | null, r6m: null as number | null }
  if (n < 2) return result

  const last = closes[n - 1]
  const calc = (days: number) => {
    const target = n - 1 - days
    if (target < 0) return null  // not enough data
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
  if (n < 22) return null // need at least 1 month

  // Use last 126 trading days (6 months)
  const slice = closes.slice(Math.max(0, n - 127))
  const dailyReturns: number[] = []
  for (let i = 1; i < slice.length; i++) {
    if (slice[i - 1] > 0) {
      dailyReturns.push((slice[i] - slice[i - 1]) / slice[i - 1])
    }
  }
  if (dailyReturns.length < 10) return null

  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
  const variance =
    dailyReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (dailyReturns.length - 1)

  return Math.sqrt(variance) * Math.sqrt(252) // annualised
}

// ─── Momentum Score ──────────────────────────────────────────────────────────

export function calculateMomentumScore(
  r1m: number | null,
  r3m: number | null,
  r6m: number | null,
  weights: MomentumWeights
): number | null {
  const available: { val: number; w: number }[] = []
  if (r1m !== null) available.push({ val: r1m, w: weights.w1m })
  if (r3m !== null) available.push({ val: r3m, w: weights.w3m })
  if (r6m !== null) available.push({ val: r6m, w: weights.w6m })

  if (available.length === 0) return null

  // Re-normalise weights to available periods
  const totalW = available.reduce((s, a) => s + a.w, 0)
  if (totalW === 0) return null

  return available.reduce((sum, a) => sum + a.val * (a.w / totalW), 0)
}

// ─── Sharpe Score ─────────────────────────────────────────────────────────────

export function calculateSharpeScore(
  momentumScore: number | null,
  vola: number | null
): number | null {
  if (momentumScore === null || vola === null || vola === 0) return null
  return momentumScore / vola
}

// ─── Rank All Instruments ────────────────────────────────────────────────────

export function applyRanks(instruments: Instrument[]): Instrument[] {
  const withMomentum = instruments
    .map((inst, i) => ({ inst, i }))
    .filter(({ inst }) => inst.momentumScore !== null && inst.momentumScore !== undefined)
    .sort((a, b) => (b.inst.momentumScore ?? 0) - (a.inst.momentumScore ?? 0))

  const withSharpe = instruments
    .map((inst, i) => ({ inst, i }))
    .filter(({ inst }) => inst.sharpeScore !== null && inst.sharpeScore !== undefined)
    .sort((a, b) => (b.inst.sharpeScore ?? 0) - (a.inst.sharpeScore ?? 0))

  const withValue = instruments
    .map((inst, i) => ({ inst, i }))
    .filter(({ inst }) => inst.valueScore !== null && inst.valueScore !== undefined)
    .sort((a, b) => (a.inst.valueScore ?? 999) - (b.inst.valueScore ?? 999)) // lower = better

  // Clone all instruments
  const result = instruments.map((inst) => ({ ...inst }))

  withMomentum.forEach(({ inst }, rank) => {
    const idx = result.findIndex((r) => r.isin === inst.isin)
    if (idx >= 0) result[idx].momentumRank = rank + 1
  })

  withSharpe.forEach(({ inst }, rank) => {
    const idx = result.findIndex((r) => r.isin === inst.isin)
    if (idx >= 0) result[idx].sharpeRank = rank + 1
  })

  withValue.forEach(({ inst }, rank) => {
    const idx = result.findIndex((r) => r.isin === inst.isin)
    if (idx >= 0) result[idx].valueRank = rank + 1
  })

  return result
}

// ─── Value Score ─────────────────────────────────────────────────────────────

export function calculateValueScores(instruments: Instrument[]): Instrument[] {
  // For stocks: Magic Formula
  // Earnings Yield = ebitda / enterpriseValue
  // Return on Capital = returnOnAssets

  // For ETFs: simplified P/E + P/B score
  // Earnings Yield = 1 / PE
  // Book Yield = 1 / PB

  // Lower rank = better value
  // Rank each metric separately, then sum ranks

  const etfs = instruments.filter((i) => i.type === 'ETF' || i.type === 'ETC')
  const stocks = instruments.filter((i) => i.type === 'Stock')

  // ETF value scoring
  const etfEY = etfs
    .filter((e) => e.pe !== null && e.pe !== undefined && e.pe > 0)
    .map((e) => ({ isin: e.isin, ey: 1 / (e.pe as number) }))
    .sort((a, b) => b.ey - a.ey)

  const etfBY = etfs
    .filter((e) => e.pb !== null && e.pb !== undefined && e.pb > 0)
    .map((e) => ({ isin: e.isin, by: 1 / (e.pb as number) }))
    .sort((a, b) => b.by - a.by)

  const etfEYRanks = new Map(etfEY.map((e, i) => [e.isin, i + 1]))
  const etfBYRanks = new Map(etfBY.map((e, i) => [e.isin, i + 1]))

  // Stock value scoring (Magic Formula)
  const stockEY = stocks
    .filter(
      (s) =>
        s.ebitda !== null &&
        s.ebitda !== undefined &&
        s.enterpriseValue !== null &&
        s.enterpriseValue !== undefined &&
        (s.enterpriseValue as number) > 0
    )
    .map((s) => ({ isin: s.isin, ey: (s.ebitda as number) / (s.enterpriseValue as number) }))
    .sort((a, b) => b.ey - a.ey)

  const stockROC = stocks
    .filter((s) => s.returnOnAssets !== null && s.returnOnAssets !== undefined)
    .map((s) => ({ isin: s.isin, roc: s.returnOnAssets as number }))
    .sort((a, b) => b.roc - a.roc)

  const stockEYRanks = new Map(stockEY.map((s, i) => [s.isin, i + 1]))
  const stockROCRanks = new Map(stockROC.map((s, i) => [s.isin, i + 1]))

  return instruments.map((inst) => {
    const updated = { ...inst }

    if (inst.type === 'ETF' || inst.type === 'ETC') {
      const eyRank = etfEYRanks.get(inst.isin)
      const byRank = etfBYRanks.get(inst.isin)
      if (eyRank !== undefined && byRank !== undefined) {
        updated.valueScore = eyRank + byRank
        updated.valueScoreModel = 'etf'
      } else if (eyRank !== undefined) {
        updated.valueScore = eyRank * 2 // normalise to comparable scale
        updated.valueScoreModel = 'etf'
      } else if (byRank !== undefined) {
        updated.valueScore = byRank * 2
        updated.valueScoreModel = 'etf'
      } else {
        updated.valueScore = null
      }
    }

    if (inst.type === 'Stock') {
      const eyRank = stockEYRanks.get(inst.isin)
      const rocRank = stockROCRanks.get(inst.isin)
      if (eyRank !== undefined && rocRank !== undefined) {
        updated.valueScore = eyRank + rocRank
        updated.valueScoreModel = 'magic-formula'
      } else if (inst.pe !== null && inst.pe !== undefined && inst.pb !== null && inst.pb !== undefined) {
        // Fallback to ETF-style scoring
        const feyRank = etfEYRanks.get(inst.isin)
        const fbyRank = etfBYRanks.get(inst.isin)
        if (feyRank !== undefined || fbyRank !== undefined) {
          updated.valueScore = (feyRank ?? 0) + (fbyRank ?? 0)
          updated.valueScoreModel = 'fallback'
        }
      } else {
        updated.valueScore = null
      }
    }

    return updated
  })
}

// ─── Recalculate All Scores ───────────────────────────────────────────────────

export function recalculateAll(instruments: Instrument[], weights: MomentumWeights): Instrument[] {
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
    }

    // Derived fundamentals
    if (inst.pe !== null && inst.pe !== undefined && inst.pe > 0) {
      updated.earningsYield = 1 / inst.pe
    }

    return updated
  })

  const withValue = calculateValueScores(withScores)
  return applyRanks(withValue)
}
