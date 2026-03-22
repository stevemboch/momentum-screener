import { useCallback, useEffect, useRef } from 'react'
import { useAppState, useDisplayedInstruments } from '../store'
import type { Instrument } from '../types'
import { parseXetraCSV, xetraRowToInstrument, parseManualInput, parseCSVFileDetailed, resolveInstrumentType, toDisplayName } from '../utils/parsers'
import { buildDedupGroups, applyDedupToInstruments, isUnclassifiedInstrument } from '../utils/dedup'
import { calculateReturns, recalculateAll, calculateTfaPhase1Gate, calculateTfaPhase2Gate, calculateTfaTDetails, calculateTfaFDetails, calculateTfaFDetails5Y } from '../utils/calculations'
import { apiFetchJson, apiFetchText } from '../api/client'

/**
 * Leitet die Financial Currency (Berichtswährung) aus dem ISIN-Prefix ab.
 * Das ist deterministisch und unabhängig von Yahoo-Feldern.
 *
 * Relevant für Xetra-gelistete Fremdwährungstitel: US-Aktien handeln in EUR
 * auf Xetra, aber Analystenpreisziele sind immer in USD.
 */
function isinToFinancialCurrency(isin: string | null | undefined): string | null {
  if (!isin) return null
  const prefix = isin.slice(0, 2).toUpperCase()
  const map: Record<string, string> = {
    US: 'USD',
    CA: 'CAD',
    GB: 'GBP',
    AU: 'AUD',
    NZ: 'NZD',
    JP: 'JPY',
    HK: 'HKD',
    SG: 'SGD',
    KR: 'KRW',
    CN: 'CNY',
    IN: 'INR',
    BR: 'BRL',
    ZA: 'ZAR',
    CH: 'CHF',
    SE: 'SEK',
    NO: 'NOK',
    DK: 'DKK',
    // Eurozone — alle liefern EUR
    DE: 'EUR', FR: 'EUR', NL: 'EUR', BE: 'EUR', ES: 'EUR', IT: 'EUR',
    PT: 'EUR', AT: 'EUR', FI: 'EUR', IE: 'EUR', LU: 'EUR', GR: 'EUR',
    // ISIN für Fonds/ETFs hat keinen klaren Ländercode
  }
  return map[prefix] ?? null
}

const YAHOO_FETCH_CONCURRENCY_LIMIT = 8
const OPENFIGI_BATCH = 75
const OPENFIGI_DELAY = 100
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const OPENFIGI_TTL_MS = 30 * 24 * 60 * 60 * 1000
const OPENFIGI_CLIENT_TIMEOUT_MS = 30_000
const XETRA_TTL_MS = 30 * 24 * 60 * 60 * 1000
const YAHOO_TTL_MS = 24 * 60 * 60 * 1000
const ANALYST_TTL_MS = 2 * 24 * 60 * 60 * 1000
const LEEWAY_TTL_MS = 7 * 24 * 60 * 60 * 1000
const LEEWAY_TOP_N = 50
const LEEWAY_EXTENDED_N = 100
const LEEWAY_EXTEND_AFTER_MS = 36 * 60 * 60 * 1000
const TFA_AUTO_FUNDAMENTALS_LIMIT = 25
const TFA_CATALYST_TTL_MS = 24 * 60 * 60 * 1000
const STATUS_EMIT_INTERVAL_MS = 250
const STATUS_EMIT_MIN_DELTA_ITEMS = 5
const STATUS_EMIT_MIN_DELTA_PCT = 0.01
const LEEWAY_START_DELAY_MS = 1500
const CACHE_EVICT_MAX_KEYS = 80
const CACHE_RECOVERY_COOLDOWN_MS = 1000
const OPENFIGI_CACHE_WRITE_COOLDOWN_MS = 30_000
const YAHOO_STOCK_BATCH_MIN = 4
const YAHOO_STOCK_BATCH_MAX = 10
const YAHOO_FUND_BATCH_MIN = 6
const YAHOO_FUND_BATCH_MAX = 14
const YAHOO_REQUEST_CONCURRENCY_MAX = 6
const YAHOO_REQUEST_CONCURRENCY_MIN = 2
const YAHOO_ADAPTIVE_COOLDOWN_MS = 12_000
const YAHOO_ADAPTIVE_MIN_TASKS = 16
const YAHOO_P95_SLOW_MS = 5000
const YAHOO_P95_FAST_MS = 2200
const YAHOO_BAD_ERROR_RATE = 0.15
const YAHOO_GOOD_ERROR_RATE = 0.03
const YAHOO_BAD_STREAK_REQUIRED = 2
const YAHOO_GOOD_STREAK_REQUIRED = 3
const YAHOO_ADAPTIVE_WARMUP_RUNS = 3

function isBlockingLeewayPhase(phase: string): boolean {
  return phase === 'prices' || phase === 'openfigi' || phase === 'justetf' || phase === 'dedup'
}

const hasStorage = () => typeof window !== 'undefined' && typeof localStorage !== 'undefined'
let lastCacheRecoveryAttemptTs = 0
let lastCacheWriteWarnTs = 0
let openFigiCacheWritesBlockedUntilTs = 0
let yahooStockBatchSize = 6
let yahooFundBatchSize = 10
let yahooRequestConcurrencyHint = 4
let lastYahooAdaptiveTuneTs = 0
let yahooAdaptiveRunCount = 0
let yahooBadStreak = 0
let yahooGoodStreak = 0

function clamp(num: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, num))
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))
  return sorted[idx]
}

function normalizeTickerForCache(ticker: string): string {
  return ticker.trim().toUpperCase()
}

function normalizeMnemonicForCache(mnemonic?: string): string | null {
  if (!mnemonic) return null
  const normalized = mnemonic.trim().toUpperCase()
  return normalized.length > 0 ? normalized : null
}

function buildYahooCacheKey(ticker: string): string {
  return `cache:yahoo:v2:${normalizeTickerForCache(ticker)}`
}

function buildLegacyYahooCacheKey(ticker: string): string {
  return `cache:yahoo:${ticker}`
}

function buildAnalystCacheKey(ticker: string, mnemonic?: string): string {
  const m = normalizeMnemonicForCache(mnemonic) ?? '__NO_MNEMONIC__'
  return `cache:analyst:v4:${normalizeTickerForCache(ticker)}:${m}`
}

function buildLegacyAnalystCacheKey(ticker: string): string {
  return `cache:analyst:v4:${ticker}`
}

function buildOpenFigiCacheKey(idType: string, idValue: string): string {
  return `cache:openfigi:v3:${idType}:${idValue.trim().toUpperCase()}`
}

function cacheGet<T>(key: string, ttlMs = CACHE_TTL_MS): T | null {
  if (!hasStorage()) return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const ttl = typeof parsed.ttl === 'number' ? parsed.ttl : ttlMs
    if (Date.now() - (parsed.ts || 0) > ttl) return null
    return parsed.data as T
  } catch {
    return null
  }
}

function parseCacheMeta(raw: string | null): { ts: number; ttl: number } | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const ts = typeof parsed.ts === 'number' ? parsed.ts : 0
    const ttl = typeof parsed.ttl === 'number' ? parsed.ttl : CACHE_TTL_MS
    return { ts, ttl }
  } catch {
    return null
  }
}

function removeExpiredCacheEntries(now = Date.now()): number {
  if (!hasStorage()) return 0
  let removed = 0
  const keys = Object.keys(localStorage).filter((k) => k.startsWith('cache:'))
  for (const cacheKey of keys) {
    const meta = parseCacheMeta(localStorage.getItem(cacheKey))
    if (!meta || meta.ts <= 0) continue
    if (now - meta.ts > meta.ttl) {
      localStorage.removeItem(cacheKey)
      removed++
    }
  }
  return removed
}

function evictOldestCacheEntries(limit: number, avoidKey?: string): number {
  if (!hasStorage()) return 0
  const entries: Array<{ key: string; ts: number }> = []
  const keys = Object.keys(localStorage).filter((k) => k.startsWith('cache:'))
  for (const cacheKey of keys) {
    if (cacheKey === avoidKey) continue
    const meta = parseCacheMeta(localStorage.getItem(cacheKey))
    if (!meta) continue
    entries.push({ key: cacheKey, ts: meta.ts })
  }
  entries.sort((a, b) => a.ts - b.ts)
  const toRemove = Math.min(limit, entries.length)
  for (let i = 0; i < toRemove; i++) {
    localStorage.removeItem(entries[i].key)
  }
  return toRemove
}

