import { useCallback, useEffect, useRef } from 'react'
import { useAppState } from '../store'
import type { Instrument } from '../types'
import { parseXetraCSV, xetraRowToInstrument, parseManualInput, parseCSVFile, resolveInstrumentType, toDisplayName } from '../utils/parsers'
import { buildDedupGroups, applyDedupToInstruments, isUnclassifiedInstrument } from '../utils/dedup'
import { calculateReturns, recalculateAll, calculateTfaPhase1Gate, calculateTfaPhase2Gate, calculateTfaTDetails, calculateTfaFDetails } from '../utils/calculations'

const YAHOO_CONCURRENCY_MIN = 3
const YAHOO_CONCURRENCY_MAX = 12
let yahooConcurrency = 8
const OPENFIGI_BATCH = 150
const OPENFIGI_DELAY = 100
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const OPENFIGI_TTL_MS = 30 * 24 * 60 * 60 * 1000
const XETRA_TTL_MS = 30 * 24 * 60 * 60 * 1000
const YAHOO_TTL_MS = 24 * 60 * 60 * 1000
const ANALYST_TTL_MS = 2 * 24 * 60 * 60 * 1000
const TFA_AUTO_FUNDAMENTALS_LIMIT = 25

const hasStorage = () => typeof window !== 'undefined' && typeof localStorage !== 'undefined'

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

function cacheSet<T>(key: string, data: T, ttlMs = CACHE_TTL_MS) {
  if (!hasStorage()) return
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), ttl: ttlMs, data }))
  } catch {
    // ignore quota errors
  }
}

interface OpenFIGIResult { name?: string; securityDescription?: string; isin?: string; ticker?: string; securityType?: string; securityType2?: string }
interface StatsResult { isin: string; name: string | null; aum: number | null; ter: null }

async function apiOpenFIGI(jobs: { idType: string; idValue: string }[]): Promise<OpenFIGIResult[]> {
  const res = await fetch('/api/openfigi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(jobs) })
  if (!res.ok) throw new Error(`OpenFIGI API error: ${res.status}`)
  return res.json()
}

async function apiYahooSingle(ticker: string): Promise<any> {
  const res = await fetch('/api/yahoo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tickers: [ticker] }) })
  if (!res.ok) throw new Error(`Yahoo API error: ${res.status}`)
  const data = await res.json()
  return data[0] ?? null
}

async function apiYahooAnalyst(ticker: string): Promise<any> {
  const res = await fetch('/api/yahoo-analyst', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticker }) })
  if (!res.ok) throw new Error(`Yahoo Analyst API error: ${res.status}`)
  return res.json()
}

