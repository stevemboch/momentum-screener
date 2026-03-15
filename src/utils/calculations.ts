import type { Instrument, MomentumWeights } from '../types'
import { calculateBreakout } from './breakoutUtils'

const TRADING_DAYS = { r1m: 21, r3m: 63, r6m: 126 }

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

export function buildMAHistory(closes: number[], period: number): (number | null)[] {
  const n = closes.length
  const result: (number | null)[] = new Array(n).fill(null)
  if (n < period) return result
  let sum = 0
  for (let i = 0; i < n; i++) {
    sum += closes[i]
    if (i >= period) sum -= closes[i - period]
    if (i >= period - 1) result[i] = sum / period
  }
  return result
}

export function calculateMACrossover(
  closes: number[],
  maValues: (number | null)[],
  lookback = 10
): boolean {
  const n = closes.length
  if (n < lookback + 1 || maValues.length !== n) return false
  const start = Math.max(1, n - lookback)
  for (let i = start; i < n; i++) {
    const maCurr = maValues[i]
    const maPrev = maValues[i - 1]
    if (maCurr == null || maPrev == null) continue
    if (closes[i] > maCurr && closes[i - 1] <= maPrev) return true
  }
  return false
}

export function daysSinceMACrossover(
  closes: number[],
  maValues: (number | null)[],
  lookback = 30
): number | null {
  const n = closes.length
  if (n < 2 || maValues.length !== n) return null
  const start = Math.max(1, n - lookback)
  for (let i = n - 1; i >= start; i--) {
    const maCurr = maValues[i]
    const maPrev = maValues[i - 1]
    if (maCurr == null || maPrev == null) continue
    if (closes[i] > maCurr && closes[i - 1] <= maPrev) {
      return n - 1 - i
    }
  }
  return null
}