function cacheSet<T>(key: string, data: T, ttlMs = CACHE_TTL_MS, options?: { allowRecovery?: boolean }): boolean {
  if (!hasStorage()) return false
  const allowRecovery = options?.allowRecovery !== false
  const payload = JSON.stringify({ ts: Date.now(), ttl: ttlMs, data })
  try {
    localStorage.setItem(key, payload)
    return true
  } catch {
    if (!allowRecovery) return false
    const now = Date.now()
    if (now - lastCacheRecoveryAttemptTs >= CACHE_RECOVERY_COOLDOWN_MS) {
      lastCacheRecoveryAttemptTs = now
      try {
        removeExpiredCacheEntries(now)
      } catch {
        // ignore cleanup errors
      }
      try {
        evictOldestCacheEntries(CACHE_EVICT_MAX_KEYS, key)
      } catch {
        // ignore cleanup errors
      }
    }

    try {
      localStorage.setItem(key, payload)
      return true
    } catch {
      if (now - lastCacheWriteWarnTs > 10_000) {
        lastCacheWriteWarnTs = now
        // Without this signal cache failures look like random cold fetches.
        console.warn(`[cache] localStorage quota prevents cache writes (key=${key})`)
      }
      return false
    }
  }
}

function canWriteOpenFigiCache(now = Date.now()): boolean {
  return now >= openFigiCacheWritesBlockedUntilTs
}

function blockOpenFigiCacheWrites(now = Date.now()) {
  openFigiCacheWritesBlockedUntilTs = now + OPENFIGI_CACHE_WRITE_COOLDOWN_MS
}

interface OpenFIGIResult { name?: string; securityDescription?: string; isin?: string; ticker?: string; securityType?: string; securityType2?: string }
interface OpenFIGIEmptyCache { __empty: true }
type OpenFIGICacheEntry = OpenFIGIResult | OpenFIGIEmptyCache
interface StatsResult { isin: string; name: string | null; aum: number | null; ter: null }
type YahooProfile = 'stock' | 'fund'
interface YahooRequestOptions { includeWeekly?: boolean; profile?: YahooProfile }
interface YahooFetchTask {
  ticker: string
  profile: YahooProfile
  includeWeekly: boolean
  resultIndices: number[]
}

async function apiOpenFIGI(jobs: { idType: string; idValue: string }[]): Promise<Array<OpenFIGIResult | null>> {
  return apiFetchJson<Array<OpenFIGIResult | null>>('/api/openfigi', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(jobs),
    timeoutMs: OPENFIGI_CLIENT_TIMEOUT_MS,
  })
}

function getYahooRequestOptions(inst: Instrument): Required<YahooRequestOptions> {
  const isFundLike = inst.type === 'ETF' || inst.type === 'ETC' || inst.type === 'ETN'
  return {
    includeWeekly: !isFundLike,
    profile: isFundLike ? 'fund' : 'stock',
  }
}

async function apiYahooBatch(tickers: string[], options?: YahooRequestOptions): Promise<any[]> {
  if (tickers.length === 0) return []
  const data = await apiFetchJson<any[]>('/api/yahoo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tickers,
      includeWeekly: options?.includeWeekly,
      profile: options?.profile,
    }),
  })
  return Array.isArray(data) ? data : []
}

async function apiYahooSingle(ticker: string, options?: YahooRequestOptions): Promise<any> {
  const data = await apiYahooBatch([ticker], options)
  return data[0] ?? null
}

async function apiStats(isins: string[]): Promise<StatsResult[]> {
  return apiFetchJson<StatsResult[]>('/api/xetra-stats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isins }),
  })
}

async function apiXetra() {
  const cached = cacheGet<string>('cache:xetra', XETRA_TTL_MS)
  if (cached) return cached
  const text = await apiFetchText('/api/xetra')
  cacheSet('cache:xetra', text, XETRA_TTL_MS)
  return text
}

async function parallelLimit<T>(tasks: (() => Promise<T>)[], limit: number, onProgress?: (done: number, total: number) => void): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let nextIdx = 0, done = 0
  async function worker() {
    while (nextIdx < tasks.length) {
      const idx = nextIdx++
      results[idx] = await tasks[idx]()
      done++
      onProgress?.(done, tasks.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()))
  return results
}

async function processBatches<T, R>(items: T[], batchSize: number, delay: number, processor: (batch: T[]) => Promise<R[]>, onProgress?: (done: number, total: number) => void): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    results.push(...await processor(batch))
    onProgress?.(Math.min(i + batchSize, items.length), items.length)
    if (delay > 0 && i + batchSize < items.length) await new Promise((r) => setTimeout(r, delay))
  }
  return results
}

function applyStatsResults(instruments: Instrument[], statsResults: StatsResult[]): Instrument[] {
  const statsMap = new Map(statsResults.map((r) => [r.isin, r]))
  return instruments.map((inst) => {
    const r = statsMap.get(inst.isin)
    if (!r) return inst
    return { ...inst, aum: r.aum ?? null, ter: null, justEtfFetched: true, displayName: inst.longName ? inst.displayName : (r.name || inst.displayName) }
  })
}

