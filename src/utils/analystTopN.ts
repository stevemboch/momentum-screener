import type { Instrument } from '../types'

function rankOrMax(inst: Instrument): number {
  const rank = inst.riskAdjustedRank
  return typeof rank === 'number' && Number.isFinite(rank) ? rank : Number.MAX_SAFE_INTEGER
}

function scoreOrMin(inst: Instrument): number {
  const score = inst.riskAdjustedScore
  return typeof score === 'number' && Number.isFinite(score) ? score : Number.NEGATIVE_INFINITY
}

export function selectTopAnalystStocks(instruments: Instrument[], topN: number): Instrument[] {
  if (!Array.isArray(instruments) || topN <= 0) return []
  return instruments
    .filter((i) => i.type === 'Stock' && i.priceFetched && !!i.yahooTicker)
    .sort((a, b) =>
      rankOrMax(a) - rankOrMax(b) ||
      scoreOrMin(b) - scoreOrMin(a) ||
      a.isin.localeCompare(b.isin)
    )
    .slice(0, topN)
}
