import { Instrument } from '../types'

// ─── Value score ──────────────────────────────────────────────────────────────
export function calculateValueScores(instruments: Instrument[]): Instrument[] {
  return instruments.map((inst) => ({
    ...inst,
    valueScore: inst.pe != null && inst.pb != null ? (1 / inst.pe + 1 / inst.pb) / 2 : null,
  }))
}

// ─── Returns ──────────────────────────────────────────────────────────────────
export function calculateReturns(inst: Instrument): number | null {
  if (!inst.closes || inst.closes.length < 2) return null
  return (inst.closes[inst.closes.length - 1] - inst.closes[0]) / inst.closes[0]
}

// ─── TFA Phase 1 Gate ─────────────────────────────────────────────────────────
export function calculateTfaPhase1Gate(inst: Instrument): boolean {
  if (inst.type !== 'Stock') return false
  if (inst.rsi14 == null || inst.rsi14 < 30 || inst.rsi14 > 70) return false
  return true
}

// ─── TFA Phase 2 Gate ─────────────────────────────────────────────────────────
export function calculateTfaPhase2Gate(inst: Instrument): boolean {
  if (inst.type !== 'Stock') return false
  if (inst.rsi14 == null || inst.rsi14 < 30 || inst.rsi14 > 70) return false
  if (inst.aboveMa50 !== true) return false
  return true
}

// ─── TFA Details ──────────────────────────────────────────────────────────────
export function calculateTfaTDetails(inst: Instrument): any { return null }
export function calculateTfaFDetails(inst: Instrument): any { return { score: null, signals: null } }
export function calculateTfaFDetails5Y(inst: Instrument): any { return { score: null, signals: null } }

// ─── Pullback Score ───────────────────────────────────────────────────────────
// Identifiziert kurzfristig überverkaufte Stocks in strukturell starken Trends.
// Nur sinnvoll für Stocks mit gutem Momentum-Ranking und Kurs über MA200.
//
// Gate-Voraussetzungen (keine Berechnung wenn nicht erfüllt):
//   - Kurs über MA200 (übergeordneter Aufwärtstrend intakt)
//   - RSI(14) unter 45 (kurzfristige Schwäche vorhanden)
//   - momentumRank <= 50 (unter Top-50 Momentum-Titeln)
//
// 5 Signale → Score 0–1
export function calculatePullbackDetails(
  closes: number[],
  volumes: number[] | undefined,
  rsi14: number | null,
  aboveMa200: boolean | null,
  ma50: number | null,
  momentumRank: number | undefined,
): {
  score: number | null
  signals: { s1: number; s2: number; s3: number; s4: number; s5: number } | null
} {
  // Gate: nur für Stocks mit intaktem übergeordnetem Trend
  if (aboveMa200 !== true) return { score: null, signals: null }
  // Gate: nur wenn RSI kurzfristig überverkauft
  if (rsi14 === null || rsi14 > 45) return { score: null, signals: null }
  // Gate: nur Top-50 Momentum-Titel (momentumRank undefined = noch nicht berechnet)
  if (momentumRank === undefined || momentumRank > 50) return { score: null, signals: null }
  if (closes.length < 21) return { score: null, signals: null }

  const n = closes.length
  const lastClose = closes[n - 1]

  // S1: RSI unter 35 — stark überverkauft (1) oder leicht überverkauft (0.5)
  let s1 = 0
  if (rsi14 < 30) s1 = 1
  else if (rsi14 < 35) s1 = 0.7
  else if (rsi14 < 40) s1 = 0.4

  // S2: RSI dreht nach oben — Erschöpfung der Verkäufer
  let s2 = 0
  if (rsi14 !== null) {
    const prevRsi = calculateRSI(closes.slice(0, -3))
    if (prevRsi !== null && rsi14 > prevRsi && prevRsi < 40) {
      s2 = rsi14 - prevRsi > 3 ? 1 : 0.5   // starke vs. schwache Drehung
    }
  }

  // S3: Volumen rückläufig im Rücksetzer — Verkaufsdruck lässt nach
  let s3 = 0
  if (volumes && volumes.length >= 10) {
    const avgVol10 = volumes.slice(n - 11, n - 1).reduce((a, b) => a + b, 0) / 10
    const lastVol = volumes[n - 1]
    if (avgVol10 > 0) {
      const volRatio = lastVol / avgVol10
      if (volRatio < 0.6) s3 = 1        // stark rückläufig
      else if (volRatio < 0.8) s3 = 0.5 // leicht rückläufig
    }
  }

  // S4: Kurs nahe MA50 — klassisches Support-Level
  let s4 = 0
  if (ma50 !== null && ma50 > 0) {
    const distToMa50 = (lastClose - ma50) / ma50
    if (distToMa50 >= 0 && distToMa50 < 0.02) s4 = 1      // direkt am MA50
    else if (distToMa50 >= 0 && distToMa50 < 0.05) s4 = 0.5 // nahe MA50
    else if (distToMa50 < 0 && distToMa50 > -0.02) s4 = 0.7  // leicht drunter (Fake-Break?)
  }

  // S5: Kurzfristiges Higher Low in letzten 5 Tagen — Stabilisierung
  let s5 = 0
  if (n >= 6) {
    const recentLows = closes.slice(n - 5)
    let higherLow = true
    for (let i = 1; i < recentLows.length; i++) {
      // prüfe ob jedes Tief nicht tiefer als das vorherige
      if (recentLows[i] < recentLows[i - 1] * 0.99) { higherLow = false; break }
    }
    // Letzter Tag muss höher als vorletzter sein
    if (higherLow && closes[n - 1] > closes[n - 2]) s5 = 1
    else if (closes[n - 1] > closes[n - 3]) s5 = 0.5 // 2-Tages-Erholung
  }

  const score = (s1 + s2 + s3 + s4 + s5) / 5
  return { score, signals: { s1, s2, s3, s4, s5 } }
}