export function usePipeline() {
  const { state, dispatch } = useAppState()
  const displayedInstruments = useDisplayedInstruments()
  const abortRef = useRef(false)
  const xetraBuffer = useRef<Instrument[]>([])
  const tfaInFlight = useRef<Set<string>>(new Set())
  const tfaFundInFlight = useRef<Set<string>>(new Set())
  const tfaAutoRunning = useRef(false)
  const leewayRunning = useRef(false)
  const leewayStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastStatusEmitRef = useRef<{
    phase: string
    message: string
    current: number
    total: number
    ts: number
  }>({
    phase: state.fetchStatus.phase,
    message: state.fetchStatus.message,
    current: state.fetchStatus.current,
    total: state.fetchStatus.total,
    ts: 0,
  })

  const setStatus = useCallback((message: string, current = 0, total = 0) => {
    const phase = state.fetchStatus.phase
    const now = Date.now()
    const prev = lastStatusEmitRef.current
    const progressDeltaAbs = Math.abs(current - prev.current)
    const denominator = total > 0 ? total : (prev.total > 0 ? prev.total : 0)
    const progressDeltaPct = denominator > 0 ? progressDeltaAbs / denominator : (progressDeltaAbs > 0 ? 1 : 0)
    const progressDeltaMinItems = Math.max(
      STATUS_EMIT_MIN_DELTA_ITEMS,
      denominator > 0 ? Math.ceil(denominator * STATUS_EMIT_MIN_DELTA_PCT) : STATUS_EMIT_MIN_DELTA_ITEMS
    )

    const shouldEmit =
      prev.phase !== phase ||
      prev.message !== message ||
      (total > 0 && current >= total) ||
      (
        now - prev.ts >= STATUS_EMIT_INTERVAL_MS &&
        (progressDeltaAbs >= progressDeltaMinItems || progressDeltaPct >= STATUS_EMIT_MIN_DELTA_PCT)
      )

    if (!shouldEmit) return

    lastStatusEmitRef.current = { phase, message, current, total, ts: now }
    dispatch({ type: 'SET_FETCH_STATUS', status: { message, current, total } })
  }, [dispatch, state.fetchStatus.phase])

  const enrichWithOpenFIGI = useCallback(async (instruments: Instrument[]): Promise<Instrument[]> => {
    const jobs = instruments.map((inst) => {
      if (inst.isin?.length === 12) return { idType: 'ID_ISIN', idValue: inst.isin }
      if (inst.wkn?.length === 6) return { idType: 'ID_WERTPAPIER', idValue: inst.wkn }
      return { idType: 'TICKER', idValue: inst.mnemonic || inst.yahooTicker }
    })
    const jobKeyToIndexes = new Map<string, number[]>()
    const jobByKey = new Map<string, { idType: string; idValue: string }>()
    jobs.forEach((job, idx) => {
      const key = `${job.idType}:${job.idValue.trim().toUpperCase()}`
      const indices = jobKeyToIndexes.get(key)
      if (indices) indices.push(idx)
      else {
        jobKeyToIndexes.set(key, [idx])
        jobByKey.set(key, job)
      }
    })

    const uniqueKeys = Array.from(jobKeyToIndexes.keys())
    const results: Array<OpenFIGIResult | null> = new Array(jobs.length).fill(null)
    const missingUnique: Array<{ key: string; job: { idType: string; idValue: string } }> = []
    uniqueKeys.forEach((key) => {
      const job = jobByKey.get(key)
      if (!job) return
      const cached = cacheGet<OpenFIGICacheEntry>(buildOpenFigiCacheKey(job.idType, job.idValue), OPENFIGI_TTL_MS)
      if (cached) {
        const resolved: OpenFIGIResult | null = '__empty' in cached ? null : cached
        const indices = jobKeyToIndexes.get(key) || []
        for (const idx of indices) results[idx] = resolved
      } else {
        missingUnique.push({ key, job })
      }
    })

    if (missingUnique.length > 0) {
      const fetched = await processBatches(
        missingUnique.map((m) => m.job),
        OPENFIGI_BATCH,
        OPENFIGI_DELAY,
        async (batch) => {
          try {
            const rows = await apiOpenFIGI(batch)
            if (rows.length === batch.length) return rows
            const padded = new Array<OpenFIGIResult | null>(batch.length).fill(null)
            for (let i = 0; i < batch.length; i++) padded[i] = rows[i] ?? null
            return padded
          } catch (err: any) {
            console.warn(`[openfigi] batch failed; continuing without enrichment (${err?.message || 'unknown error'})`)
            return new Array<OpenFIGIResult | null>(batch.length).fill(null)
          }
        },
        (done, total) => setStatus(`Enriching names: ${done} / ${total}`, done, total)
      )
      let cacheWritesAllowed = canWriteOpenFigiCache()
      fetched.forEach((r, i) => {
        const miss = missingUnique[i]
        if (!miss) return
        const indices = jobKeyToIndexes.get(miss.key) || []
        for (const idx of indices) results[idx] = r ?? null
        if (!cacheWritesAllowed) return
        const cacheValue: OpenFIGICacheEntry = r ?? { __empty: true }
        const cacheOk = cacheSet(
          buildOpenFigiCacheKey(miss.job.idType, miss.job.idValue),
          cacheValue,
          OPENFIGI_TTL_MS,
          { allowRecovery: true }
        )
        if (!cacheOk) {
          blockOpenFigiCacheWrites()
          cacheWritesAllowed = false
          console.warn('[openfigi] cache writes paused after quota pressure; proceeding without cache writes')
        }
      })
    } else {
      setStatus(`Enriching names: ${jobs.length} / ${jobs.length}`, jobs.length, jobs.length)
    }

    return instruments.map((inst, i) => {
      const figi = results[i]
      if (!figi) return inst
      const candidateNames = [figi.securityDescription, figi.name].filter((v): v is string => !!v && v.trim().length > 1)
      const longName: string | undefined =
        candidateNames.length === 0 ? undefined : candidateNames.sort((a, b) => b.length - a.length)[0]
      const type = inst.source === 'xetra' ? inst.type : resolveInstrumentType(figi.securityType ?? null, figi.securityType2 ?? null, inst.isin)
      const ticker = figi.ticker || undefined
      let yahooTicker = inst.yahooTicker
      if (!yahooTicker && ticker) {
        yahooTicker = ticker.includes('.') ? ticker : `${ticker}.DE`
      }
      const mappedIsin = figi.isin && figi.isin.length === 12 ? figi.isin : undefined
      return {
        ...inst,
        isin: mappedIsin || inst.isin,
        longName,
        type,
        yahooTicker,
        displayName: toDisplayName(longName, inst.displayName),
      }
    })
  }, [])

  const ensureReferenceR3m = useCallback(async () => {
    if (state.referenceR3m != null) return state.referenceR3m
    try {
      const r = await apiYahooSingle('URTH', { includeWeekly: false, profile: 'fund' })
      if (r?.closes?.length) {
        const { r3m } = calculateReturns(r.closes)
        dispatch({ type: 'SET_REFERENCE_R3M', r3m: r3m ?? null })
        return r3m ?? null
      }
    } catch {
      // ignore
    }
    return null
  }, [state.referenceR3m, dispatch])

  const fetchPrices = useCallback(async (instruments: Instrument[]): Promise<Instrument[]> => {
    const withTickers = instruments.filter((i) => i.yahooTicker)
    if (withTickers.length === 0) return instruments
    const cachedResults: any[] = new Array(withTickers.length)
    const tasksByKey = new Map<string, YahooFetchTask>()
    let cachedCount = 0
    withTickers.forEach((inst, idx) => {
      const key = buildYahooCacheKey(inst.yahooTicker)
      let cached = cacheGet<any>(key, YAHOO_TTL_MS)
      if (!cached) {
        const legacy = cacheGet<any>(buildLegacyYahooCacheKey(inst.yahooTicker), YAHOO_TTL_MS)
        if (legacy) {
          cached = legacy
          cacheSet(key, legacy, YAHOO_TTL_MS)
        }
      }
      if (cached) {
        cachedResults[idx] = cached
        cachedCount++
      }
      else {
        const options = getYahooRequestOptions(inst)
        const taskKey = `${inst.yahooTicker}|${options.profile}|${options.includeWeekly ? '1' : '0'}`
        const existing = tasksByKey.get(taskKey)
        if (existing) {
          existing.resultIndices.push(idx)
        } else {
          tasksByKey.set(taskKey, {
            ticker: inst.yahooTicker,
            profile: options.profile,
            includeWeekly: options.includeWeekly,
            resultIndices: [idx],
          })
        }
      }
    })
    const tasks = Array.from(tasksByKey.values())
    const limit = YAHOO_FETCH_CONCURRENCY_LIMIT
    const requestGroups = [
      {
        profile: 'stock' as YahooProfile,
        includeWeekly: true,
        items: tasks.filter((t) => t.profile === 'stock' && t.includeWeekly),
      },
      {
        profile: 'fund' as YahooProfile,
        includeWeekly: false,
        items: tasks.filter((t) => t.profile === 'fund' && !t.includeWeekly),
      },
    ].filter((g) => g.items.length > 0)

    let done = cachedCount
    setStatus(`Fetching prices: ${done} / ${withTickers.length}`, done, withTickers.length)

    const fetched: Array<{ task: (typeof tasks)[number]; result: any }> = []
    const batchJobs: Array<{ profile: YahooProfile; includeWeekly: boolean; batch: YahooFetchTask[] }> = []
    for (const group of requestGroups) {
      const batchSize = group.profile === 'fund' ? yahooFundBatchSize : yahooStockBatchSize
      for (let i = 0; i < group.items.length; i += batchSize) {
        batchJobs.push({
          profile: group.profile,
          includeWeekly: group.includeWeekly,
          batch: group.items.slice(i, i + batchSize),
        })
      }
    }

    const batchLatenciesMs: number[] = []
    const requestConcurrency = Math.max(
      YAHOO_REQUEST_CONCURRENCY_MIN,
      Math.min(YAHOO_REQUEST_CONCURRENCY_MAX, limit, yahooRequestConcurrencyHint)
    )
    const batchResults = batchJobs.length > 0
      ? await parallelLimit(
          batchJobs.map((job) => async () => {
            const { batch } = job
            const startedAt = Date.now()
            try {
              const tickers = batch.map((t) => t.ticker)
              const payload = await apiYahooBatch(tickers, {
                profile: job.profile,
                includeWeekly: job.includeWeekly,
              })
              return batch.map((task, idx) => ({
                task,
                result: payload[idx] ?? { error: 'Empty Yahoo payload', ticker: task.ticker },
              }))
            } catch (err: any) {
              return batch.map((task) => ({
                task,
                result: { error: err?.message ?? 'Yahoo batch failed', ticker: task.ticker },
              }))
            } finally {
              batchLatenciesMs.push(Date.now() - startedAt)
              done += batch.reduce((sum, item) => sum + item.resultIndices.length, 0)
              setStatus(`Fetching prices: ${done} / ${withTickers.length}`, done, withTickers.length)
            }
          }),
          requestConcurrency,
        )
      : []
    fetched.push(...batchResults.flat())

    const results = [...cachedResults]
    fetched.forEach(({ task, result }) => {
      for (const resultIdx of task.resultIndices) {
        results[resultIdx] = result
      }
      if (result) cacheSet(buildYahooCacheKey(task.ticker), result, YAHOO_TTL_MS)
    })

    const errorCount = fetched.filter(({ result }) => !result || result.error).length
    const errorRate = fetched.length > 0 ? errorCount / fetched.length : 0
    const p95BatchLatencyMs = percentile(batchLatenciesMs, 0.95)

    const now = Date.now()
    if (tasks.length >= YAHOO_ADAPTIVE_MIN_TASKS) {
      yahooAdaptiveRunCount += 1
    }

    const isWarmup = yahooAdaptiveRunCount <= YAHOO_ADAPTIVE_WARMUP_RUNS
    const isBadWindow = errorRate >= YAHOO_BAD_ERROR_RATE || p95BatchLatencyMs >= YAHOO_P95_SLOW_MS
    const isGoodWindow = errorRate <= YAHOO_GOOD_ERROR_RATE && p95BatchLatencyMs > 0 && p95BatchLatencyMs <= YAHOO_P95_FAST_MS

    if (isBadWindow) {
      yahooBadStreak += 1
      yahooGoodStreak = 0
    } else if (isGoodWindow) {
      yahooGoodStreak += 1
      yahooBadStreak = 0
    } else {
      yahooBadStreak = 0
      yahooGoodStreak = 0
    }

    if (
      tasks.length >= YAHOO_ADAPTIVE_MIN_TASKS &&
      !isWarmup &&
      now - lastYahooAdaptiveTuneTs >= YAHOO_ADAPTIVE_COOLDOWN_MS
    ) {
      let changed = false
      if (yahooBadStreak >= YAHOO_BAD_STREAK_REQUIRED) {
        if (yahooRequestConcurrencyHint > YAHOO_REQUEST_CONCURRENCY_MIN) {
          yahooRequestConcurrencyHint = clamp(
            yahooRequestConcurrencyHint - 1,
            YAHOO_REQUEST_CONCURRENCY_MIN,
            YAHOO_REQUEST_CONCURRENCY_MAX
          )
          changed = true
        } else if (yahooStockBatchSize > YAHOO_STOCK_BATCH_MIN) {
          yahooStockBatchSize = clamp(yahooStockBatchSize - 1, YAHOO_STOCK_BATCH_MIN, YAHOO_STOCK_BATCH_MAX)
          changed = true
        } else if (yahooFundBatchSize > YAHOO_FUND_BATCH_MIN) {
          yahooFundBatchSize = clamp(yahooFundBatchSize - 1, YAHOO_FUND_BATCH_MIN, YAHOO_FUND_BATCH_MAX)
          changed = true
        }
        if (changed) {
          yahooBadStreak = 0
          yahooGoodStreak = 0
        }
      } else if (yahooGoodStreak >= YAHOO_GOOD_STREAK_REQUIRED) {
        if (yahooRequestConcurrencyHint < YAHOO_REQUEST_CONCURRENCY_MAX) {
          yahooRequestConcurrencyHint = clamp(
            yahooRequestConcurrencyHint + 1,
            YAHOO_REQUEST_CONCURRENCY_MIN,
            YAHOO_REQUEST_CONCURRENCY_MAX
          )
          changed = true
        } else if (yahooStockBatchSize < YAHOO_STOCK_BATCH_MAX) {
          yahooStockBatchSize = clamp(yahooStockBatchSize + 1, YAHOO_STOCK_BATCH_MIN, YAHOO_STOCK_BATCH_MAX)
          changed = true
        } else if (yahooFundBatchSize < YAHOO_FUND_BATCH_MAX) {
          yahooFundBatchSize = clamp(yahooFundBatchSize + 1, YAHOO_FUND_BATCH_MIN, YAHOO_FUND_BATCH_MAX)
          changed = true
        }
        if (changed) {
          yahooBadStreak = 0
          yahooGoodStreak = 0
        }
      }

      if (changed) {
        lastYahooAdaptiveTuneTs = now
      }
    }

    const updated = [...instruments]
    const byTicker = new Map<string, number[]>()
    updated.forEach((inst, idx) => {
      if (!inst.yahooTicker) return
      const current = byTicker.get(inst.yahooTicker)
      if (current) current.push(idx)
      else byTicker.set(inst.yahooTicker, [idx])
    })
    const appliedTickers = new Set<string>()
    results.forEach((r: any, i) => {
      if (!r) return
      const ticker = withTickers[i].yahooTicker
      if (appliedTickers.has(ticker)) return
      appliedTickers.add(ticker)
      const targetIndices = byTicker.get(ticker)
      if (!targetIndices || targetIndices.length === 0) return
      for (const idx of targetIndices) {
        const shouldReplaceName = r.longName && isUnclassifiedInstrument(updated[idx])
        const nextLongName = shouldReplaceName ? r.longName : updated[idx].longName
        updated[idx] = {
          ...updated[idx],
          closes: r.closes || [],
          highs: r.highs || [],
          lows: r.lows || [],
          volumes: r.volumes || [],
          timestamps: r.timestamps || [],
          closesWeekly: r.closesWeekly ?? updated[idx].closesWeekly ?? [],
          timestampsWeekly: r.timestampsWeekly ?? updated[idx].timestampsWeekly ?? [],
          priceCurrency: r.currency ?? updated[idx].priceCurrency ?? null,
          currency: updated[idx].currency ?? r.currency ?? null,
          marketCap: r.marketCap ?? updated[idx].marketCap ?? null,
          pe: r.pe ?? null, pb: r.pb ?? null,
          ebitda: r.ebitda ?? null, enterpriseValue: r.enterpriseValue ?? null,
          returnOnAssets: r.returnOnAssets ?? null,
          yahooLongName: r.longName ?? updated[idx].yahooLongName,
          longName: nextLongName,
          displayName: nextLongName ? toDisplayName(nextLongName, updated[idx].displayName) : updated[idx].displayName,
          priceFetched: true, priceError: r.error, fundamentalsFetched: true,
        }
      }
    })
    return updated
  }, [])

  const fetchStats = useCallback(async (instruments: Instrument[]): Promise<Instrument[]> => {
    const etfs = instruments.filter((i) => i.type === 'ETF' || i.type === 'ETC')
    if (etfs.length === 0) return instruments
    const allResults = await processBatches(etfs, 200, 0, (batch) => apiStats(batch.map((e) => e.isin)), (done, total) => setStatus(`Fetching AUM: ${done} / ${total} ETFs`, done, total))
    return applyStatsResults(instruments, allResults)
  }, [])

  const processManualInput = useCallback(async (text: string, isCSV = false) => {
    abortRef.current = false
    dispatch({ type: 'SET_FETCH_STATUS', status: { phase: 'openfigi', message: 'Parsing input...', current: 0, total: 0 } })
    const csvParsed = isCSV ? parseCSVFileDetailed(text) : null
    const parsed = csvParsed ? csvParsed.identifiers : parseManualInput(text)
    if (parsed.length === 0) {
      const csvHint = csvParsed && csvParsed.meta.warnings.length > 0
        ? ` (${csvParsed.meta.skipped} rows skipped)`
        : ''
      dispatch({ type: 'SET_FETCH_STATUS', status: { phase: 'idle', message: `No valid identifiers found${csvHint}`, current: 0, total: 0 } })
      return
    }
    const existing = state.instruments
    const findExisting = (p: { type: string; normalized: string }) => {
      const norm = p.normalized.toUpperCase()
      return existing.find((inst) => {
        if (p.type === 'ISIN') return inst.isin === norm
        if (p.type === 'WKN') return inst.wkn?.toUpperCase() === norm || inst.isin === norm
        const mnemonic = inst.mnemonic?.toUpperCase()
        const yahooBase = inst.yahooTicker?.split('.')[0]?.toUpperCase()
        return mnemonic === norm || yahooBase === norm
      })
    }
    const existingHits: Instrument[] = []
    const newParsed = parsed.filter((p) => {
      const hit = findExisting(p)
      if (hit) existingHits.push(hit)
      return !hit
    })

    const stubs: Instrument[] = newParsed.map((p) => {
      const yahooTicker = p.type === 'Ticker' ? (p.normalized.includes('.') ? p.normalized : `${p.normalized}.DE`) : ''
      const tempIsin =
        p.type === 'ISIN' ? p.normalized :
        p.type === 'WKN' ? `WKN:${p.normalized}` :
        `TICKER:${p.normalized}`
      return {
        isin: tempIsin,
        wkn: p.type === 'WKN' ? p.normalized : undefined,
        mnemonic: p.type === 'Ticker' ? p.normalized : undefined,
        yahooTicker,
        type: 'Unknown' as const,
        source: 'manual' as const,
        displayName: p.raw,
      }
    })
    try {
      if (existingHits.length > 0) {
        const toRefresh = existingHits.filter((i) => !i.priceFetched && i.yahooTicker)
        if (toRefresh.length > 0) {
          dispatch({ type: 'SET_FETCH_STATUS', status: { phase: 'prices', message: '', current: 0, total: 0 } })
          const refreshed = await fetchPrices(toRefresh)
          const updates = new Map(refreshed.map((i) => [i.isin, { ...i }]))
          dispatch({ type: 'UPDATE_INSTRUMENTS', updates })
        }
      }

      if (stubs.length === 0) {
        dispatch({ type: 'SET_FETCH_STATUS', status: { phase: 'done', message: `Updated ${existingHits.length} instruments`, current: existingHits.length, total: existingHits.length } })
        return
      }

      setStatus('Looking up names...', 0, stubs.length)
      let enriched = stubs
      try {
        enriched = await enrichWithOpenFIGI(stubs)
      } catch {
        // Fallback: proceed with raw input if OpenFIGI fails
        setStatus('OpenFIGI failed, using raw input...', 0, stubs.length)
      }

      // If WKNs still lack a real ISIN, try Xetra CSV as fallback (on-demand)
      const needsWknResolution = enriched.some((i) =>
        (!i.isin || i.isin.startsWith('WKN:') || i.isin.startsWith('TICKER:') || i.isin.length !== 12)
      )
      if (needsWknResolution) {
        try {
          setStatus('Resolving WKNs via Xetra...', 0, 0)
          const csvText = await apiXetra()
          const rows = parseXetraCSV(csvText)
          const normalizeWkn = (v?: string) => (v || '').replace(/^0+/, '').toUpperCase()
          const byWkn = new Map<string, any>()
          rows.filter((r) => r.wkn).forEach((r) => {
            const raw = r.wkn.toUpperCase()
            byWkn.set(raw, r)
            const norm = normalizeWkn(raw)
            if (norm) byWkn.set(norm, r)
          })
          const byIsin = new Map(rows.filter((r) => r.isin).map((r) => [r.isin.toUpperCase(), r]))
          const byMnemonic = new Map(rows.filter((r) => r.mnemonic).map((r) => [r.mnemonic.toUpperCase(), r]))
          enriched = enriched.map((inst) => {
            let row = null as any
            if (inst.wkn) {
              row = byWkn.get(inst.wkn.toUpperCase()) || byWkn.get(normalizeWkn(inst.wkn))
            }
            if (!row && inst.isin && inst.isin.length === 12) {
              row = byIsin.get(inst.isin.toUpperCase())
            }
            if (!row) {
              const base = (inst.mnemonic || inst.yahooTicker?.split('.')[0] || '').toUpperCase()
              if (base) row = byMnemonic.get(base)
            }
            if (!row) return inst
            const yahooTicker = row.mnemonic ? `${row.mnemonic}.DE` : inst.yahooTicker
            return {
              ...inst,
              isin: row.isin,
              mnemonic: row.mnemonic || inst.mnemonic,
              yahooTicker,
              currency: row.currency || inst.currency,
              xetraGroup: row.group || inst.xetraGroup,
              xetraName: row.instrument || inst.xetraName,
              displayName: inst.displayName || row.instrument,
            }
          })
        } catch {
          // ignore
        }
      }
      const baseTicker = (t?: string) => t?.split('.')?.[0]?.toUpperCase()
      const existingByBaseTicker = new Map(
        state.instruments
          .map((i) => [baseTicker(i.yahooTicker), i])
          .filter(([k]) => k) as [string, Instrument][]
      )
      // If OpenFIGI provided ticker but no ISIN, try to map to existing by base ticker
      enriched = enriched.map((inst) => {
        if (!inst.isin && inst.yahooTicker) {
          const hit = existingByBaseTicker.get(baseTicker(inst.yahooTicker) || '')
          if (hit) {
            return { ...inst, isin: hit.isin, wkn: inst.wkn || hit.wkn }
          }
        }
        return inst
      })
      dispatch({ type: 'SET_FETCH_STATUS', status: { phase: 'prices', message: '', current: 0, total: 0 } })
      const withPrices = await fetchPrices(enriched)
      const refR3m = await ensureReferenceR3m()
      dispatch({ type: 'SET_FETCH_STATUS', status: { phase: 'justetf', message: '', current: 0, total: 0 } })
      const withStats = await fetchStats(withPrices)
      const existingByYahoo = new Map(state.instruments.map((i) => [i.yahooTicker, i]))
      const existingByBase = new Map(
        state.instruments
          .map((i) => [baseTicker(i.yahooTicker), i])
          .filter(([k]) => k) as [string, Instrument][]
      )
      const existingByIsin = new Map(state.instruments.map((i) => [i.isin, i]))
      const existingByWkn = new Map(state.instruments.map((i) => [i.wkn, i]))

      const updates = new Map<string, Partial<Instrument>>()
      const toAdd: Instrument[] = []
      for (const inst of withStats) {
        const existing =
          (inst.yahooTicker && existingByYahoo.get(inst.yahooTicker)) ||
          (inst.yahooTicker && existingByBase.get(baseTicker(inst.yahooTicker) || '')) ||
          existingByIsin.get(inst.isin) ||
          (inst.wkn && existingByWkn.get(inst.wkn)) ||
          existingByIsin.get(inst.wkn || '')
        if (existing) {
          updates.set(existing.isin, { ...existing, ...inst })
        } else {
          // Skip adding if ISIN is unresolved for WKN (unless we have a temp ID)
          if (inst.wkn && (!inst.isin || inst.isin === inst.wkn || inst.isin.length !== 12)) {
            if (!inst.isin?.startsWith('WKN:')) continue
          }
          toAdd.push(inst)
        }
      }

      if (updates.size > 0) dispatch({ type: 'UPDATE_INSTRUMENTS', updates })
      if (toAdd.length > 0) {
        dispatch({ type: 'ADD_INSTRUMENTS', instruments: recalculateAll(toAdd, state.settings.weights, state.settings.atrMultiplier, refR3m ?? state.referenceR3m) })
      }
      dispatch({ type: 'SET_FETCH_STATUS', status: { phase: 'done', message: `Added ${withStats.length} instruments`, current: withStats.length, total: withStats.length } })
    } catch (err: any) {
      dispatch({ type: 'SET_FETCH_STATUS', status: { phase: 'error', message: err.message, current: 0, total: 0 } })
    }
  }, [enrichWithOpenFIGI, fetchPrices, fetchStats, ensureReferenceR3m, state.settings.weights, state.settings.atrMultiplier, state.referenceR3m])

  const loadXetraBackground = useCallback(async () => {
    dispatch({ type: 'SET_XETRA_LOADING', loading: true })
    try {
      const csvText = await apiXetra()
      const rows = parseXetraCSV(csvText)
      const instruments = rows.map(xetraRowToInstrument)
      const uniqueByIsin = new Map<string, Instrument>()
      instruments.forEach((inst) => {
        if (!uniqueByIsin.has(inst.isin)) uniqueByIsin.set(inst.isin, inst)
      })
      const dedupedInstruments = Array.from(uniqueByIsin.values())
      const etfCounts: Record<string, number> = {}
      const stockCounts: Record<string, number> = {}
      dedupedInstruments.forEach((inst) => {
        const g = inst.xetraGroup || ''
        if (inst.type === 'Stock') stockCounts[g] = (stockCounts[g] || 0) + 1
        else etfCounts[g] = (etfCounts[g] || 0) + 1
      })
      dispatch({ type: 'SET_GROUP_COUNTS', etf: etfCounts, stock: stockCounts })
      xetraBuffer.current = dedupedInstruments
      dispatch({ type: 'SET_XETRA_READY', ready: true })
      dispatch({ type: 'SET_XETRA_LOADING', loading: false })
    } catch (err: any) {
      dispatch({ type: 'SET_XETRA_LOADING', loading: false })
      dispatch({
        type: 'SET_FETCH_STATUS',
        status: {
          phase: 'error',
          message: `Xetra CSV konnte nicht geladen werden: ${err.message}`,
          current: 0,
          total: 0,
        },
      })
    }
  }, [])

  const activateXetra = useCallback(async () => {
    abortRef.current = false
    const enabledETFGroups = state.etfGroups.filter((g) => g.enabled).map((g) => g.groupKey)
    const enabledStockGroups = state.stockGroups.filter((g) => g.enabled).map((g) => g.groupKey)
    const instruments = xetraBuffer.current.filter((inst) => {
      if (inst.type === 'Stock') {
        if (enabledStockGroups.includes('__OTHER_STOCKS__')) {
          const inNamedGroup = ['DAX','MDAX','SDAX','DEUTSCHLAND','NORDAMERIKA','FRANKREICH','GROSSBRITANNIEN','SKANDINAVIEN','SCHWEIZ LIECHTENSTEIN','BELGIEN NIEDERLANDE LUXEMBURG','ITALIEN GRIECHENLAND','OESTERREICH','SPANIEN PORTUGAL'].includes(inst.xetraGroup || '')
          return enabledStockGroups.some(g => g === inst.xetraGroup) || !inNamedGroup
        }
        return enabledStockGroups.includes(inst.xetraGroup || '')
      }
      return enabledETFGroups.includes(inst.xetraGroup || '')
    })
    dispatch({ type: 'SET_XETRA_ACTIVE', active: true })
    dispatch({ type: 'SET_FETCH_STATUS', status: { phase: 'openfigi', message: '', current: 0, total: instruments.length } })
    try {
      setStatus(`Enriching names & fetching AUM...`, 0, instruments.length)
      const etfISINs = instruments.filter((i) => i.type === 'ETF' || i.type === 'ETC').map((i) => i.isin)
      const [enriched, statsResults] = await Promise.all([
        enrichWithOpenFIGI(instruments),
        etfISINs.length > 0 ? apiStats(etfISINs) : Promise.resolve([] as StatsResult[]),
      ])
      dispatch({ type: 'SET_FETCH_STATUS', status: { phase: 'dedup', message: 'Deduplicating...', current: 0, total: 0 } })
      const etfs = enriched.filter((i) => i.type === 'ETF' || i.type === 'ETC')
      const stocks = enriched.filter((i) => i.type === 'Stock')
      const applyDedupAndAum = (items: Instrument[]) => {
        const groups = buildDedupGroups(items)
        const deduped = applyDedupToInstruments(items, groups)
        const withAum = applyStatsResults(deduped, statsResults)
        const aumFloor = state.settings.aumFloor
        const updated = withAum.map((inst) => {
          if (!inst.isDedupWinner) return inst
          if (inst.aum != null && inst.aum < aumFloor) return { ...inst, isDedupWinner: false }
          return inst
        })
        const winnersByGroup = new Map<string, boolean>()
        updated.forEach((inst) => { if (inst.isDedupWinner && inst.dedupGroup) winnersByGroup.set(inst.dedupGroup, true) })
        return updated.map((inst) => {
          if (!inst.dedupGroup || inst.isDedupWinner) return inst
          if (!winnersByGroup.has(inst.dedupGroup)) {
            const aum = inst.aum
            if (aum == null || aum >= aumFloor) { winnersByGroup.set(inst.dedupGroup, true); return { ...inst, isDedupWinner: true } }
          }
          return inst
        })
      }

      const finalEtfs = applyDedupAndAum(etfs)
      const combined = [...finalEtfs, ...stocks]
      const toFetch = combined.filter((i) => i.isDedupWinner !== false || i.type === 'Stock')
      dispatch({ type: 'SET_FETCH_STATUS', status: { phase: 'prices', message: '', current: 0, total: toFetch.length } })
      const withPrices = await fetchPrices(toFetch)
      const refR3m = await ensureReferenceR3m()
      const finalMap = new Map(withPrices.map((i) => [i.isin, i]))
      const final = combined.map((i) => finalMap.get(i.isin) || i)

      // Re-run dedup with Yahoo longName if it unlocked a classification
      const etfsAfter = final.filter((i) => i.type === 'ETF' || i.type === 'ETC')
      const stocksAfter = final.filter((i) => i.type === 'Stock')
      let finalEtfsAfter = applyDedupAndAum(etfsAfter)
      let finalCombined = [...finalEtfsAfter, ...stocksAfter]

      // Ensure new winners have prices
      const winnersAfter = finalEtfsAfter.filter((i) => i.isDedupWinner && !i.priceFetched && i.yahooTicker)
      if (winnersAfter.length > 0) {
        const withMorePrices = await fetchPrices(winnersAfter)
        const moreMap = new Map(withMorePrices.map((i) => [i.isin, i]))
        finalCombined = finalCombined.map((i) => moreMap.get(i.isin) || i)
        finalEtfsAfter = finalCombined.filter((i) => i.type === 'ETF' || i.type === 'ETC')
      }

      const winners = finalEtfsAfter.filter((i) => i.isDedupWinner)
      dispatch({ type: 'ADD_INSTRUMENTS', instruments: recalculateAll(finalCombined, state.settings.weights, state.settings.atrMultiplier, refR3m ?? state.referenceR3m) })
      dispatch({ type: 'SET_FETCH_STATUS', status: { phase: 'done', message: `Loaded ${winners.length} ETF groups + ${stocks.length} stocks`, current: finalCombined.length, total: finalCombined.length } })
    } catch (err: any) {
      dispatch({ type: 'SET_FETCH_STATUS', status: { phase: 'error', message: err.message, current: 0, total: 0 } })
    }
  }, [state.etfGroups, state.stockGroups, state.settings.aumFloor, state.settings.weights, state.settings.atrMultiplier, state.referenceR3m, enrichWithOpenFIGI, fetchPrices, fetchStats, ensureReferenceR3m])

  const fetchSingleInstrumentPrices = useCallback(async (isin: string) => {
    const inst = state.instruments.find(i => i.isin === isin)
    if (!inst || !inst.yahooTicker) return
    try {
      const cacheKey = buildYahooCacheKey(inst.yahooTicker)
      let r = cacheGet<any>(cacheKey, YAHOO_TTL_MS)
      if (!r) {
        const legacy = cacheGet<any>(buildLegacyYahooCacheKey(inst.yahooTicker), YAHOO_TTL_MS)
        if (legacy) {
          r = legacy
          cacheSet(cacheKey, legacy, YAHOO_TTL_MS)
        }
      }
      if (!r) {
        r = await apiYahooSingle(inst.yahooTicker, getYahooRequestOptions(inst))
        if (r) cacheSet(cacheKey, r, YAHOO_TTL_MS)
      }
      if (!r) return
      const shouldReplaceName = r.longName && isUnclassifiedInstrument(inst)
      const nextLongName = shouldReplaceName ? r.longName : inst.longName
      dispatch({
        type: 'UPDATE_INSTRUMENT',
        isin,
        updates: {
          closes: r.closes || [],
          highs: r.highs || [],
          lows: r.lows || [],
          volumes: r.volumes || [],
          timestamps: r.timestamps || [],
          pe: r.pe ?? null, pb: r.pb ?? null,
          ebitda: r.ebitda ?? null, enterpriseValue: r.enterpriseValue ?? null,
          returnOnAssets: r.returnOnAssets ?? null,
          yahooLongName: r.longName ?? inst.yahooLongName,
          longName: nextLongName,
          displayName: nextLongName ? toDisplayName(nextLongName, inst.displayName) : inst.displayName,
          priceFetched: true, priceError: r.error, fundamentalsFetched: true,
        },
      })
    } catch (err: any) {
      dispatch({ type: 'UPDATE_INSTRUMENT', isin, updates: { priceFetched: true, priceError: err.message } })
    }
  }, [state.instruments])

  const fetchSingleInstrumentAnalyst = useCallback(async (
    isin: string,
    options?: { suppressGemini?: boolean },
  ) => {
    const inst = state.instruments.find(i => i.isin === isin)
    if (!inst || !inst.yahooTicker || inst.type !== 'Stock') return
    if (inst.tfaPhase === 'watch') {
      dispatch({ type: 'UPDATE_INSTRUMENT', isin, updates: { tfaPhase: 'fetching' } })
    }
    try {
      const cacheKey = buildAnalystCacheKey(inst.yahooTicker, inst.mnemonic)
      const analystTtlMs = inst.mnemonic ? LEEWAY_TTL_MS : ANALYST_TTL_MS
      let r = cacheGet<any>(cacheKey, analystTtlMs)
      if (!r) {
        const legacy = cacheGet<any>(buildLegacyAnalystCacheKey(inst.yahooTicker), analystTtlMs)
        if (legacy) {
          r = legacy
          cacheSet(cacheKey, legacy, analystTtlMs)
        }
      }
      if (!r) {
        r = await apiFetchJson<any>('/api/yahoo-analyst', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ticker: inst.yahooTicker,
            isin: inst.isin,
            mnemonic: inst.mnemonic ?? undefined,
          }),
        })
        if (r) cacheSet(cacheKey, r, analystTtlMs)
      }
      if (!r) return
      const updates: any = {
        analystRating: r.recommendationMean ?? null,
        analystRatingKey: r.recommendationKey ?? null,
        analystOpinions: r.numberOfAnalystOpinions ?? null,
        targetPrice: r.targetMeanPrice ?? null,
        targetLow: r.targetLowPrice ?? null,
        targetHigh: r.targetHighPrice ?? null,
        analystCurrency: r.currency ?? null,
        analystCurrentPrice: r.currentPrice ?? null,
        analystSource: r.source ?? null,
        analystFetched: true,
        analystError: r.error ?? null,
      }
      if (r.pe != null) updates.pe = r.pe
      if (r.pb != null) updates.pb = r.pb
      if (r.ebitda != null) updates.ebitda = r.ebitda
      if (r.enterpriseValue != null) updates.enterpriseValue = r.enterpriseValue
      if (r.returnOnAssets != null) updates.returnOnAssets = r.returnOnAssets
      if (r.marketCap != null) updates.marketCap = r.marketCap
      if (r.pe != null || r.pb != null || r.ebitda != null || r.enterpriseValue != null || r.returnOnAssets != null || r.marketCap != null) {
        updates.fundamentalsFetched = true
      }
      if (inst.mnemonic) {
        updates.leewayFetched = true
        updates.leewayError = r.leewayUsed ? null : 'Keine Leeway-Daten'
      }

      const lastPrice = inst.closes?.length ? inst.closes[inst.closes.length - 1] : null
      const priceCurrency = inst.priceCurrency ?? inst.currency ?? null

      // Financial Currency: ISIN-basiert ist Ground Truth, Yahoo-Feld ist Fallback
      const isinCurrency = isinToFinancialCurrency(inst.isin)
      const analystCurrency = isinCurrency ?? r.financialCurrency ?? r.currency ?? null

      const analystCurrent = r.currentPrice ?? null

      // FX-Rate-Bestimmung (Priorität: Yahoo-Rate > Preisverhältnis):
      let fxRate: number | null = null
      if (priceCurrency != null && analystCurrency != null && priceCurrency !== analystCurrency) {
        // Yahoo hat die Rate bereits korrekt geliefert (wenn financialCurrency ≠ currency erkannt)
        if (r.fxRate != null) {
          fxRate = r.fxRate
        } else if (lastPrice != null && analystCurrent != null && analystCurrent > 0) {
          // Preisverhältnis als Proxy: lastPrice (priceCurrency) / analystCurrent (analystCurrency)
          // Sanity-Check: Rate muss sinnvoll sein (nicht < 0.01 oder > 100)
          const ratio = lastPrice / analystCurrent
          if (ratio >= 0.01 && ratio <= 100) fxRate = ratio
        }
        // Letzter Fallback: falls kein Rate verfügbar, Target nicht anzeigen
      }

      // Keine FX nötig wenn gleiche Währung
      const currencyMismatch = priceCurrency != null && analystCurrency != null && priceCurrency !== analystCurrency

      // Ratio-Mismatch als zusätzlichen Trigger (deckt Fälle ab wo ISIN-Mapping fehlt)
      const ratioProxy = fxRate == null && priceCurrency === analystCurrency
        ? (lastPrice != null && analystCurrent != null && analystCurrent > 0
          ? lastPrice / analystCurrent
          : null)
        : null
      const ratioMismatch = ratioProxy != null && (ratioProxy < 0.85 || ratioProxy > 1.15)

      const shouldAdjust = currencyMismatch || ratioMismatch

      if (shouldAdjust && fxRate != null) {
        updates.targetFxRate = fxRate
        updates.targetFxApplied = true
        updates.targetPriceAdj = r.targetMeanPrice != null ? r.targetMeanPrice * fxRate : null
        updates.targetLowAdj = r.targetLowPrice != null ? r.targetLowPrice * fxRate : null
        updates.targetHighAdj = r.targetHighPrice != null ? r.targetHighPrice * fxRate : null
        updates.targetCurrencyUnknown = false
      } else if (shouldAdjust && fxRate == null) {
        // Währungsmismatch erkannt aber kein FX-Rate verfügbar
        // → Target ausblenden statt falsche Währung anzeigen
        updates.targetFxRate = null
        updates.targetFxApplied = false
        updates.targetPriceAdj = null
        updates.targetLowAdj = null
        updates.targetHighAdj = null
        // Speichere raw-Target zur Information aber markiere es als unzuverlässig
        updates.targetCurrencyUnknown = true
      } else {
        updates.targetFxRate = null
        updates.targetFxApplied = false
        updates.targetPriceAdj = null
        updates.targetLowAdj = null
        updates.targetHighAdj = null
        updates.targetCurrencyUnknown = false
      }

      // analystCurrency für Anzeige: gibt die ZIEL-Währung des Kursziels an
      // (nicht die Handelswährung des Instruments)
      updates.analystCurrency = analystCurrency

      const tDetails = calculateTfaTDetails(
        inst.closes ?? [],
        inst.volumes,
        inst.rsi14 ?? null,
        inst.aboveMa50 ?? null,
        inst.drawFromHigh ?? null,
        inst.higherLow ?? null,
        inst.maCrossover ?? null
      )
      const effectivePb = updates.pb ?? inst.pb
      const effectiveRoA = updates.returnOnAssets ?? inst.returnOnAssets
      const effectiveEbitda = updates.ebitda ?? inst.ebitda
      const effectiveEV = updates.enterpriseValue ?? inst.enterpriseValue

      const currentPrice = inst.closes && inst.closes.length > 0
        ? inst.closes[inst.closes.length - 1]
        : null

      const fDetails = calculateTfaFDetails(
        effectivePb,
        effectiveEbitda,
        effectiveEV,
        updates.targetPriceAdj ?? updates.targetPrice ?? inst.targetPriceAdj ?? inst.targetPrice ?? null,
        currentPrice,
      )

      updates.tfaFScore = fDetails.score ?? null
      updates.tfaFSignals = fDetails.signals

      const f5yDetails = calculateTfaFDetails5Y(
        effectivePb,
        effectiveEbitda,
        effectiveEV,
        effectiveRoA,
        updates.analystRating ?? null,
        updates.targetPriceAdj ?? updates.targetPrice ?? inst.targetPrice ?? null,
        currentPrice,
      )
      updates.tfaFScore5Y = f5yDetails.score ?? null
      updates.tfaFSignals5Y = f5yDetails.signals

      const phase1 = calculateTfaPhase1Gate({
        ...inst,
        returnOnAssets: effectiveRoA ?? null,
        pb: effectivePb ?? inst.pb ?? null,
        tfaTScore: tDetails.score ?? null,
      })

      const phase2 = calculateTfaPhase2Gate({
        ...inst,
        returnOnAssets: effectiveRoA ?? null,
        pb: effectivePb ?? inst.pb ?? null,
        tfaTScore: tDetails.score ?? null,
        tfaFScore: fDetails.score ?? null,
        tfaFScore5Y: f5yDetails.score ?? null,
      }, phase1.scenario || '52w')

      const scenario = phase1.scenario
      if (phase1.phase !== 'none') {
        if (scenario === '5y' || scenario === '7y') {
          const tScore5y = inst.tfaTScore5Y ?? null
          const fScore5y = f5yDetails.score ?? null
          if (tScore5y !== null && fScore5y !== null) {
            updates.tfaScore = (tScore5y * 0.35 + fScore5y * 0.40) / 0.75
          }
        } else {
          const tScore = tDetails.score ?? null
          const fScore = fDetails.score ?? null
          if (tScore !== null && fScore !== null) {
            updates.tfaScore = (tScore * 0.35 + fScore * 0.40) / 0.75
          }
        }
      }

      updates.tfaScenario = phase1.scenario ?? null
      if (phase1.phase === 'none') {
        updates.tfaPhase = 'none'
        updates.tfaRejectReason = phase1.reason
      } else if (phase1.phase === 'monitoring') {
        updates.tfaPhase = 'monitoring'
        updates.tfaRejectReason = undefined
      } else if (phase1.phase === 'above_all_mas') {
        updates.tfaPhase = 'above_all_mas'
        updates.tfaRejectReason = undefined
      } else if (!phase2.passes) {
        updates.tfaPhase = 'rejected'
        updates.tfaRejectReason = phase2.reason
      } else {
        updates.tfaPhase = 'watch'
        updates.tfaRejectReason = undefined
      }

      dispatch({ type: 'UPDATE_INSTRUMENT', isin, updates })

      const updatedPhase = updates.tfaPhase
      if (
        !options?.suppressGemini &&
        inst.type === 'Stock' &&
        (updatedPhase === 'watch' || updatedPhase === 'above_all_mas' ||
         inst.tfaPhase === 'watch' || inst.tfaPhase === 'above_all_mas') &&
        !inst.tfaFetched &&
        !tfaInFlight.current.has(inst.isin)
      ) {
        tfaInFlight.current.add(inst.isin)
        try {
          dispatch({ type: 'UPDATE_INSTRUMENT', isin: inst.isin, updates: { tfaPhase: 'fetching' } })
          const catalystCacheKey = `cache:tfa-catalyst:${inst.yahooTicker}`
          let data = cacheGet<any>(catalystCacheKey, TFA_CATALYST_TTL_MS)

          if (!data) {
            data = await apiFetchJson<any>('/api/tfa-catalyst', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ticker: inst.yahooTicker,
                name: inst.displayName,
                drawFromHigh: inst.drawFromHigh,
                drawFrom5YHigh: inst.drawFrom5YHigh ?? null,
                drawFrom7YHigh: inst.drawFrom7YHigh ?? null,
                scenario: phase1.scenario ?? inst.tfaScenario ?? '52w',
              }),
            })
            cacheSet(catalystCacheKey, data, TFA_CATALYST_TTL_MS)
          }

          const scenario = phase1.scenario
          const baseT = (scenario === '5y' || scenario === '7y')
            ? (inst.tfaTScore5Y ?? tDetails.score ?? null)
            : (tDetails.score ?? null)
          const baseF = (scenario === '5y' || scenario === '7y')
            ? (f5yDetails.score ?? fDetails.score ?? null)
            : (fDetails.score ?? null)
          const rawEScore = data.eScore ?? null
          let finalScore: number | null = null
          if (!data.koRisk) {
            if (rawEScore != null && baseT != null && baseF != null) {
              finalScore = (baseT * 0.35) + (baseF * 0.40) + (rawEScore * 0.25)
            } else if (baseT != null && baseF != null) {
              finalScore = (baseT * 0.35 + baseF * 0.40) / 0.75
            } else if (baseT != null) {
              finalScore = baseT
            }
          }
          dispatch({
            type: 'UPDATE_INSTRUMENT',
            isin: inst.isin,
            updates: {
              tfaEScore: rawEScore,
              tfaScore: data.koRisk ? null : finalScore,
              tfaKO: data.koRisk ?? false,
              tfaCatalyst: {
                earningsBeatRecent: data.signals?.earnings_beat_recent ?? null,
                earningsBeatPrior: data.signals?.earnings_beat_prior ?? null,
                guidanceRaised: data.signals?.guidance_raised ?? null,
                analystUpgrade: data.signals?.analyst_upgrade ?? null,
                insiderBuying: data.signals?.insider_buying ?? null,
                restructuring: data.signals?.restructuring ?? null,
                koRisk: data.signals?.ko_risk ?? null,
                eScore: data.eScore ?? null,
                summary: data.summary ?? null,
                fetchedAt: Date.now(),
              },
              tfaPhase: data.koRisk ? 'ko' : 'qualified',
              tfaFetched: true,
            },
          })
        } finally {
          tfaInFlight.current.delete(inst.isin)
        }
      }
    } catch (err: any) {
      dispatch({ type: 'UPDATE_INSTRUMENT', isin, updates: { analystFetched: true, analystError: err.message, tfaPhase: 'watch' } })
    }
  }, [state.instruments])

  useEffect(() => {
    if (!state.tableState.tfaMode) return
    if (tfaAutoRunning.current) return
    if (!['done', 'idle'].includes(state.fetchStatus.phase)) return
    const pending = displayedInstruments.filter((i) =>
      i.type === 'Stock'
      && i.tfaPhase === 'watch'
      && !i.analystFetched
      && !i.analystError
    )
    if (pending.length === 0 || pending.length >= TFA_AUTO_FUNDAMENTALS_LIMIT) return

    tfaAutoRunning.current = true
    void (async () => {
      try {
        for (const inst of pending) {
          if (tfaFundInFlight.current.has(inst.isin)) continue
          if (!inst.yahooTicker) {
            dispatch({ type: 'UPDATE_INSTRUMENT', isin: inst.isin, updates: { tfaPhase: 'rejected', tfaRejectReason: 'Kein Yahoo-Ticker für Analyst-Fetch' } })
            continue
          }
          tfaFundInFlight.current.add(inst.isin)
          try {
            await fetchSingleInstrumentAnalyst(inst.isin)
          } finally {
            tfaFundInFlight.current.delete(inst.isin)
          }
        }
      } finally {
        tfaAutoRunning.current = false
      }
    })()
  }, [displayedInstruments, state.fetchStatus.phase, state.tableState.tfaMode, fetchSingleInstrumentAnalyst, dispatch])

  useEffect(() => {
    if (isBlockingLeewayPhase(state.fetchStatus.phase)) {
      if (leewayStartTimerRef.current) {
        clearTimeout(leewayStartTimerRef.current)
        leewayStartTimerRef.current = null
      }
      return
    }
    if (!['done', 'idle'].includes(state.fetchStatus.phase)) return
    if (leewayRunning.current) return

    const allStocksWithPrices = state.instruments.filter(
      (i) => i.type === 'Stock' && i.priceFetched && i.mnemonic
    )
    if (allStocksWithPrices.length === 0) return

    const top50Fetched = allStocksWithPrices.filter(
      (i) => i.leewayFetched && (i.riskAdjustedRank ?? 9999) <= LEEWAY_TOP_N
    )
    const top50Available = allStocksWithPrices.filter(
      (i) => (i.riskAdjustedRank ?? 9999) <= LEEWAY_TOP_N
    )

    const top50CacheAge = (() => {
      if (!hasStorage()) return null
      if (top50Fetched.length < top50Available.length) return null
      if (top50Fetched.length === 0) return null
      let oldest = Date.now()
      for (const inst of top50Fetched) {
        try {
          const raw = JSON.parse(localStorage.getItem(buildAnalystCacheKey(inst.yahooTicker, inst.mnemonic)) ?? 'null')
            ?? JSON.parse(localStorage.getItem(buildLegacyAnalystCacheKey(inst.yahooTicker)) ?? 'null')
          if (!raw?.ts) return null
          if (raw.ts < oldest) oldest = raw.ts
        } catch {
          return null
        }
      }
      return Date.now() - oldest
    })()

    const maxRank = (
      top50CacheAge != null &&
      top50CacheAge > LEEWAY_EXTEND_AFTER_MS &&
      top50Available.length >= LEEWAY_TOP_N
    )
      ? LEEWAY_EXTENDED_N
      : LEEWAY_TOP_N

    const candidates = allStocksWithPrices
      .filter((i) =>
        !i.leewayFetched &&
        !i.analystFetched &&
        (i.riskAdjustedRank ?? 9999) <= maxRank
      )
      .sort((a, b) => (a.riskAdjustedRank ?? 9999) - (b.riskAdjustedRank ?? 9999))

    if (candidates.length === 0) return

    let cancelled = false
    const timer = setTimeout(() => {
      if (cancelled) return
      if (isBlockingLeewayPhase(state.fetchStatus.phase)) return
      if (leewayRunning.current) return

      leewayRunning.current = true
      void (async () => {
        try {
          for (const inst of candidates) {
            await fetchSingleInstrumentAnalyst(inst.isin, { suppressGemini: true })
            await new Promise((r) => setTimeout(r, 200))
          }
        } finally {
          leewayRunning.current = false
        }
      })()
    }, LEEWAY_START_DELAY_MS)
    leewayStartTimerRef.current = timer

    return () => {
      cancelled = true
      clearTimeout(timer)
      if (leewayStartTimerRef.current === timer) {
        leewayStartTimerRef.current = null
      }
    }
  }, [
    state.fetchStatus.phase,
    state.instruments.filter((i) => i.type === 'Stock' && i.priceFetched).length,
    fetchSingleInstrumentAnalyst,
  ])

  const fetchPortfolioPrices = useCallback(async (isins: string[]) => {
    const targets = state.instruments.filter((i) => isins.includes(i.isin) && i.yahooTicker)
    if (targets.length === 0) return
    setStatus('Fetching portfolio prices...', 0, targets.length)
    const updated = await fetchPrices(targets)
    const updates = new Map(updated.map((i) => [i.isin, { ...i }]))
    dispatch({ type: 'UPDATE_INSTRUMENTS', updates })
  }, [state.instruments, fetchPrices])

  return { processManualInput, loadXetraBackground, activateXetra, xetraBuffer, fetchSingleInstrumentPrices, fetchSingleInstrumentAnalyst, fetchPortfolioPrices }
}
