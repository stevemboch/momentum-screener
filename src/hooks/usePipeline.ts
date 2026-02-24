
import { useCallback, useRef } from 'react'
import { useAppState } from '../store'
import type { Instrument } from '../types'
import type { ParsedIdentifier } from '../utils/parsers'
import { parseXetraCSV, xetraRowToInstrument, parseManualInput, parseCSVFile, resolveInstrumentType, toDisplayName } from '../utils/parsers'
import { buildDedupGroups, applyDedupToInstruments } from '../utils/dedup'
import { recalculateAll } from '../utils/calculations'

const BATCH_SIZE_YAHOO = 10  // tickers per batch
const BATCH_SIZE_JUSTETF = 30
const BATCH_DELAY_YAHOO = 300  // ms
const BATCH_DELAY_JUSTETF = 0  // server handles delays internally

// ─── API Response Types ───────────────────────────────────────────────────────

interface OpenFIGIResult {
  name?: string
  securityType?: string
  securityType2?: string
  [key: string]: unknown
}

interface JustETFResult {
  aum: number | null
  ter: number | null
  [key: string]: unknown
}

// ─── API Helpers ─────────────────────────────────────────────────────────────

async function apiOpenFIGI(jobs: { idType: string; idValue: string }[]): Promise<OpenFIGIResult[]> {
  const res = await fetch('/api/openfigi', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(jobs),
  })
  if (!res.ok) throw new Error(`OpenFIGI API error: ${res.status}`)
  return res.json()
}

async function apiYahoo(tickers: string[]) {
  const res = await fetch('/api/yahoo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tickers }),
  })
  if (!res.ok) throw new Error(`Yahoo API error: ${res.status}`)
  return res.json()
}

async function apiJustETF(isins: string[]): Promise<JustETFResult[]> {
  const res = await fetch('/api/justetf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isins }),
  })
  if (!res.ok) throw new Error(`justETF API error: ${res.status}`)
  return res.json()
}

async function apiXetra() {
  const res = await fetch('/api/xetra')
  if (!res.ok) throw new Error(`Xetra API error: ${res.status}`)
  return res.text()
}

// ─── Batch helper ─────────────────────────────────────────────────────────────

async function processBatches<T, R>(
  items: T[],
  batchSize: number,
  delay: number,
  processor: (batch: T[]) => Promise<R[]>,
  onProgress?: (done: number, total: number) => void
): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    const batchResults = await processor(batch)
    results.push(...batchResults)
    onProgress?.(Math.min(i + batchSize, items.length), items.length)
    if (delay > 0 && i + batchSize < items.length) {
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  return results
}

// ─── Main Pipeline Hook ───────────────────────────────────────────────────────

