import { useCallback, useRef } from 'react'
import { useAppState } from '../store'
import type { Instrument } from '../types'
import { parseXetraCSV, xetraRowToInstrument, parseManualInput, parseCSVFile, resolveInstrumentType, toDisplayName } from '../utils/parsers'
import { buildDedupGroups, applyDedupToInstruments } from '../utils/dedup'
import { calculateReturns, recalculateAll } from '../utils/calculations'

const YAHOO_CONCURRENCY = 5
const OPENFIGI_BATCH = 150
const OPENFIGI_DELAY = 100
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000

const hasStorage = () => typeof window !== 'undefined' && typeof localStorage !== 'undefined'

function cacheGet<T>(key: string): T | null {
  if (!hasStorage()) return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    if (Date.now() - (parsed.ts || 0) > CACHE_TTL_MS) return null
    return parsed.data as T
  } catch {
    return null
  }
}

function cacheSet<T>(key: string, data: T) {
  if (!hasStorage()) return
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }))
  } catch {
    // ignore quota errors
  }
}

interface OpenFIGIResult { name?: string; isin?: string; ticker?: string; securityType?: string; securityType2?: string }
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
  const cached = cacheGet<string>('cache:xetra')
  if (cached) return cached
  const res = await fetch('/api/xetra')
  if (!res.ok) throw new Error(`Xetra API error: ${res.status}`)
  const text = await res.text()
  cacheSet('cache:xetra', text)
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

  const setStatus = (message: string, current = 0, total = 0) =>
    dispatch({ type: 'SET_FETCH_STATUS', status: { message, current, total } })

  const enrichWithOpenFIGI = useCallback(async (instruments: Instrument[]): Promise<Instrument[]> => {
    const jobs = instruments.map((inst) => {
      if (inst.isin?.length === 12) return { idType: 'ID_ISIN', idValue: inst.isin }
      if (inst.wkn?.length === 6) return { idType: 'ID_WERTPAPIER', idValue: inst.wkn }
      return { idType: 'TICKER', idValue: inst.mnemonic || inst.yahooTicker }
    })
    const cacheKey = 'cache:openfigi'
    const cache = cacheGet<Record<string, OpenFIGIResult>>(cacheKey) || {}
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
      cacheSet(cacheKey, cache)
    } else {
      setStatus(`Enriching names: ${jobs.length} / ${jobs.length}`, jobs.length, jobs.length)
    }

    return instruments.map((inst, i) => {
      const figi = results[i]
      if (!figi) return inst
      const longName: string | undefined = figi.name || undefined
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
    const tasks = withTickers.map((inst) => () => apiYahooSingle(inst.yahooTicker))
    const results = await parallelLimit(tasks, YAHOO_CONCURRENCY, (done, total) => setStatus(`Fetching prices: ${done} / ${total}`, done, total))
    const updated = [...instruments]
    results.forEach((r: any, i) => {
      if (!r) return
      const idx = updated.findIndex((inst) => inst.yahooTicker === withTickers[i].yahooTicker)
      if (idx < 0) return
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
      return { isin: p.type === 'ISIN' ? p.normalized : p.raw, wkn: p.type === 'WKN' ? p.normalized : undefined, mnemonic: p.type === 'Ticker' ? p.normalized : undefined, yahooTicker, type: 'Unknown' as const, source: 'manual' as const, displayName: p.raw }
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
      const enriched = await enrichWithOpenFIGI(stubs)
      dispatch({ type: 'SET_FETCH_STATUS', status: { phase: 'prices', message: '', current: 0, total: 0 } })
      const withPrices = await fetchPrices(enriched)
      const refR3m = await ensureReferenceR3m()
      dispatch({ type: 'SET_FETCH_STATUS', status: { phase: 'justetf', message: '', current: 0, total: 0 } })
      const withStats = await fetchStats(withPrices)
      const existingByYahoo = new Map(state.instruments.map((i) => [i.yahooTicker, i]))
      const existingByIsin = new Map(state.instruments.map((i) => [i.isin, i]))
      const existingByWkn = new Map(state.instruments.map((i) => [i.wkn, i]))

      const updates = new Map<string, Partial<Instrument>>()
      const toAdd: Instrument[] = []
      for (const inst of withStats) {
        const existing =
          (inst.yahooTicker && existingByYahoo.get(inst.yahooTicker)) ||
          existingByIsin.get(inst.isin) ||
          (inst.wkn && existingByWkn.get(inst.wkn)) ||
          existingByIsin.get(inst.wkn || '')
        if (existing) {
          updates.set(existing.isin, { ...existing, ...inst })
        } else {
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
      const etfCounts: Record<string, number> = {}
      const stockCounts: Record<string, number> = {}
      instruments.forEach((inst) => {
        const g = inst.xetraGroup || ''
        if (inst.type === 'Stock') stockCounts[g] = (stockCounts[g] || 0) + 1
        else etfCounts[g] = (etfCounts[g] || 0) + 1
      })
      dispatch({ type: 'SET_GROUP_COUNTS', etf: etfCounts, stock: stockCounts })
      xetraBuffer.current = instruments
      dispatch({ type: 'SET_XETRA_READY', ready: true })
      dispatch({ type: 'SET_XETRA_LOADING', loading: false })
    } catch (err) {
      dispatch({ type: 'SET_XETRA_LOADING', loading: false })
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
      const groups = buildDedupGroups(etfs)
      const dedupedEtfs = applyDedupToInstruments(etfs, groups)
      const dedupedWithAUM = applyStatsResults(dedupedEtfs, statsResults)
      const aumFloor = state.settings.aumFloor
      const updatedEtfs = dedupedWithAUM.map((inst) => {
        if (!inst.isDedupWinner) return inst
        if (inst.aum != null && inst.aum < aumFloor) return { ...inst, isDedupWinner: false }
        return inst
      })
      const winnersByGroup = new Map<string, boolean>()
      updatedEtfs.forEach((inst) => { if (inst.isDedupWinner && inst.dedupGroup) winnersByGroup.set(inst.dedupGroup, true) })
      const finalEtfs = updatedEtfs.map((inst) => {
        if (!inst.dedupGroup || inst.isDedupWinner) return inst
        if (!winnersByGroup.has(inst.dedupGroup)) {
          const aum = inst.aum
          if (aum == null || aum >= aumFloor) { winnersByGroup.set(inst.dedupGroup, true); return { ...inst, isDedupWinner: true } }
        }
        return inst
      })
      const combined = [...finalEtfs, ...stocks]
      const toFetch = combined.filter((i) => i.isDedupWinner !== false || i.type === 'Stock')
      dispatch({ type: 'SET_FETCH_STATUS', status: { phase: 'prices', message: '', current: 0, total: toFetch.length } })
      const withPrices = await fetchPrices(toFetch)
      const refR3m = await ensureReferenceR3m()
      const finalMap = new Map(withPrices.map((i) => [i.isin, i]))
      const final = combined.map((i) => finalMap.get(i.isin) || i)
      const winners = final.filter((i) => i.isDedupWinner)
      dispatch({ type: 'ADD_INSTRUMENTS', instruments: recalculateAll(final, state.settings.weights, state.settings.atrMultiplier, refR3m ?? state.referenceR3m) })
      dispatch({ type: 'SET_FETCH_STATUS', status: { phase: 'done', message: `Loaded ${winners.length} ETF groups + ${stocks.length} stocks`, current: final.length, total: final.length } })
    } catch (err: any) {
      dispatch({ type: 'SET_FETCH_STATUS', status: { phase: 'error', message: err.message, current: 0, total: 0 } })
    }
  }, [state.etfGroups, state.stockGroups, state.settings.aumFloor, state.settings.weights, state.settings.atrMultiplier, state.referenceR3m, enrichWithOpenFIGI, fetchPrices, fetchStats, ensureReferenceR3m])

  const fetchSingleInstrumentPrices = useCallback(async (isin: string) => {
    const inst = state.instruments.find(i => i.isin === isin)
    if (!inst || !inst.yahooTicker) return
    try {
      const r = await apiYahooSingle(inst.yahooTicker)
      if (!r) return
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
    try {
      const r = await fetch('/api/yahoo-analyst', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: inst.yahooTicker, isin: inst.isin }),
      }).then((res) => {
        if (!res.ok) throw new Error(`Yahoo Analyst API error: ${res.status}`)
        return res.json()
      })
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
      dispatch({ type: 'UPDATE_INSTRUMENT', isin, updates })
    } catch (err: any) {
      dispatch({ type: 'UPDATE_INSTRUMENT', isin, updates: { analystFetched: true, analystError: err.message } })
    }
  }, [state.instruments])

  return { processManualInput, loadXetraBackground, activateXetra, xetraBuffer, fetchSingleInstrumentPrices, fetchSingleInstrumentAnalyst }
}
