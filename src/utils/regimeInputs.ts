import type { Instrument } from '../types'

export interface RegimeInputs {
  aboveMA200Pct:   number
  avgR3m:          number | null
  avgVola:         number | null
  positiveR3mPct:  number
  urthR3m:         number | null
  instrumentCount: number
}

export function computeRegimeInputs(
  instruments: Instrument[],
  referenceR3m: number | null
): RegimeInputs {
  const withPrices = instruments.filter(i => i.closes && i.closes.length > 0)
  const n = withPrices.length

  if (n < 10) {
    return { aboveMA200Pct: 0, avgR3m: null, avgVola: null,
             positiveR3mPct: 0, urthR3m: referenceR3m, instrumentCount: n }
  }

  const aboveMA200Pct = withPrices.filter(i => i.aboveMa200).length / n

  const r3ms = withPrices.map(i => i.r3m).filter((v): v is number => v != null)
  const avgR3m = r3ms.length
    ? r3ms.reduce((a, b) => a + b, 0) / r3ms.length : null

  const volas = withPrices.map(i => i.vola).filter((v): v is number => v != null)
  const avgVola = volas.length
    ? volas.reduce((a, b) => a + b, 0) / volas.length : null

  const positiveR3mPct = r3ms.filter(v => v > 0).length / (r3ms.length || 1)

  return { aboveMA200Pct, avgR3m, avgVola, positiveR3mPct,
           urthR3m: referenceR3m, instrumentCount: n }
}