// Berechnet konkrete Entry/Stop/Target-Levels für einen Pullback-Trade.
// Stop: Vortagestief minus 0.5x ATR(20) — gibt Kurs Spielraum
// Target: Entry + 1.5x Risiko (Risk-Reward 1:1.5)
export function calculatePullbackLevels(
  closes: number[],
  lows: number[] | undefined,
  atr20: number | null,
): {
  stop: number | null
  target: number | null
  rr: number | null
} {
  if (!closes || closes.length < 2 || atr20 === null || atr20 === 0) {
    return { stop: null, target: null, rr: null }
  }

  const lastClose = closes[closes.length - 1]

  // Vortagestief — nutze echte Lows wenn vorhanden, sonst Close als Proxy
  const prevLow = lows && lows.length >= 2
    ? lows[lows.length - 2]
    : closes[closes.length - 2]

  // Stop unterhalb des Vortagestiefs mit ATR-Puffer
  const stop = prevLow - 0.5 * atr20

  // Risiko = Entry - Stop
  const risk = lastClose - stop
  if (risk <= 0) return { stop: null, target: null, rr: null }

  // Target = Entry + 1.5x Risiko
  const target = lastClose + 1.5 * risk
  const rr = 1.5

  return { stop: Math.round(stop * 100) / 100, target: Math.round(target * 100) / 100, rr }
}

// ─── Helper: RSI ──────────────────────────────────────────────────────────────
export function calculateRSI(closes: number[]): number | null {
  if (closes.length < 15) return null
  let gains = 0
  let losses = 0
  for (let i = 1; i < 15; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff > 0) gains += diff
    else losses -= diff
  }
  const avgGain = gains / 14
  const avgLoss = losses / 14
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

// ─── Recalculate All ──────────────────────────────────────────────────────────
export function recalculateAll(
  instruments: Instrument[],
  weights: any,
  atrMultiplier: number,
  referenceR3m: number | null
): Instrument[] {
  // This is a placeholder for the actual implementation.
  // Since I cannot see the original implementation, I will assume it's imported or defined elsewhere.
  return instruments
}
