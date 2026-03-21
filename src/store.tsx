import React, { createContext, useContext, useEffect, useReducer } from 'react'
import type {
  Instrument, AppSettings, FetchStatus, ETFGroup, TableState, MomentumWeights, RegimeResult, ColumnGroup,
} from './types'
import { ETF_GROUPS, STOCK_GROUPS, DEFAULT_ETF_GROUPS, DEFAULT_STOCK_GROUPS } from './types'
import { recalculateAll } from './utils/calculations'
import { applyAiFilterPlan } from './utils/aiFilter'

interface AppState {
  instruments: Instrument[]
  xetraReady: boolean
  xetraLoading: boolean
  settings: AppSettings
  tableState: TableState
  referenceR3m: number | null
  etfGroups: ETFGroup[]
  stockGroups: ETFGroup[]
  fetchStatus: FetchStatus
  xetraActive: boolean
  portfolioIsins: string[]
  marketRegime: RegimeResult | null
}

const DEFAULT_WEIGHTS: MomentumWeights = { w1m: 1/3, w3m: 1/3, w6m: 1/3 }

const GROUPS_STORAGE_KEY = 'xetra:groups'
const PORTFOLIO_STORAGE_KEY = 'portfolio:isins'
const HIDDEN_COLUMNS_KEY = 'ui:hiddenColumnGroups'

function loadGroupPrefs(): { etf: string[]; stock: string[] } | null {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(GROUPS_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return {
      etf: Array.isArray(parsed.etf) ? parsed.etf : [],
      stock: Array.isArray(parsed.stock) ? parsed.stock : [],
    }
  } catch {
    return null
  }
}

function saveGroupPrefs(etfGroups: ETFGroup[], stockGroups: ETFGroup[]) {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return
  try {
    const etf = etfGroups.filter((g) => g.enabled).map((g) => g.groupKey)
    const stock = stockGroups.filter((g) => g.enabled).map((g) => g.groupKey)
    localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify({ etf, stock }))
  } catch {
    // ignore storage errors
  }
}

function loadPortfolio(): string[] {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(PORTFOLIO_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function savePortfolio(isins: string[]) {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(isins))
  } catch {
    try {
      // Free space by clearing large caches, then retry once.
      const keysToClear = [
        'cache:xetra',
        'cache:openfigi:v2',
      ]
      keysToClear.forEach((k) => localStorage.removeItem(k))
      // Clear all per-ticker caches
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith('cache:yahoo:') || k.startsWith('cache:analyst:')) {
          localStorage.removeItem(k)
        }
      })
      localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(isins))
    } catch {
      // ignore storage errors
    }
  }
}

function loadHiddenColumnGroups(): ColumnGroup[] {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(HIDDEN_COLUMNS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const allowed: ColumnGroup[] = ['scores', 'returns', 'technical', 'fundamentals', 'breakout', 'tfa', 'pullback']
    return parsed.filter((v) => allowed.includes(v))
  } catch {
    return []
  }
}

function saveHiddenColumnGroups(groups: ColumnGroup[]) {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(HIDDEN_COLUMNS_KEY, JSON.stringify(groups))
  } catch {
    // ignore storage errors
  }
}

const persistedGroups = loadGroupPrefs()
const persistedPortfolio = loadPortfolio()
const persistedHiddenColumns = loadHiddenColumnGroups()

const DEFAULT_STATE: AppState = {
  instruments: [],
  xetraReady: false,
  xetraLoading: false,
  settings: {
    weights: DEFAULT_WEIGHTS,
    aumFloor: 100_000_000,
    atrMultiplier: 4,
    riskFreeRate: 0.035,  // 3.5% p.a. (ECB/EUR)
  },
  tableState: {
    sortColumn: 'riskAdjustedScore',
    sortDirection: 'desc',
    typeFilter: 'all',
    showDeduped: true,
    filterBelowRiskFree: true,  // ← ON by default
    filterBelowAllMAs: false,
    tfaMode: false,
    pullbackMode: false,
    aiFilterPlan: null,
    aiFilterQuery: null,
    aiFilterActive: false,
    hiddenColumnGroups: persistedHiddenColumns,
  },
  referenceR3m: null,
  etfGroups: ETF_GROUPS.map((g) => ({
    ...g,
    count: 0,
    enabled: persistedGroups ? persistedGroups.etf.includes(g.groupKey) : DEFAULT_ETF_GROUPS.includes(g.groupKey),
  })),
  stockGroups: STOCK_GROUPS.map((g) => ({
    ...g,
    count: 0,
    enabled: persistedGroups ? persistedGroups.stock.includes(g.groupKey) : DEFAULT_STOCK_GROUPS.includes(g.groupKey),
  })),
  fetchStatus: { phase: 'idle', message: '', current: 0, total: 0 },
  xetraActive: false,
  portfolioIsins: persistedPortfolio,
  marketRegime: null,
}

