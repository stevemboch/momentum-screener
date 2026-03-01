export interface BreakoutResult {
  breakoutIndex: number | null
  breakoutTimestamp: number | null
  breakoutAgeDays: number | null
  breakoutScore: number | null
  breakoutConfirmed: boolean
}

function buildMovingAverage(closes: number[], period: number): (number | null)[] {
  const n = closes.length
  const res: (number | null)[] = new Array(n).fill(null)
  if (n < period) return res
  let sum = 0
  for (let i = 0; i < n; i++) {
    sum += closes[i]
    if (i >= period) sum -= closes[i - period]
    if (i >= period - 1) res[i] = sum / period
  }
  return res
}

export function calculateBreakout(
  closes: number[] | undefined,
  volumes: number[] | undefined,
  timestamps: number[] | undefined,
  r3m: number | null | undefined,
  referenceR3m: number | null | undefined,
): BreakoutResult {
  if (!closes || closes.length < 201) {
    return {
      breakoutIndex: null,
      breakoutTimestamp: null,
      breakoutAgeDays: null,
      breakoutScore: null,
      breakoutConfirmed: false,
    }
  }

  const n = closes.length
  const ma200 = buildMovingAverage(closes, 200)
  const ma50 = buildMovingAverage(closes, 50)

  // find last breakout within last 60 days
  const lookback = 60
  const start = Math.max(1, n - lookback)
  let breakoutIndex: number | null = null
  for (let i = n - 1; i >= start; i--) {
    if (ma200[i] == null || ma200[i - 1] == null) continue
    if (closes[i] > (ma200[i] as number) && closes[i - 1] <= (ma200[i - 1] as number)) {
      breakoutIndex = i
      break
    }
  }

  if (breakoutIndex == null) {
    return {
      breakoutIndex: null,
      breakoutTimestamp: null,
      breakoutAgeDays: null,
      breakoutScore: null,
      breakoutConfirmed: false,
    }
  }

  const latestTs = timestamps && timestamps.length === n ? timestamps[n - 1] : null
  const breakoutTs = timestamps && timestamps.length === n ? timestamps[breakoutIndex] : null
  const ageDays = latestTs && breakoutTs
    ? Math.floor((latestTs - breakoutTs) / 86400)
    : (n - 1 - breakoutIndex)

  if (ageDays > 45) {
    return {
      breakoutIndex: null,
      breakoutTimestamp: null,
      breakoutAgeDays: null,
      breakoutScore: null,
      breakoutConfirmed: false,
    }
  }

  // Condition 1: MA200 rising vs 20 days earlier
  let cond1 = false
  if (breakoutIndex - 20 >= 0 && ma200[breakoutIndex] != null && ma200[breakoutIndex - 20] != null) {
    cond1 = (ma200[breakoutIndex] as number) > (ma200[breakoutIndex - 20] as number)
  }

  // Condition 2: Golden Cross (MA50 > MA200 on breakout day)
  let cond2 = false
  if (ma50[breakoutIndex] != null && ma200[breakoutIndex] != null) {
    cond2 = (ma50[breakoutIndex] as number) > (ma200[breakoutIndex] as number)
  }

  // Condition 3: Relative strength vs MSCI World (URTH)
  const cond3 = r3m != null && referenceR3m != null ? r3m > referenceR3m : false

  // Condition 4: Volume confirmation
  let cond4 = false
  if (volumes && volumes.length === n && breakoutIndex - 20 >= 0) {
    const window = volumes.slice(breakoutIndex - 20, breakoutIndex)
    const avg = window.reduce((s, v) => s + v, 0) / window.length
    if (avg > 0) cond4 = volumes[breakoutIndex] > 1.5 * avg
  }

  // Condition 5: Retest successful (<= 2% under MA200 then close above MA200)
  let cond5 = false
  let retestIdx: number | null = null
  for (let i = breakoutIndex + 1; i < n; i++) {
    if (ma200[i] == null) continue
    const ma = ma200[i] as number
    if (closes[i] <= ma && closes[i] >= ma * 0.98) {
      retestIdx = i
      break
    }
  }
  if (retestIdx != null) {
    for (let i = retestIdx + 1; i < n; i++) {
      if (ma200[i] == null) continue
      if (closes[i] > (ma200[i] as number)) {
        cond5 = true
        break
      }
    }
  }

  const score = [cond1, cond2, cond3, cond4, cond5].filter(Boolean).length

  return {
    breakoutIndex,
    breakoutTimestamp: breakoutTs,
    breakoutAgeDays: ageDays,
    breakoutScore: score,
    breakoutConfirmed: cond5,
  }
}