export function calculateTfaMACrossoverSignals(
  closes: number[],
  ma50History: (number | null)[],
  ma100History: (number | null)[],
  ma200History: (number | null)[],
): {
  ma50: boolean
  ma100: boolean
  ma200: boolean
  any: boolean
  risingMa: 'ma50' | 'ma100' | 'ma200' | null
  daysAgo: number | null
  stillValid: boolean
} {
  if (!closes || closes.length < 2) {
    return { ma50: false, ma100: false, ma200: false, any: false, risingMa: null, daysAgo: null, stillValid: false }
  }
  const ma50Cross = calculateMACrossover(closes, ma50History, 10)
  const ma100Cross = calculateMACrossover(closes, ma100History, 10)
  const ma200Cross = calculateMACrossover(closes, ma200History, 10)
  const any = ma50Cross || ma100Cross || ma200Cross

  const risingMa: 'ma50' | 'ma100' | 'ma200' | null =
    ma200Cross ? 'ma200' : ma100Cross ? 'ma100' : ma50Cross ? 'ma50' : null

  const daysAgo200 = ma200Cross ? daysSinceMACrossover(closes, ma200History, 30) : null
  const daysAgo100 = ma100Cross ? daysSinceMACrossover(closes, ma100History, 30) : null
  const daysAgo50 = ma50Cross ? daysSinceMACrossover(closes, ma50History, 30) : null
  const daysAgo = daysAgo200 ?? daysAgo100 ?? daysAgo50 ?? null

  const n = closes.length
  const lastClose = closes[n - 1]
  const stillValid =
    (ma50Cross && ma50History[n - 1] != null && lastClose > (ma50History[n - 1] as number)) ||
    (ma100Cross && ma100History[n - 1] != null && lastClose > (ma100History[n - 1] as number)) ||
    (ma200Cross && ma200History[n - 1] != null && lastClose > (ma200History[n - 1] as number))

  return { ma50: ma50Cross, ma100: ma100Cross, ma200: ma200Cross, any, risingMa, daysAgo, stillValid }
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

// ─── RSI(14) ──────────────────────────────────────────────────────────────────

export function calculateRSI(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null
  const slice = closes.slice(closes.length - (period * 3))
  let gains = 0, losses = 0

  // Erste Periode: einfacher Durchschnitt
  for (let i = 1; i <= period; i++) {
    const diff = slice[i] - slice[i - 1]
    if (diff > 0) gains += diff
    else losses -= diff
  }
  let avgGain = gains / period
  let avgLoss = losses / period

  // Wilder Smoothing (EMA)
  for (let i = period + 1; i < slice.length; i++) {
    const diff = slice[i] - slice[i - 1]
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period
  }
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

// ─── Draw from 52W High ───────────────────────────────────────────────────────
// Gibt negativen Wert zurück: z.B. -0.55 = 55% unter 52W-Hoch
export function calculateDrawFromHigh(closes: number[]): number | null {
  const n = closes.length
  if (n < 2) return null
  const slice = closes.slice(Math.max(0, n - 252))
  const high52w = Math.max(...slice)
  const last = closes[n - 1]
  if (high52w === 0) return null
  return (last - high52w) / high52w
}

// ─── Drawdown vom N-Jahres-Hoch (Wochendaten) ────────────────────────────────
// Gibt negativen Wert zurück: z.B. -0.65 = 65% unter N-Jahres-Hoch
export function calculateDrawFromNYHigh(closesWeekly: number[], weeks: number): number | null {
  if (!closesWeekly || closesWeekly.length < 4) return null
  const slice = closesWeekly.slice(Math.max(0, closesWeekly.length - weeks))
  const highNY = Math.max(...slice)
  const last = closesWeekly[closesWeekly.length - 1]
  if (highNY === 0) return null
  return (last - highNY) / highNY
}

export function calculateDrawFrom5YHigh(closesWeekly: number[]): number | null {
  return calculateDrawFromNYHigh(closesWeekly, 260)
}

export function calculateDrawFrom7YHigh(closesWeekly: number[]): number | null {
  return calculateDrawFromNYHigh(closesWeekly, 364)
}

// ─── Higher Low Detection ─────────────────────────────────────────────────────
// Prüft ob die letzten 2 lokalen Tiefs steigen (einfache Annäherung)
export function calculateHigherLow(closes: number[], lookback = 60): boolean {
  const n = closes.length
  if (n < lookback) return false
  const slice = closes.slice(n - lookback)
  const lows: { idx: number; val: number }[] = []
  for (let i = 1; i < slice.length - 1; i++) {
    if (slice[i] < slice[i - 1] && slice[i] < slice[i + 1]) {
      lows.push({ idx: i, val: slice[i] })
    }
  }
  if (lows.length < 2) return false
  return lows[lows.length - 1].val > lows[lows.length - 2].val
}

// ─── Levy Relative Strength ───────────────────────────────────────────────────
// Kurs / 26-Wochen-GD. Wert > 1.0 = über Halbjahres-Trend
export function calculateLevyRS(closes: number[], period = 130): number | null {
  const ma = calculateMA(closes, period)
  if (ma === null || ma === 0) return null
  return closes[closes.length - 1] / ma
}

// ─── Weekly Vola Ratio (3M / 1Y) ────────────────────────────────────────────
// Wert < 0.7 = Vola-Kompression
export function calculateWeeklyVolaRatio(closesWeekly: number[]): number | null {
  const n = closesWeekly.length
  if (n < 52) return null

  const weeklyReturns: number[] = []
  for (let i = 1; i < n; i++) {
    if (closesWeekly[i - 1] > 0) {
      weeklyReturns.push((closesWeekly[i] - closesWeekly[i - 1]) / closesWeekly[i - 1])
    }
  }
  if (weeklyReturns.length < 13) return null

  const calcVola = (returns: number[]) => {
    if (returns.length < 2) return 0
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length
    const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / (returns.length - 1)
    return Math.sqrt(variance)
  }

  const vola3m = calcVola(weeklyReturns.slice(-13))
  const vola1y = calcVola(weeklyReturns.slice(-52))
  if (vola1y === 0) return null
  return vola3m / vola1y
}

// ─── TFA Technical Score (T_Score) ───────────────────────────────────────────
// 5 binäre Signale → normalisiert auf 0–1
export function calculateTfaTDetails(
  closes: number[],
  volumes: number[] | undefined,
  rsi14: number | null,
  aboveMa50: boolean | null,
  drawFromHigh: number | null,
  higherLow?: boolean | null,
  maCrossover?: { ma50: boolean; ma100: boolean; ma200: boolean; stillValid: boolean } | null,
): { score: number | null; signals: { t1: number; t2: number; t3: number; t4: number; t5: number } | null } {
  if (!closes || closes.length < 50) return { score: null, signals: null }

  // T1: RSI war unter 30 und dreht nach oben
  let t1 = 0
  if (rsi14 !== null) {
    const prevRSI = calculateRSI(closes.slice(0, -5)) // RSI vor 5 Tagen
    if (prevRSI !== null && prevRSI < 35 && rsi14 > prevRSI) t1 = 1
  }

  // T2: MA-Crossover (frisch = 1) oder statisch über MA50 (Kontext = 0.5)
  let t2 = 0
  if (maCrossover?.stillValid && (maCrossover.ma50 || maCrossover.ma100 || maCrossover.ma200)) {
    t2 = 1
  } else if (aboveMa50 === true) {
    t2 = 0.5
  }

  // T3: Higher Low gebildet
  const t3 = (higherLow ?? calculateHigherLow(closes)) ? 1 : 0

  // T4: Volumen beim letzten Anstieg überdurchschnittlich
  let t4 = 0
  if (volumes && volumes.length >= 21) {
    const n = volumes.length
    const avgVol = volumes.slice(n - 21, n - 1).reduce((a, b) => a + b, 0) / 20
    const lastUp = closes[n - 1] > closes[n - 2]
    if (lastUp && volumes[n - 1] > avgVol * 1.2) t4 = 1
  }

  // T5: Rückgang im TFA-Fenster (−40% bis −90%)
  const t5 = drawFromHigh !== null && drawFromHigh < -0.40 && drawFromHigh > -0.90 ? 1 : 0

  const score = (t1 + t2 + t3 + t4 + t5) / 5
  return { score, signals: { t1, t2, t3, t4, t5 } }
}

export function calculateTfaTScore(
  closes: number[],
  volumes: number[] | undefined,
  rsi14: number | null,
  aboveMa50: boolean | null,
  drawFromHigh: number | null,
  maCrossover?: { ma50: boolean; ma100: boolean; ma200: boolean; stillValid: boolean } | null,
): number | null {
  return calculateTfaTDetails(closes, volumes, rsi14, aboveMa50, drawFromHigh, undefined, maCrossover).score
}

// ─── TFA Fundamental Score (F_Score) ─────────────────────────────────────────
// Nutzt bereits vorhandene Felder: pb, earningsYield, returnOnAssets, pe
export function calculateTfaFDetails(
  pb: number | null | undefined,
  ebitda: number | null | undefined,
  enterpriseValue: number | null | undefined,
  targetPrice: number | null | undefined,
  currentPrice: number | null | undefined,
): { score: number | null; signals: { f1: number; f2: number; f3: number } | null } {
  let signals = 0
  let count = 0
  let f1 = 0, f2 = 0, f3 = 0

  if (pb != null) {
    f1 = pb < 1.0 ? 1 : pb < 1.8 ? 0.5 : 0
    signals += f1; count++
  }

  if (ebitda != null && enterpriseValue != null && ebitda > 0 && enterpriseValue > 0) {
    const evEbitda = enterpriseValue / ebitda
    f2 = evEbitda < 10 ? 1 : evEbitda < 18 ? 0.5 : 0
    signals += f2; count++
  }

  if (targetPrice != null && currentPrice != null && currentPrice > 0) {
    const upside = (targetPrice - currentPrice) / currentPrice
    f3 = upside > 0.40 ? 1 : upside > 0.25 ? 0.5 : 0
    signals += f3; count++
  }

  if (count === 0) return { score: null, signals: null }
  return { score: signals / count, signals: { f1, f2, f3 } }
}

export function calculateTfaFScore(
  pb: number | null | undefined,
  ebitda: number | null | undefined,
  enterpriseValue: number | null | undefined,
  targetPrice: number | null | undefined,
  currentPrice: number | null | undefined,
): number | null {
  return calculateTfaFDetails(pb, ebitda, enterpriseValue, targetPrice, currentPrice).score
}

// ─── TFA Technical Score (5Y/7Y Szenarien, Wochendaten) ─────────────────────
export function calculateTfaTDetails5Y(
  closesWeekly: number[],
  weeklyRsi14: number | null,
  weeklyLevyRS: number | null,
  weeklyHigherLow: boolean | null,
  weeklyVolaRatio: number | null,
  drawdownForT5: number | null,
  t5Min: number,
): { score: number | null; signals: { t1: number; t2: number; t3: number; t4: number; t5: number } | null } {
  if (!closesWeekly || closesWeekly.length < 26) return { score: null, signals: null }

  let t1 = 0
  if (weeklyRsi14 !== null) {
    const prevRsi = calculateRSI(closesWeekly.slice(0, -4))
    if (prevRsi !== null && prevRsi < 38 && weeklyRsi14 > prevRsi && weeklyRsi14 < 55) t1 = 1
  }

  let t2 = 0
  if (weeklyLevyRS !== null) {
    t2 = (weeklyLevyRS > 0.80 && weeklyLevyRS < 1.10) ? 1
      : weeklyLevyRS > 0.70 ? 0.5
      : 0
  }

  const t3 = weeklyHigherLow === true ? 1 : 0

  let t4 = 0
  if (weeklyVolaRatio !== null) {
    t4 = weeklyVolaRatio < 0.70 ? 1
      : weeklyVolaRatio < 0.85 ? 0.5
      : 0
  }

  const t5 = drawdownForT5 !== null
    && drawdownForT5 < t5Min
    && drawdownForT5 > -0.90
    ? 1 : 0

  const score = (t1 + t2 + t3 + t4 + t5) / 5
  return { score, signals: { t1, t2, t3, t4, t5 } }
}

// ─── TFA Fundamental Score (5Y/7Y Szenarien, relaxiert) ─────────────────────
export function calculateTfaFDetails5Y(
  pb: number | null | undefined,
  ebitda: number | null | undefined,
  enterpriseValue: number | null | undefined,
  returnOnAssets: number | null | undefined,
  analystRating: number | null | undefined,
  targetPrice: number | null | undefined,
  currentPrice: number | null | undefined,
): { score: number | null; signals: { f1: number; f2: number; f3: number; f4: number; f5: number } | null } {
  let signals = 0
  let count = 0
  let f1 = 0, f2 = 0, f3 = 0, f4 = 0, f5 = 0

  if (pb != null) {
    f1 = pb < 0.8 ? 1 : pb < 1.2 ? 0.5 : 0
    signals += f1; count++
  }

  if (ebitda != null && enterpriseValue != null && ebitda > 0 && enterpriseValue > 0) {
    const evEbitda = enterpriseValue / ebitda
    f2 = evEbitda < 8 ? 1 : evEbitda < 15 ? 0.5 : 0
    signals += f2; count++
  }

  if (returnOnAssets != null) {
    f3 = returnOnAssets > 0.02 ? 1
      : returnOnAssets > -0.05 ? 0.7
      : returnOnAssets > -0.10 ? 0.3
      : 0
    signals += f3; count++
  }

  if (analystRating != null) {
    f4 = analystRating < 2.5 ? 1 : analystRating < 3.5 ? 0.6 : 0
    signals += f4; count++
  }

  if (targetPrice != null && currentPrice != null && currentPrice > 0) {
    const upside = (targetPrice - currentPrice) / currentPrice
    f5 = upside > 0.40 ? 1 : upside > 0.25 ? 0.5 : 0
    signals += f5; count++
  }

  if (count === 0) return { score: null, signals: null }
  return { score: signals / count, signals: { f1, f2, f3, f4, f5 } }
}

// ─── TFA Phase 1 Gate (ohne Fundamentals) ────────────────────────────────────
export function isTfaZombie(
  returnOnAssets: number | null | undefined,
  pb: number | null | undefined
): boolean {
  return (
    returnOnAssets != null && pb != null &&
    returnOnAssets < -0.20 && pb < 0.40
  )
}

export function calculateTfaPhase1Gate(inst: Instrument): {
  phase: 'monitoring' | 'watch' | 'none'
  scenario: '52w' | '5y' | '7y' | null
  reason?: string
} {
  if (inst.marketCap != null && inst.marketCap < 50_000_000) {
    return { phase: 'none', scenario: null, reason: 'Marktkapitalisierung < 50M' }
  }

  if (isTfaZombie(inst.returnOnAssets, inst.pb)) {
    return { phase: 'none', scenario: null, reason: 'Zombie: ROA < -20% + PB < 0.4' }
  }

  let scenario: '52w' | '5y' | '7y' | null = null

  const draw52w = inst.drawFromHigh
  if (draw52w != null && draw52w < -0.30 && draw52w > -0.90) {
    scenario = '52w'
  } else {
    const draw5y = inst.drawFrom5YHigh
    if (draw5y != null && draw5y < -0.50 && draw5y > -0.90) {
      scenario = '5y'
    } else {
      const draw7y = inst.drawFrom7YHigh
      if (draw7y != null && draw7y < -0.60 && draw7y > -0.90) {
        scenario = '7y'
      }
    }
  }

  if (scenario === null) {
    return { phase: 'none', scenario: null, reason: 'Kein Drawdown im TFA-Fenster' }
  }

  const crossover = inst.maCrossover
  const hasCrossover = !!(crossover && (crossover.ma50 || crossover.ma100 || crossover.ma200) && crossover.stillValid === true)
  if (hasCrossover) {
    return { phase: 'watch', scenario }
  }

  return { phase: 'monitoring', scenario }
}

// ─── TFA Phase 2 Gate (mit Fundamentals) ─────────────────────────────────────
export function calculateTfaPhase2Gate(
  inst: Instrument,
  scenario: '52w' | '5y' | '7y'
): { passes: boolean; reason?: string } {
  if ((scenario === '5y' || scenario === '7y') &&
      inst.tfaFScore5Y != null && inst.tfaFScore5Y < 0.15) {
    return { passes: false, reason: `${scenario.toUpperCase()} F-Score unbrauchbar` }
  }
  return { passes: true }
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

export function calculateRiskAdjustedScore(momentumScore: number | null, vola: number | null): number | null {
  if (momentumScore === null || vola === null || vola === 0) return null
  return momentumScore / vola
}

// ─── Combined Score ──────────────────────────────────────────────────────────
// Simple average of momentumScore and riskAdjustedScore, both higher = better.
// Gives a single "best of both" metric to sort by.

export function calculateCombinedScore(
  momentumPercentile: number | null | undefined,
  riskAdjustedPercentile: number | null | undefined,
): number | null {
  if (momentumPercentile != null && riskAdjustedPercentile != null) {
    return (momentumPercentile + riskAdjustedPercentile) / 2
  }
  if (momentumPercentile != null) return momentumPercentile
  if (riskAdjustedPercentile != null) return riskAdjustedPercentile
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
        if (idx >= 0) {
          const rankField = field === 'riskAdjustedScore' ? 'riskAdjustedRank' : `${String(field)}Rank`
          ;(result[idx] as any)[rankField] = rank + 1
        }
      })
  }

  const indexed = instruments.map((inst, i) => ({ inst, i }))
  rank(indexed, 'momentumScore', true)
  rank(indexed, 'riskAdjustedScore', true)
  rank(indexed, 'combinedScore', true)
  rank(indexed, 'earningsYield', true)
  rank(indexed, 'returnOnAssets', true)
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
    .filter((s) => s.earningsYield != null)
    .map((s) => ({ isin: s.isin, ey: s.earningsYield! }))
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
      if (eyR !== undefined && rocR !== undefined) {
        updated.valueScore = eyR + rocR
        updated.valueScoreModel = 'magic-formula'
      } else if (eyR !== undefined) {
        updated.valueScore = eyR * 2
        updated.valueScoreModel = 'magic-formula'
      } else if (rocR !== undefined) {
        updated.valueScore = rocR * 2
        updated.valueScoreModel = 'magic-formula'
      } else {
        updated.valueScore = null
      }
    }
    return updated
  })
}