const SCORE_AFFECTING_KEYS = new Set<keyof Instrument>([
  'closes',
  'highs',
  'lows',
  'volumes',
  'timestamps',
  'pe',
  'pb',
  'ebitda',
  'enterpriseValue',
  'returnOnAssets',
  'analystRating',
  'marketCap',
])

function updatesAffectScores(updates: Partial<Instrument>): boolean {
  return Object.keys(updates).some((k) => SCORE_AFFECTING_KEYS.has(k as keyof Instrument))
}

type Action =
  | { type: 'ADD_INSTRUMENTS'; instruments: Instrument[] }
  | { type: 'UPDATE_INSTRUMENT'; isin: string; updates: Partial<Instrument> }
  | { type: 'UPDATE_INSTRUMENTS'; updates: Map<string, Partial<Instrument>> }
  | { type: 'SET_INSTRUMENTS'; instruments: Instrument[] }
  | { type: 'SET_FETCH_STATUS'; status: Partial<FetchStatus> }
  | { type: 'SET_WEIGHTS'; weights: MomentumWeights }
  | { type: 'SET_AUM_FLOOR'; floor: number }
  | { type: 'SET_ATR_MULTIPLIER'; multiplier: number }
  | { type: 'SET_RISK_FREE_RATE'; rate: number }
  | { type: 'SET_REFERENCE_R3M'; r3m: number | null }
  | { type: 'SET_TABLE_STATE'; updates: Partial<TableState> }
  | { type: 'SET_ETF_GROUP'; groupKey: string; enabled: boolean }
  | { type: 'SET_STOCK_GROUP'; groupKey: string; enabled: boolean }
  | { type: 'SET_GROUP_COUNTS'; etf: Record<string, number>; stock: Record<string, number> }
  | { type: 'SET_XETRA_READY'; ready: boolean }
  | { type: 'SET_XETRA_LOADING'; loading: boolean }
  | { type: 'SET_XETRA_ACTIVE'; active: boolean }
  | { type: 'REMOVE_INSTRUMENT'; isin: string }
  | { type: 'CLEAR_XETRA' }
  | { type: 'TOGGLE_PORTFOLIO'; isin: string }
  | { type: 'SET_MARKET_REGIME'; regime: RegimeResult | null }
  | { type: 'TOGGLE_COLUMN_GROUP'; group: ColumnGroup }

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'ADD_INSTRUMENTS': {
      const existingISINs = new Set(state.instruments.map((i) => i.isin))
      const seenInBatch = new Set<string>()
      const portfolioSet = new Set(state.portfolioIsins)
      const newInst = action.instruments
        .filter((i) => !existingISINs.has(i.isin))
        .filter((i) => {
          if (seenInBatch.has(i.isin)) return false
          seenInBatch.add(i.isin)
          return true
        })
        .map((i) => ({ ...i, inPortfolio: portfolioSet.has(i.isin) }))
      const merged = [...state.instruments, ...newInst]
      return { ...state, instruments: recalculateAll(merged, state.settings.weights, state.settings.atrMultiplier, state.referenceR3m) }
    }
    case 'SET_INSTRUMENTS':
      {
        const portfolioSet = new Set(state.portfolioIsins)
        const seen = new Set<string>()
        const next = action.instruments
          .filter((i) => {
            if (seen.has(i.isin)) return false
            seen.add(i.isin)
            return true
          })
          .map((i) => ({ ...i, inPortfolio: portfolioSet.has(i.isin) }))
        return { ...state, instruments: recalculateAll(next, state.settings.weights, state.settings.atrMultiplier, state.referenceR3m) }
      }
    case 'UPDATE_INSTRUMENT': {
      const instruments = state.instruments.map((inst) =>
        inst.isin === action.isin ? { ...inst, ...action.updates } : inst
      )
      if (!updatesAffectScores(action.updates)) {
        return { ...state, instruments }
      }
      return { ...state, instruments: recalculateAll(instruments, state.settings.weights, state.settings.atrMultiplier, state.referenceR3m) }
    }
    case 'UPDATE_INSTRUMENTS': {
      const needsRecalc = Array.from(action.updates.values()).some((u) => updatesAffectScores(u))
      const instruments = state.instruments.map((inst) => {
        const updates = action.updates.get(inst.isin)
        return updates ? { ...inst, ...updates } : inst
      })
      if (!needsRecalc) {
        return { ...state, instruments }
      }
      return { ...state, instruments: recalculateAll(instruments, state.settings.weights, state.settings.atrMultiplier, state.referenceR3m) }
    }
    case 'SET_FETCH_STATUS':
      return { ...state, fetchStatus: { ...state.fetchStatus, ...action.status } }
    case 'SET_WEIGHTS': {
      const instruments = recalculateAll(state.instruments, action.weights, state.settings.atrMultiplier, state.referenceR3m)
      return { ...state, settings: { ...state.settings, weights: action.weights }, instruments }
    }
    case 'SET_AUM_FLOOR':
      return {
        ...state,
        settings: { ...state.settings, aumFloor: action.floor },
      }
    case 'SET_ATR_MULTIPLIER': {
      const instruments = recalculateAll(state.instruments, state.settings.weights, action.multiplier, state.referenceR3m)
      return { ...state, settings: { ...state.settings, atrMultiplier: action.multiplier }, instruments }
    }
    case 'SET_RISK_FREE_RATE':
      return { ...state, settings: { ...state.settings, riskFreeRate: action.rate } }
    case 'SET_REFERENCE_R3M': {
      const instruments = recalculateAll(state.instruments, state.settings.weights, state.settings.atrMultiplier, action.r3m)
      return { ...state, referenceR3m: action.r3m, instruments }
    }
    case 'SET_TABLE_STATE': {
      const updates = action.updates
      // Mutual Exclusion: TFA und Pullback-Modus schließen sich aus
      if (updates.tfaMode === true) updates.pullbackMode = false
      if (updates.pullbackMode === true) updates.tfaMode = false
      return { ...state, tableState: { ...state.tableState, ...updates } }
    }
    case 'SET_ETF_GROUP':
      {
        const etfGroups = state.etfGroups.map((g) =>
          g.groupKey === action.groupKey ? { ...g, enabled: action.enabled } : g
        )
        saveGroupPrefs(etfGroups, state.stockGroups)
        return { ...state, etfGroups }
      }
    case 'SET_STOCK_GROUP':
      {
        const stockGroups = state.stockGroups.map((g) =>
          g.groupKey === action.groupKey ? { ...g, enabled: action.enabled } : g
        )
        saveGroupPrefs(state.etfGroups, stockGroups)
        return { ...state, stockGroups }
      }
    case 'SET_GROUP_COUNTS':
      return {
        ...state,
        etfGroups: state.etfGroups.map((g) => ({ ...g, count: action.etf[g.groupKey] || 0 })),
        stockGroups: state.stockGroups.map((g) => ({ ...g, count: action.stock[g.groupKey] || 0 })),
      }
    case 'SET_XETRA_READY':    return { ...state, xetraReady: action.ready }
    case 'SET_XETRA_LOADING':  return { ...state, xetraLoading: action.loading }
    case 'SET_XETRA_ACTIVE':   return { ...state, xetraActive: action.active }
    case 'REMOVE_INSTRUMENT':
      return { ...state, instruments: state.instruments.filter((i) => i.isin !== action.isin) }
    case 'CLEAR_XETRA':
      return { ...state, instruments: state.instruments.filter((i) => i.source !== 'xetra'), xetraActive: false }
    case 'TOGGLE_PORTFOLIO': {
      const exists = state.portfolioIsins.includes(action.isin)
      const nextIsins = exists
        ? state.portfolioIsins.filter((i) => i !== action.isin)
        : [...state.portfolioIsins, action.isin]
      savePortfolio(nextIsins)
      return {
        ...state,
        portfolioIsins: nextIsins,
        instruments: state.instruments.map((inst) =>
          inst.isin === action.isin ? { ...inst, inPortfolio: !exists } : inst
        ),
      }
    }
    case 'SET_MARKET_REGIME':
      return { ...state, marketRegime: action.regime }
    case 'TOGGLE_COLUMN_GROUP': {
      const current = state.tableState.hiddenColumnGroups
      const next = current.includes(action.group)
        ? current.filter((g) => g !== action.group)
        : [...current, action.group]
      saveHiddenColumnGroups(next)
      return { ...state, tableState: { ...state.tableState, hiddenColumnGroups: next } }
    }
    default:
      return state
  }
}