export function usePipeline() {
  const { state, dispatch } = useAppState()
  const abortRef = useRef(false)

  const setStatus = (message: string, current = 0, total = 0) => {
    dispatch({ type: 'SET_FETCH_STATUS', status: { message, current, total } })
  }

  // ── Step 1: OpenFIGI enrichment ──────────────────────────────────────────

  const enrichWithOpenFIGI = useCallback(async (instruments: Instrument[]): Promise<Instrument[]> => {
    const jobs = instruments.map((inst) => {
      if (inst.isin && inst.isin.length === 12) {
        return { idType: 'ID_ISIN', idValue: inst.isin }
      }
      if (inst.wkn && inst.wkn.length === 6) {
        return { idType: 'ID_WERTPAPIER', idValue: inst.wkn }
      }
      return { idType: 'TICKER', idValue: inst.mnemonic || inst.yahooTicker, exchCode: 'GS' }
    })

    const results = await processBatches(
      jobs, 100, 300,
      (batch) => apiOpenFIGI(batch),
      (done, total) => setStatus(`Enriching names: ${done} / ${total}`, done, total)
    )

    return instruments.map((inst, i) => {
      const figi = results[i]
      if (!figi) return inst

      const longName = figi.name ?? null
      const type = inst.source === 'xetra'
        ? inst.type  // trust Xetra type
        : resolveInstrumentType(figi.securityType, figi.securityType2, inst.isin)

      return {
        ...inst,
        longName,
        type,
        displayName: toDisplayName(longName, inst.displayName),
      }
    })
  }, [])

  // ── Step 2: Yahoo Finance prices ──────────────────────────────────────────

  const fetchPrices = useCallback(async (instruments: Instrument[]): Promise<Instrument[]> => {
    const tickers = instruments.map((i) => i.yahooTicker).filter(Boolean)
    const updated = [...instruments]

    const results = await processBatches(
      tickers, BATCH_SIZE_YAHOO, BATCH_DELAY_YAHOO,
      (batch) => apiYahoo(batch),
      (done, total) => setStatus(`Fetching prices: ${done} / ${total}`, done, total)
    )

    results.forEach((r: any) => {
      const idx = updated.findIndex((i) => i.yahooTicker === r.ticker)
      if (idx < 0) return
      updated[idx] = {
        ...updated[idx],
        closes: r.closes || [],
        timestamps: r.timestamps || [],
        pe: r.pe ?? null,
        pb: r.pb ?? null,
        ebitda: r.ebitda ?? null,
        enterpriseValue: r.enterpriseValue ?? null,
        returnOnAssets: r.returnOnAssets ?? null,
        priceFetched: true,
        priceError: r.error,
        fundamentalsFetched: true,
      }
    })

    return updated
  }, [])

  // ── Step 3: justETF TER + AUM ─────────────────────────────────────────────

  const fetchJustETF = useCallback(async (instruments: Instrument[]): Promise<Instrument[]> => {
    const etfs = instruments.filter(
      (i) => (i.type === 'ETF' || i.type === 'ETC') && !i.justEtfFetched
    )
    const updated = [...instruments]

    const results = await processBatches(
      etfs, BATCH_SIZE_JUSTETF, BATCH_DELAY_JUSTETF,
      (batch) => apiJustETF(batch.map((e) => e.isin)),
      (done, total) => setStatus(`Fetching ETF data: ${done} / ${total} ETFs`, done, total)
    )

    results.forEach((r: any) => {
      const idx = updated.findIndex((i) => i.isin === r.isin)
      if (idx < 0) return
      updated[idx] = {
        ...updated[idx],
        aum: r.aum ?? null,
        ter: r.ter ?? null,
        justEtfFetched: true,
        justEtfError: r.error,
        // Update display name if justETF has a better one and OpenFIGI didn't provide one
        displayName: updated[idx].longName
          ? updated[idx].displayName
          : (r.name || updated[idx].displayName),
      }
    })

    return updated
  }, [])

  // ── Manual input pipeline ─────────────────────────────────────────────────

  const processManualInput = useCallback(async (text: string, isCSV = false) => {
    abortRef.current = false
    dispatch({ type: 'SET_FETCH_STATUS', status: { phase: 'openfigi', message: 'Parsing input...', current: 0, total: 0 } })

    const parsed = isCSV ? parseCSVFile(text) : parseManualInput(text)
    if (parsed.length === 0) {
      dispatch({ type: 'SET_FETCH_STATUS', status: { phase: 'idle', message: 'No valid identifiers found', current: 0, total: 0 } })
      return
    }

    // Build stub instruments
    const stubs: Instrument[] = parsed.map((p) => {
      const yahooTicker = p.type === 'Ticker'
        ? (p.normalized.includes('.') ? p.normalized : `${p.normalized}.DE`)
        : ''
      return {
        isin: p.type === 'ISIN' ? p.normalized : p.raw,
        wkn: p.type === 'WKN' ? p.normalized : undefined,
        mnemonic: p.type === 'Ticker' ? p.normalized : undefined,
        yahooTicker,
        type: 'Unknown' as const,
        source: 'manual' as const,
        displayName: p.raw,
      }
    })

    try {
      // Enrich with OpenFIGI
      setStatus('Looking up names...', 0, stubs.length)
      const enriched = await enrichWithOpenFIGI(stubs)

      // Fetch prices + fundamentals
      dispatch({ type: 'SET_FETCH_STATUS', status: { phase: 'prices', message: '', current: 0, total: 0 } })
      const withPrices = await fetchPrices(enriched)

      // For ETFs, fetch justETF
      const etfs = withPrices.filter((i) => i.type === 'ETF' || i.type === 'ETC')
      let final = withPrices
      if (etfs.length > 0) {
        dispatch({ type: 'SET_FETCH_STATUS', status: { phase: 'justetf', message: '', current: 0, total: 0 } })
        final = await fetchJustETF(withPrices)
      }

      dispatch({ type: 'ADD_INSTRUMENTS', instruments: recalculateAll(final, state.settings.weights) })
      dispatch({ type: 'SET_FETCH_STATUS', status: { phase: 'done', message: `Added ${final.length} instruments`, current: final.length, total: final.length } })
    } catch (err: any) {
      dispatch({ type: 'SET_FETCH_STATUS', status: { phase: 'error', message: err.message, current: 0, total: 0 } })
    }
  }, [enrichWithOpenFIGI, fetchPrices, fetchJustETF, state.settings.weights])

  // ── Xetra background load ─────────────────────────────────────────────────

  // Stored Xetra instruments before activation
  const xetraBuffer = useRef<Instrument[]>([])

  const loadXetraBackground = useCallback(async () => {
    dispatch({ type: 'SET_XETRA_LOADING', loading: true })
    try {
      const csvText = await apiXetra()
      const rows = parseXetraCSV(csvText)
      const instruments = rows.map(xetraRowToInstrument)

      // Build group counts
      const etfCounts: Record<string, number> = {}
      const stockCounts: Record<string, number> = {}
      instruments.forEach((inst) => {
        const g = inst.xetraGroup || ''
        if (inst.type === 'Stock') {
          stockCounts[g] = (stockCounts[g] || 0) + 1
        } else {
          etfCounts[g] = (etfCounts[g] || 0) + 1
        }
      })

      dispatch({ type: 'SET_GROUP_COUNTS', etf: etfCounts, stock: stockCounts })
      xetraBuffer.current = instruments

      dispatch({ type: 'SET_XETRA_READY', ready: true })
      dispatch({ type: 'SET_XETRA_LOADING', loading: false })
    } catch (err) {
      dispatch({ type: 'SET_XETRA_LOADING', loading: false })
    }
  }, [])

  // ── Activate Xetra universe ───────────────────────────────────────────────

  const activateXetra = useCallback(async () => {
    abortRef.current = false
    const enabledETFGroups = state.etfGroups.filter((g) => g.enabled).map((g) => g.groupKey)
    const enabledStockGroups = state.stockGroups.filter((g) => g.enabled).map((g) => g.groupKey)

    // Filter instruments by selected groups
    let instruments = xetraBuffer.current.filter((inst) => {
      if (inst.type === 'Stock') {
        if (enabledStockGroups.includes('__OTHER_STOCKS__')) {
          // Include stocks not in any named group
          const inNamedGroup = ['DAX','MDAX','SDAX','DEUTSCHLAND','NORDAMERIKA','FRANKREICH',
            'GROSSBRITANNIEN','SKANDINAVIEN','SCHWEIZ LIECHTENSTEIN','BELGIEN NIEDERLANDE LUXEMBURG',
            'ITALIEN GRIECHENLAND','OESTERREICH','SPANIEN PORTUGAL'].includes(inst.xetraGroup || '')
          return enabledStockGroups.some(g => g === inst.xetraGroup) || !inNamedGroup
        }
        return enabledStockGroups.includes(inst.xetraGroup || '')
      }
      return enabledETFGroups.includes(inst.xetraGroup || '')
    })

    dispatch({ type: 'SET_XETRA_ACTIVE', active: true })
    dispatch({ type: 'SET_FETCH_STATUS', status: { phase: 'openfigi', message: '', current: 0, total: instruments.length } })

    try {
      // Enrich all with OpenFIGI (names)
      setStatus(`Enriching names: 0 / ${instruments.length}`, 0, instruments.length)
      const enriched = await enrichWithOpenFIGI(instruments)

      // Dedup ETFs
      dispatch({ type: 'SET_FETCH_STATUS', status: { phase: 'dedup', message: 'Deduplicating...', current: 0, total: 0 } })
      const etfs = enriched.filter((i) => i.type === 'ETF' || i.type === 'ETC')
      const stocks = enriched.filter((i) => i.type === 'Stock')

      const groups = buildDedupGroups(etfs)
      const dedupedEtfs = applyDedupToInstruments(etfs, groups)

      // Fetch justETF only for dedup winners
      const winners = dedupedEtfs.filter((i) => i.isDedupWinner)
      dispatch({ type: 'SET_FETCH_STATUS', status: { phase: 'justetf', message: '', current: 0, total: winners.length } })

      const justEtfResults = await processBatches(
        winners, BATCH_SIZE_JUSTETF, BATCH_DELAY_JUSTETF,
        async (batch) => {
          const r = await apiJustETF(batch.map((e) => e.isin))
          return r
        },
        (done, total) => setStatus(`Verifying ETF data: ${done} / ${total} groups`, done, total)
      )

      // Apply justETF results + handle fallback logic
      const aumFloor = state.settings.aumFloor
      const updatedWinners = winners.map((inst, i) => {
        const r = justEtfResults[i]
        if (!r) return inst
        const needsFallback = r.aum !== null && r.aum < aumFloor
        return { ...inst, aum: r.aum, ter: r.ter, justEtfFetched: true,
          isDedupWinner: !needsFallback }
      })

      // Recombine
      const allEtfs = dedupedEtfs.map((inst) => {
        const updated = updatedWinners.find((w) => w.isin === inst.isin)
        return updated || inst
      })

      const combined = [...allEtfs, ...stocks]

      // Fetch prices for winners + stocks
      const toFetch = combined.filter((i) => i.isDedupWinner !== false || i.type === 'Stock')
      dispatch({ type: 'SET_FETCH_STATUS', status: { phase: 'prices', message: '', current: 0, total: toFetch.length } })
      const withPrices = await fetchPrices(toFetch)

      // Merge back
      const finalMap = new Map(withPrices.map((i) => [i.isin, i]))
      const final = combined.map((i) => finalMap.get(i.isin) || i)

      dispatch({ type: 'ADD_INSTRUMENTS', instruments: recalculateAll(final, state.settings.weights) })
      dispatch({ type: 'SET_FETCH_STATUS', status: { phase: 'done', message: `Loaded ${winners.length} ETF groups + ${stocks.length} stocks`, current: final.length, total: final.length } })
    } catch (err: any) {
      dispatch({ type: 'SET_FETCH_STATUS', status: { phase: 'error', message: err.message, current: 0, total: 0 } })
    }
  }, [state.etfGroups, state.stockGroups, state.settings.aumFloor, state.settings.weights, enrichWithOpenFIGI, fetchPrices, fetchJustETF])

  return { processManualInput, loadXetraBackground, activateXetra, xetraBuffer }
}