async function apiStats(isins: string[]): Promise<StatsResult[]> {
  const res = await fetch('/api/xetra-stats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isins }) })
  if (!res.ok) throw new Error(`Stats API error: ${res.status}`)
  return res.json()
}

async function apiXetra() {
  const cached = cacheGet<string>('cache:xetra', XETRA_TTL_MS)
  if (cached) return cached
  const res = await fetch('/api/xetra')
  if (!res.ok) throw new Error(`Xetra API error: ${res.status}`)
  const text = await res.text()
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
  const abortRef = useRef(false)
  const xetraBuffer = useRef<Instrument[]>([])
  const tfaInFlight = useRef<Set<string>>(new Set())
  const tfaFundInFlight = useRef<Set<string>>(new Set())
  const tfaAutoRunning = useRef(false)

  const setStatus = (message: string, current = 0, total = 0) =>
    dispatch({ type: 'SET_FETCH_STATUS', status: { message, current, total } })

  const enrichWithOpenFIGI = useCallback(async (instruments: Instrument[]): Promise<Instrument[]> => {
    const jobs = instruments.map((inst) => {
      if (inst.isin?.length === 12) return { idType: 'ID_ISIN', idValue: inst.isin }
      if (inst.wkn?.length === 6) return { idType: 'ID_WERTPAPIER', idValue: inst.wkn }
      return { idType: 'TICKER', idValue: inst.mnemonic || inst.yahooTicker }
    })
    const cacheKey = 'cache:openfigi:v2'
    const cache = cacheGet<Record<string, OpenFIGIResult>>(cacheKey, OPENFIGI_TTL_MS) || {}
    const keyFor = (j: { idType: string; idValue: string }) => `${j.idType}:${j.idValue}`

    const missing: { job: { idType: string; idValue: string }; idx: number }[] = []
    const results: OpenFIGIResult[] = new Array(jobs.length)
    jobs.forEach((j, i) => {
      const k = keyFor(j)
      const cached = cache[k]
      if (cached) results[i] = cached
      else missing.push({ job: j, idx: i })
    })

    if (missing.length > 0) {
      const fetched = await processBatches(
        missing.map((m) => m.job),
        OPENFIGI_BATCH,
        OPENFIGI_DELAY,
        (batch) => apiOpenFIGI(batch),
        (done, total) => setStatus(`Enriching names: ${done} / ${total}`, done, total)
      )
      fetched.forEach((r, i) => {
        const { job, idx } = missing[i]
        results[idx] = r
        cache[keyFor(job)] = r
      })
      cacheSet(cacheKey, cache, OPENFIGI_TTL_MS)
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
      const r = await apiYahooSingle('URTH')
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
    const tasks: { idx: number; ticker: string }[] = []
    withTickers.forEach((inst, idx) => {
      const key = `cache:yahoo:${inst.yahooTicker}`
      const cached = cacheGet<any>(key, YAHOO_TTL_MS)
      if (cached) cachedResults[idx] = cached
      else tasks.push({ idx, ticker: inst.yahooTicker })
    })
    const cachedCount = withTickers.length - tasks.length
    const limit = Math.max(YAHOO_CONCURRENCY_MIN, Math.min(YAHOO_CONCURRENCY_MAX, yahooConcurrency))
    const taskFns = tasks.map((t) => () => apiYahooSingle(t.ticker).catch((err) => ({ error: err.message, ticker: t.ticker })))
    const fetched = tasks.length
      ? await parallelLimit(taskFns, limit, (done) =>
        setStatus(`Fetching prices: ${cachedCount + done} / ${withTickers.length}`, cachedCount + done, withTickers.length)
      )
      : []
    const results = [...cachedResults]
    fetched.forEach((r: any, i: number) => {
      const t = tasks[i]
      results[t.idx] = r
      if (r) cacheSet(`cache:yahoo:${t.ticker}`, r, YAHOO_TTL_MS)
    })

    const errorCount = fetched.filter((r: any) => !r || r.error).length
    const errorRate = fetched.length > 0 ? errorCount / fetched.length : 0
    if (errorRate >= 0.2 && yahooConcurrency > YAHOO_CONCURRENCY_MIN) yahooConcurrency -= 1
    else if (errorRate === 0 && fetched.length > 0 && yahooConcurrency < YAHOO_CONCURRENCY_MAX) yahooConcurrency += 1

    const updated = [...instruments]
    results.forEach((r: any, i) => {
      if (!r) return
      const idx = updated.findIndex((inst) => inst.yahooTicker === withTickers[i].yahooTicker)
      if (idx < 0) return
      const shouldReplaceName = r.longName && isUnclassifiedInstrument(updated[idx])
      const nextLongName = shouldReplaceName ? r.longName : updated[idx].longName
      updated[idx] = {
        ...updated[idx],
        closes: r.closes || [],
        highs: r.highs || [],
        lows: r.lows || [],
        volumes: r.volumes || [],
        timestamps: r.timestamps || [],
        pe: r.pe ?? null, pb: r.pb ?? null,
        ebitda: r.ebitda ?? null, enterpriseValue: r.enterpriseValue ?? null,
        returnOnAssets: r.returnOnAssets ?? null,
        yahooLongName: r.longName ?? updated[idx].yahooLongName,
        longName: nextLongName,
        displayName: nextLongName ? toDisplayName(nextLongName, updated[idx].displayName) : updated[idx].displayName,
        priceFetched: true, priceError: r.error, fundamentalsFetched: true,
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
    const parsed = isCSV ? parseCSVFile(text) : parseManualInput(text)
    if (parsed.length === 0) {
      dispatch({ type: 'SET_FETCH_STATUS', status: { phase: 'idle', message: 'No valid identifiers found', current: 0, total: 0 } })
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
      const cacheKey = `cache:yahoo:${inst.yahooTicker}`
      let r = cacheGet<any>(cacheKey, YAHOO_TTL_MS)
      if (!r) {
        r = await apiYahooSingle(inst.yahooTicker)
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

  const fetchSingleInstrumentAnalyst = useCallback(async (isin: string) => {
    const inst = state.instruments.find(i => i.isin === isin)
    if (!inst || !inst.yahooTicker || inst.type !== 'Stock') return
    if (inst.tfaPhase === 'pending') {
      dispatch({ type: 'UPDATE_INSTRUMENT', isin, updates: { tfaPhase: 'fetching' } })
    }
    try {
      const cacheKey = `cache:analyst:${inst.yahooTicker}`
      let r = cacheGet<any>(cacheKey, ANALYST_TTL_MS)
      if (!r) {
        r = await fetch('/api/yahoo-analyst', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker: inst.yahooTicker, isin: inst.isin }),
        }).then((res) => {
          if (!res.ok) throw new Error(`Yahoo Analyst API error: ${res.status}`)
          return res.json()
        })
        if (r) cacheSet(cacheKey, r, ANALYST_TTL_MS)
      }
      if (!r) return
      const updates: any = {
        analystRating: r.recommendationMean ?? null,
        analystRatingKey: r.recommendationKey ?? null,
        analystOpinions: r.numberOfAnalystOpinions ?? null,
        targetPrice: r.targetMeanPrice ?? null,
        targetLow: r.targetLowPrice ?? null,
        targetHigh: r.targetHighPrice ?? null,
        analystSource: r.source ?? null,
        analystFetched: true,
        analystError: r.error ?? null,
      }
      if (r.pe != null) updates.pe = r.pe
      if (r.pb != null) updates.pb = r.pb
      if (r.ebitda != null) updates.ebitda = r.ebitda
      if (r.enterpriseValue != null) updates.enterpriseValue = r.enterpriseValue
      if (r.returnOnAssets != null) updates.returnOnAssets = r.returnOnAssets
      if (r.pe != null || r.pb != null || r.ebitda != null || r.enterpriseValue != null || r.returnOnAssets != null) {
        updates.fundamentalsFetched = true
      }

      const tDetails = calculateTfaTDetails(
        inst.closes ?? [],
        inst.volumes,
        inst.rsi14 ?? null,
        inst.aboveMa50 ?? null,
        inst.drawFromHigh ?? null,
        inst.higherLow ?? null
      )
      const effectivePb = updates.pb ?? inst.pb
      const effectivePe = updates.pe ?? inst.pe
      const effectiveRoA = updates.returnOnAssets ?? inst.returnOnAssets
      const effectiveEbitda = updates.ebitda ?? inst.ebitda
      const effectiveEV = updates.enterpriseValue ?? inst.enterpriseValue
      const effectiveEY =
        effectiveEbitda != null && effectiveEV != null && effectiveEV > 0
          ? (effectiveEbitda / effectiveEV)
          : inst.earningsYield

      const fDetails = calculateTfaFDetails(
        effectivePb,
        effectiveEY,
        effectiveRoA,
        effectivePe,
        updates.analystRating ?? null
      )

      updates.tfaFScore = fDetails.score ?? null
      updates.tfaFSignals = fDetails.signals

      const phase1 = calculateTfaPhase1Gate({
        ...inst,
        returnOnAssets: effectiveRoA ?? null,
        tfaTScore: tDetails.score ?? null,
      })

      const phase2 = calculateTfaPhase2Gate({
        ...inst,
        returnOnAssets: effectiveRoA ?? null,
        tfaTScore: tDetails.score ?? null,
        tfaFScore: fDetails.score ?? null,
      })

      if (!phase1.passes) {
        updates.tfaPhase = 'none'
        updates.tfaRejectReason = phase1.reason
      } else if (!phase2.passes) {
        updates.tfaPhase = 'rejected'
        updates.tfaRejectReason = phase2.reason
      } else {
        updates.tfaPhase = 'pending'
        updates.tfaRejectReason = undefined
      }

      dispatch({ type: 'UPDATE_INSTRUMENT', isin, updates })

      if (inst.type === 'Stock' && phase1.passes && phase2.passes && !inst.tfaFetched && !tfaInFlight.current.has(inst.isin)) {
        tfaInFlight.current.add(inst.isin)
        try {
          dispatch({ type: 'UPDATE_INSTRUMENT', isin: inst.isin, updates: { tfaPhase: 'fetching' } })
          const res = await fetch('/api/tfa-catalyst', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ticker: inst.yahooTicker,
              name: inst.displayName,
              drawFromHigh: inst.drawFromHigh,
            }),
          })
          if (res.ok) {
            const data = await res.json()
            const finalScore = (tDetails.score! * 0.35) + (fDetails.score! * 0.40) + (data.eScore * 0.25)
            dispatch({
              type: 'UPDATE_INSTRUMENT',
              isin: inst.isin,
              updates: {
                tfaEScore: data.eScore,
                tfaScore: data.ko_risk ? null : finalScore,
                tfaKO: data.ko_risk,
                tfaCatalyst: {
                  insiderBuying: data.insider_buying ?? null,
                  shortSqueeze: data.short_squeeze ?? null,
                  restructuring: data.restructuring ?? null,
                  sectorCatalyst: data.sector_catalyst ?? null,
                  koRisk: data.ko_risk ?? null,
                  summary: data.summary ?? null,
                  fetchedAt: Date.now(),
                },
                tfaPhase: data.ko_risk ? 'ko' : 'qualified',
                tfaFetched: true,
              },
            })
          } else {
            dispatch({ type: 'UPDATE_INSTRUMENT', isin: inst.isin, updates: { tfaPhase: 'pending' } })
          }
        } finally {
          tfaInFlight.current.delete(inst.isin)
        }
      }
    } catch (err: any) {
      dispatch({ type: 'UPDATE_INSTRUMENT', isin, updates: { analystFetched: true, analystError: err.message, tfaPhase: 'pending' } })
    }
  }, [state.instruments])

  useEffect(() => {
    if (tfaAutoRunning.current) return
    if (!['done', 'idle'].includes(state.fetchStatus.phase)) return
    const pending = state.instruments.filter((i) =>
      i.type === 'Stock'
      && i.tfaPhase === 'pending'
      && !i.analystFetched
      && !i.analystError
    )
    if (pending.length === 0 || pending.length >= TFA_AUTO_FUNDAMENTALS_LIMIT) return

    tfaAutoRunning.current = true
    void (async () => {
      for (const inst of pending) {
        if (tfaFundInFlight.current.has(inst.isin)) continue
        tfaFundInFlight.current.add(inst.isin)
        try {
          await fetchSingleInstrumentAnalyst(inst.isin)
        } finally {
          tfaFundInFlight.current.delete(inst.isin)
        }
      }
      tfaAutoRunning.current = false
    })()
  }, [state.instruments, state.fetchStatus.phase, fetchSingleInstrumentAnalyst])

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