const AppContext = createContext<{ state: AppState; dispatch: React.Dispatch<Action> } | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, DEFAULT_STATE)
  useEffect(() => {
    const prefs = loadGroupPrefs()
    if (!prefs) return
    const etfSet = new Set(prefs.etf)
    const stockSet = new Set(prefs.stock)
    state.etfGroups.forEach((g) => {
      const shouldEnable = etfSet.has(g.groupKey)
      if (g.enabled !== shouldEnable) {
        dispatch({ type: 'SET_ETF_GROUP', groupKey: g.groupKey, enabled: shouldEnable })
      }
    })
    state.stockGroups.forEach((g) => {
      const shouldEnable = stockSet.has(g.groupKey)
      if (g.enabled !== shouldEnable) {
        dispatch({ type: 'SET_STOCK_GROUP', groupKey: g.groupKey, enabled: shouldEnable })
      }
    })
  }, [])
  return <AppContext.Provider value={{ state, dispatch }}>{children}</AppContext.Provider>
}

export function useAppState() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useAppState must be used within AppProvider')
  return ctx
}

export function useDisplayedInstruments() {
  const { state } = useAppState()
  const { instruments, tableState, settings } = state

  let filtered = [...instruments]

  // Type filter
  if (tableState.typeFilter === 'etf') {
    filtered = filtered.filter((i) =>
      i.type === 'ETF' || i.type === 'ETC' || (i.type === 'Unknown' && i.source === 'manual')
    )
  } else if (tableState.typeFilter === 'stock') {
    filtered = filtered.filter((i) =>
      i.type === 'Stock' || (i.type === 'Unknown' && i.source === 'manual')
    )
  }

  // TFA mode — only stocks in the -40%..-80% drawdown window, excluding KO
  if (tableState.tfaMode) {
    filtered = filtered.filter((i) => i.type === 'Stock')
    const allowed = new Set(['monitoring', 'above_all_mas', 'watch', 'fetching', 'qualified'])
    filtered = filtered.filter((i) => allowed.has(i.tfaPhase ?? 'none'))
    filtered = filtered.filter((i) => i.tfaKO !== true)
  }

  // Pullback-Modus — Top-Momentum-Stocks mit RSI-Rücksetzer
  if (tableState.pullbackMode) {
    filtered = filtered.filter((i) => i.type === 'Stock')
    filtered = filtered.filter((i) => i.aboveMa200 === true)
    filtered = filtered.filter((i) => (i.r3m ?? -1) > 0)
    filtered = filtered.filter((i) => i.pullbackScore !== null && i.pullbackScore !== undefined)
    // Nur Titel die Gate bestanden haben (pullbackScore !== null = alle Gates erfüllt)
  }

  // Dedup filter — hides non-winners when enabled
  if (tableState.showDeduped) {
    filtered = filtered.filter((i) => {
      if (i.type === 'Stock') return true
      if (i.source !== 'xetra') return true
      return i.isDedupWinner !== false
    })
  }

  // AUM floor — always applied (independent of dedup toggle)
  filtered = filtered.filter((i) => {
    if (i.type === 'Stock' || i.source === 'manual') return true
    if (i.aum == null) return true
    return i.aum >= settings.aumFloor
  })

  // Risk-free rate filter
  // Compares 6M return (annualised × 2) against risk-free rate.
  // Falls back to 3M (×4) if 6M unavailable.
  if (tableState.filterBelowRiskFree) {
    const rfr = settings.riskFreeRate
    filtered = filtered.filter((i) => {
      if (i.r6m !== null && i.r6m !== undefined) {
        return i.r6m * 2 >= rfr  // annualise 6M return
      }
      if (i.r3m !== null && i.r3m !== undefined) {
        return i.r3m * 4 >= rfr  // annualise 3M return
      }
      return true // no data → keep
    })
  }

  // MA filter — keeps only instruments above all computed MAs (10/50/100/200)
  if (tableState.filterBelowAllMAs) {
    filtered = filtered.filter((i) => {
      const flags = [i.aboveMa10, i.aboveMa50, i.aboveMa100, i.aboveMa200]
      const hasAny = flags.some((v) => v !== null && v !== undefined)
      if (!hasAny) return true
      return flags.every((v) => v == null || v === true)
    })
  }

  // KI-Freitext-Filter
  if (tableState.aiFilterActive && tableState.aiFilterPlan) {
    filtered = applyAiFilterPlan(filtered, tableState.aiFilterPlan)
  }

  // Sort
  const col = tableState.sortColumn
  const dir = tableState.sortDirection === 'desc' ? -1 : 1
  const sorted = [...filtered].sort((a, b) => {
    const getVal = (inst: Instrument) => {
      if (col === 'tfaScore' && tableState.tfaMode) {
        return (inst as any).tfaScore ?? (inst as any).tfaTScore ?? null
      }
      if (col === 'pullbackScore' && tableState.pullbackMode) {
        return (inst as any).pullbackScore ?? null
      }
      return (inst as any)[col] ?? null
    }
    const avRaw = getVal(a)
    const bvRaw = getVal(b)
    if (avRaw == null && bvRaw == null) return a.displayName.localeCompare(b.displayName)
    if (avRaw == null) return 1
    if (bvRaw == null) return -1
    const av = typeof avRaw === 'number' ? avRaw : Number(avRaw)
    const bv = typeof bvRaw === 'number' ? bvRaw : Number(bvRaw)
    if (!Number.isFinite(av) && !Number.isFinite(bv)) return a.displayName.localeCompare(b.displayName)
    if (!Number.isFinite(av)) return 1
    if (!Number.isFinite(bv)) return -1
    const diff = (av - bv) * dir
    if (diff !== 0) return diff
    return a.displayName.localeCompare(b.displayName)
  })

  return sorted
}
