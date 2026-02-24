import type { Instrument } from '../types'

// ─── Provider Detection ───────────────────────────────────────────────────────

const PROVIDERS: { prefix: string; priority: number; name: string }[] = [
  { prefix: 'ISHARES', priority: 1, name: 'iShares' },
  { prefix: 'VANGUARD', priority: 2, name: 'Vanguard' },
  { prefix: 'AMUNDI', priority: 3, name: 'Amundi' },
  { prefix: 'LYXOR', priority: 3, name: 'Lyxor' },
  { prefix: 'XTRACKERS', priority: 4, name: 'Xtrackers' },
  { prefix: 'SPDR', priority: 5, name: 'SPDR' },
  { prefix: 'INVESCO', priority: 6, name: 'Invesco' },
  { prefix: 'UBS', priority: 7, name: 'UBS' },
  { prefix: 'DEKA', priority: 8, name: 'Deka' },
  { prefix: 'HSBC', priority: 9, name: 'HSBC' },
  { prefix: 'WisdomTree', priority: 10, name: 'WisdomTree' },
  { prefix: 'WISDOMTREE', priority: 10, name: 'WisdomTree' },
  { prefix: 'VanEck', priority: 11, name: 'VanEck' },
  { prefix: 'VANECK', priority: 11, name: 'VanEck' },
  { prefix: 'PIMCO', priority: 12, name: 'PIMCO' },
  { prefix: 'FIDELITY', priority: 13, name: 'Fidelity' },
  { prefix: 'BLACKROCK', priority: 14, name: 'BlackRock' },
  { prefix: 'STATESTREET', priority: 15, name: 'State Street' },
  { prefix: 'DIMENSIONAL', priority: 16, name: 'Dimensional' },
  { prefix: 'OSSIAM', priority: 17, name: 'Ossiam' },
  { prefix: 'FLOSSBACH', priority: 18, name: 'Flossbach' },
  { prefix: 'DWS', priority: 19, name: 'DWS' },
]

// Words to strip from name to derive exposure key
const STRIP_WORDS = new Set([
  'UCITS', 'ETF', 'ETC', 'ETP', 'SWAP', 'DR', 'ACC', 'DIST', 'DISTRIBUTING',
  'ACCUMULATING', 'USD', 'EUR', 'GBP', 'CHF', 'CLASS', 'SHARE',
  '1C', '2C', '3C', '4C', '1D', '2D', 'A', 'B', 'C', 'D',
  'DAILY', 'MONTHLY', 'QUARTERLY', 'U.ETF', 'UETF',
  'THE', 'A', 'AN', 'OF', 'FOR', 'AND',
  // Noise words that differ between providers for same exposure
  'CORE', 'PRIME', 'PLUS', 'SELECT', 'OPTIMAL', 'ENHANCED', 'QUALITY',
  'IMI', 'ALL', 'LARGE', 'MID', 'SMALL', 'CAP', 'EX',
  'SCREENED', 'LEADERS', 'FILTERED', 'FOCUSED', 'UNIVERSAL', 'BROAD',
  // Provider names (will be detected separately)
  ...PROVIDERS.map((p) => p.prefix),
])

const HARD_DIMENSIONS = {
  ESG: ['ESG', 'SRI', 'PAB', 'CTB', 'CLIMATE', 'SUSTAINABLE', 'RESPONSIBLE', 'GREEN', 'IMPACT'],
  HEDGED: ['HEDGED', 'HDG', 'EUR HEDGED', 'USD HEDGED'],
  INDEX_FAMILIES: ['MSCI', 'FTSE', 'S&P', 'STOXX', 'BLOOMBERG', 'SOLACTIVE', 'RUSSELL', 'NASDAQ', 'DJ'],
}

function detectProvider(name: string): { priority: number; name: string } {
  const upper = name.toUpperCase()
  for (const p of PROVIDERS) {
    if (upper.startsWith(p.prefix)) return p
  }
  return { priority: 99, name: 'Other' }
}

function extractExposureKey(longName: string | undefined, fallbackName: string): string {
  const name = (longName || fallbackName || '').toUpperCase()

  // Remove provider prefix
  let stripped = name
  for (const p of PROVIDERS) {
    if (stripped.startsWith(p.prefix)) {
      stripped = stripped.slice(p.prefix.length).trim()
      break
    }
  }

  // Detect hard dimensions
  let esgOverlay = ''
  for (const tag of HARD_DIMENSIONS.ESG) {
    if (stripped.includes(tag)) { esgOverlay = 'ESG'; break }
  }

  let hedged = ''
  for (const tag of HARD_DIMENSIONS.HEDGED) {
    if (stripped.includes(tag)) { hedged = 'HEDGED'; break }
  }

  let indexFamily = ''
  for (const fam of HARD_DIMENSIONS.INDEX_FAMILIES) {
    if (stripped.includes(fam)) { indexFamily = fam; break }
  }

  // Remove strip words and noise
  const words = stripped.split(/[\s\-\/]+/).filter((w) => {
    if (!w) return false
    if (STRIP_WORDS.has(w)) return false
    if (/^\d{1,2}$/.test(w)) return false // short numbers (class ids like 1, 2)
    if (/^[A-Z]\d+$/.test(w)) return false // things like "A1", "B2"
    return true
  })

  const core = words.join(' ').trim()

  // Build deterministic key
  const parts = [core, indexFamily, esgOverlay, hedged].filter(Boolean)
  return parts.join('|')
}

// ─── Group ETFs by Exposure ───────────────────────────────────────────────────

export interface DedupGroup {
  key: string
  candidates: Instrument[]  // sorted by provider priority
  winner: Instrument
}

export function buildDedupGroups(instruments: Instrument[]): DedupGroup[] {
  const groups = new Map<string, Instrument[]>()

  for (const inst of instruments) {
    // Skip instruments with no longName and a suspiciously short display name
    // (truncated Xetra names like "ISCORE MSCI WO" would each form unique singleton groups)
    const nameToUse = inst.longName || inst.displayName
    if (!inst.longName && nameToUse.length < 15) continue

    const key = extractExposureKey(inst.longName, inst.displayName)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(inst)
  }

  const result: DedupGroup[] = []

  for (const [key, candidates] of groups) {
    // Sort candidates by provider priority
    const sorted = [...candidates].sort((a, b) => {
      const pa = detectProvider(a.longName || a.displayName)
      const pb = detectProvider(b.longName || b.displayName)
      if (pa.priority !== pb.priority) return pa.priority - pb.priority
      // Tiebreaker: prefer EUR over USD
      if (a.currency === 'EUR' && b.currency !== 'EUR') return -1
      if (b.currency === 'EUR' && a.currency !== 'EUR') return 1
      return 0
    })

    result.push({
      key,
      candidates: sorted,
      winner: sorted[0],
    })
  }

  return result
}

export function applyDedupToInstruments(
  instruments: Instrument[],
  groups: DedupGroup[]
): Instrument[] {
  const winnerISINs = new Set(groups.map((g) => g.winner.isin))
  const groupByISIN = new Map<string, { key: string; candidateISINs: string[] }>()

  for (const g of groups) {
    const candidateISINs = g.candidates.map((c) => c.isin)
    for (const c of g.candidates) {
      groupByISIN.set(c.isin, { key: g.key, candidateISINs })
    }
  }

  return instruments.map((inst) => {
    const group = groupByISIN.get(inst.isin)
    return {
      ...inst,
      dedupGroup: group?.key,
      isDedupWinner: winnerISINs.has(inst.isin),
      dedupCandidates: group?.candidateISINs.filter((isin) => isin !== inst.isin),
    }
  })
}