// ─── Recalculate All ──────────────────────────────────────────────────────────

export function recalculateAll(
  instruments: Instrument[],
  weights: MomentumWeights,
  atrMultiplier = 4,
  referenceR3m?: number | null
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
      updated.riskAdjustedScore = calculateRiskAdjustedScore(updated.momentumScore, updated.vola)

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

      if (inst.type === 'Stock') {
        const ma50Hist = buildMAHistory(inst.closes, 50)
        const ma100Hist = buildMAHistory(inst.closes, 100)
        const ma200Hist = buildMAHistory(inst.closes, 200)
        const crossoverSignals = calculateTfaMACrossoverSignals(
          inst.closes,
          ma50Hist,
          ma100Hist,
          ma200Hist,
        )
        updated.maCrossover = {
          ma50: crossoverSignals.ma50,
          ma100: crossoverSignals.ma100,
          ma200: crossoverSignals.ma200,
          risingMa: crossoverSignals.risingMa,
          stillValid: crossoverSignals.stillValid,
        }
        updated.tfaCrossoverDaysAgo = crossoverSignals.daysAgo
      } else {
        updated.maCrossover = null
        updated.tfaCrossoverDaysAgo = null
      }

      // TFA technical inputs
      updated.rsi14 = calculateRSI(inst.closes)
      updated.drawFromHigh = calculateDrawFromHigh(inst.closes)
      updated.levyRS = calculateLevyRS(inst.closes)
      updated.higherLow = calculateHigherLow(inst.closes)

      // ATR + Selling Threshold
      const { atr20, sellingThreshold } = calculateSellingThreshold(
        inst.closes, atrMultiplier, inst.highs, inst.lows
      )
      updated.atr20 = atr20
      updated.sellingThreshold = sellingThreshold
    }
    if (inst.type === 'ETF' || inst.type === 'ETC') {
      if (inst.pe != null && inst.pe > 0) updated.earningsYield = 1 / inst.pe
      else updated.earningsYield = null
    } else if (inst.type === 'Stock') {
      if (inst.ebitda != null && inst.enterpriseValue != null && inst.enterpriseValue > 0) {
        updated.earningsYield = inst.ebitda / inst.enterpriseValue
      } else {
        updated.earningsYield = null
      }
    }

    const tDetails = calculateTfaTDetails(
      inst.closes ?? [],
      inst.volumes,
      updated.rsi14 ?? null,
      updated.aboveMa50 ?? null,
      updated.drawFromHigh ?? null,
      updated.higherLow ?? null,
      updated.maCrossover ?? null
    )
    const currentPrice = inst.closes && inst.closes.length > 0
      ? inst.closes[inst.closes.length - 1]
      : null
    const fDetails = calculateTfaFDetails(
      inst.pb,
      inst.ebitda,
      inst.enterpriseValue,
      inst.targetPriceAdj ?? inst.targetPrice,
      currentPrice,
    )
    updated.tfaTScore = tDetails.score
    updated.tfaTSignals = tDetails.signals
    updated.tfaFScore = fDetails.score
    updated.tfaFSignals = fDetails.signals
    const tScore = tDetails.score
    const fScore = fDetails.score
    const eScore = updated.tfaEScore ?? null
    if (tScore !== null && fScore !== null && eScore !== null) {
      updated.tfaScore = tScore * 0.35 + fScore * 0.40 + eScore * 0.25
    } else if (tScore !== null && fScore !== null) {
      updated.tfaScore = (tScore * 0.35 + fScore * 0.40) / 0.75
    } else if (tScore !== null) {
      updated.tfaScore = tScore
    } else {
      updated.tfaScore = null
    }

    if (inst.closesWeekly && inst.closesWeekly.length >= 26) {
      updated.drawFrom5YHigh = calculateDrawFrom5YHigh(inst.closesWeekly)
      updated.drawFrom7YHigh = calculateDrawFrom7YHigh(inst.closesWeekly)
      updated.weeklyRsi14 = calculateRSI(inst.closesWeekly)
      updated.weeklyLevyRS = calculateLevyRS(inst.closesWeekly, 130)
      updated.weeklyHigherLow = calculateHigherLow(inst.closesWeekly, 26)
      updated.weeklyVolaRatio = calculateWeeklyVolaRatio(inst.closesWeekly)

      const t5yDetails = calculateTfaTDetails5Y(
        inst.closesWeekly,
        updated.weeklyRsi14 ?? null,
        updated.weeklyLevyRS ?? null,
        updated.weeklyHigherLow ?? null,
        updated.weeklyVolaRatio ?? null,
        updated.drawFrom5YHigh ?? null,
        -0.50,
      )
      updated.tfaTScore5Y = t5yDetails.score
      updated.tfaTSignals5Y = t5yDetails.signals
    } else {
      updated.drawFrom5YHigh = null
      updated.drawFrom7YHigh = null
      updated.weeklyRsi14 = null
      updated.weeklyLevyRS = null
      updated.weeklyHigherLow = null
      updated.weeklyVolaRatio = null
      updated.tfaTScore5Y = null
      updated.tfaTSignals5Y = null
    }

    if (updated.type === 'Stock') {
      const phase1 = calculateTfaPhase1Gate(updated)

      if (phase1.phase === 'none') {
        updated.tfaPhase = 'none'
        updated.tfaScenario = null
        updated.tfaRejectReason = phase1.reason
      } else if (phase1.phase === 'monitoring') {
        updated.tfaPhase = 'monitoring'
        updated.tfaScenario = phase1.scenario
        const crossExpired = updated.tfaFetched
          && !!(updated.maCrossover && (updated.maCrossover.ma50 || updated.maCrossover.ma100 || updated.maCrossover.ma200))
          && updated.maCrossover.stillValid === false
        updated.tfaRejectReason = crossExpired
          ? 'MA-Crossover abgelaufen — Kurs unter MA gefallen'
          : undefined
      } else {
        updated.tfaScenario = phase1.scenario

        if (phase1.scenario === '7y' && inst.closesWeekly && inst.closesWeekly.length >= 26) {
          const t7yDetails = calculateTfaTDetails5Y(
            inst.closesWeekly,
            updated.weeklyRsi14 ?? null,
            updated.weeklyLevyRS ?? null,
            updated.weeklyHigherLow ?? null,
            updated.weeklyVolaRatio ?? null,
            updated.drawFrom7YHigh ?? null,
            -0.60,
          )
          updated.tfaTScore5Y = t7yDetails.score
          updated.tfaTSignals5Y = t7yDetails.signals
        }

        if (!updated.analystFetched) {
          updated.tfaPhase = 'watch'
          updated.tfaRejectReason = undefined
        } else {
          const phase2 = calculateTfaPhase2Gate(updated, phase1.scenario!)
          if (!phase2.passes) {
            updated.tfaPhase = 'rejected'
            updated.tfaRejectReason = phase2.reason
          } else if (updated.tfaKO === true) {
            updated.tfaPhase = 'ko'
            updated.tfaRejectReason = undefined
          } else if (updated.tfaFetched) {
            updated.tfaPhase = 'qualified'
            updated.tfaRejectReason = undefined
          } else {
            updated.tfaPhase = 'watch'
            updated.tfaRejectReason = undefined
          }
        }
      }
    } else {
      updated.tfaPhase = 'none'
      updated.tfaScenario = null
      updated.tfaRejectReason = undefined
    }

    // Breakout score (uses last 60 days, MA200/MA50, volume, and URTH reference)
    const breakout = calculateBreakout(
      updated.closes,
      updated.volumes,
      updated.timestamps,
      updated.r3m,
      referenceR3m
    )
    updated.breakoutDate = breakout.breakoutTimestamp ?? undefined
    updated.breakoutAgeDays = breakout.breakoutAgeDays ?? undefined
    updated.breakoutScore = breakout.breakoutScore
    updated.breakoutConfirmed = breakout.breakoutConfirmed
    updated.breakoutFlags = breakout.flags
    return updated
  })

  const momentumPct = buildPercentileMap(withScores, 'momentumScore')
  const riskAdjustedPct = buildPercentileMap(withScores, 'riskAdjustedScore')
  const withCombined = withScores.map((inst) => {
    const combinedScore = calculateCombinedScore(
      momentumPct.get(inst.isin),
      riskAdjustedPct.get(inst.isin)
    )
    return { ...inst, combinedScore }
  })

  const withValue = calculateValueScores(withCombined)
  return applyRanks(withValue)
}
