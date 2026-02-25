import React, { createContext, useContext, useReducer, useCallback } from 'react'
import type {
  Instrument, AppSettings, FetchStatus, ETFGroup, TableState,
  MomentumWeights,
} from './types'
import { ETF_GROUPS, STOCK_GROUPS, DEFAULT_ETF_GROUPS, DEFAULT_STOCK_GROUPS } from './types'
import { recalculateAll } from './utils/calculations'

// ─── State ───────────────────────────────────────────────────────────────────

interface AppState {
  // All loaded instruments (both manual and xetra)
  instruments: Instrument[]

  // Xetra background data (pre-parsed, not yet active)
  xetraReady: boolean
  xetraLoading: boolean

  // Settings
  settings: AppSettings

  // Table state
  tableState: TableState

  // ETF/Stock group selection
  etfGroups: ETFGroup[]
  stockGroups: ETFGroup[]

  // Fetch status
  fetchStatus: FetchStatus

  // Phase tracking
  xetraActive: boolean  // whether Xetra universe is shown
}

const DEFAULT_WEIGHTS: MomentumWeights = { w1m: 0.20, w3m: 0.30, w6m: 0.50 }

const DEFAULT_STATE: AppState = {
  instruments: [],
  xetraReady: false,
  xetraLoading: false,
  settings: {
    weights: DEFAULT_WEIGHTS,
    aumFloor: 100_000_000,
  },
  tableState: {
    sortColumn: 'momentumScore',
    sortDirection: 'desc',
    typeFilter: 'all',
    showDeduped: true,
    aumFloor: 100_000_000,
  },
  etfGroups: ETF_GROUPS.map((g) => ({
    ...g,
    count: 0,
    enabled: DEFAULT_ETF_GROUPS.includes(g.groupKey),
  })),
  stockGroups: STOCK_GROUPS.map((g) => ({
    ...g,
    count: 0,
    enabled: DEFAULT_STOCK_GROUPS.includes(g.groupKey),
  })),
  fetchStatus: { phase: 'idle', message: '', current: 0, total: 0 },
  xetraActive: false,
}

// ─── Actions ─────────────────────────────────────────────────────────────────

type Action =
  | { type: 'ADD_INSTRUMENTS'; instruments: Instrument[] }
  | { type: 'UPDATE_INSTRUMENT'; isin: string; updates: Partial<Instrument> }
  | { type: 'UPDATE_INSTRUMENTS'; updates: Map<string, Partial<Instrument>> }
  | { type: 'SET_INSTRUMENTS'; instruments: Instrument[] }
  | { type: 'SET_FETCH_STATUS'; status: Partial<FetchStatus> }
  | { type: 'SET_WEIGHTS'; weights: MomentumWeights }
  | { type: 'SET_AUM_FLOOR'; floor: number }
  | { type: 'SET_TABLE_STATE'; updates: Partial<TableState> }
  | { type: 'SET_ETF_GROUP'; groupKey: string; enabled: boolean }
  | { type: 'SET_STOCK_GROUP'; groupKey: string; enabled: boolean }
  | { type: 'SET_GROUP_COUNTS'; etf: Record<string, number>; stock: Record<string, number> }
  | { type: 'SET_XETRA_READY'; ready: boolean }
  | { type: 'SET_XETRA_LOADING'; loading: boolean }
  | { type: 'SET_XETRA_ACTIVE'; active: boolean }
  | { type: 'REMOVE_INSTRUMENT'; isin: string }
  | { type: 'CLEAR_XETRA' }

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'ADD_INSTRUMENTS': {
      const existingISINs = new Set(state.instruments.map((i) => i.isin))
      const newInst = action.instruments.filter((i) => !existingISINs.has(i.isin))
      const merged = [...state.instruments, ...newInst]
      return { ...state, instruments: recalculateAll(merged, state.settings.weights) }
    }

    case 'SET_INSTRUMENTS': {
      return { ...state, instruments: recalculateAll(action.instruments, state.settings.weights) }
    }

    case 'UPDATE_INSTRUMENT': {
      const instruments = state.instruments.map((inst) =>
        inst.isin === action.isin ? { ...inst, ...action.updates } : inst
      )
      return { ...state, instruments: recalculateAll(instruments, state.settings.weights) }
    }

    case 'UPDATE_INSTRUMENTS': {
      const instruments = state.instruments.map((inst) => {
        const updates = action.updates.get(inst.isin)
        return updates ? { ...inst, ...updates } : inst
      })
      return { ...state, instruments: recalculateAll(instruments, state.settings.weights) }
    }

    case 'SET_FETCH_STATUS':
      return { ...state, fetchStatus: { ...state.fetchStatus, ...action.status } }

    case 'SET_WEIGHTS': {
      const instruments = recalculateAll(state.instruments, action.weights)
      return {
        ...state,
        settings: { ...state.settings, weights: action.weights },
        instruments,
      }
    }

    case 'SET_AUM_FLOOR':
      return {
        ...state,
        settings: { ...state.settings, aumFloor: action.floor },
        tableState: { ...state.tableState, aumFloor: action.floor },
      }

    case 'SET_TABLE_STATE':
      return { ...state, tableState: { ...state.tableState, ...action.updates } }

    case 'SET_ETF_GROUP':
      return {
        ...state,
        etfGroups: state.etfGroups.map((g) =>
          g.groupKey === action.groupKey ? { ...g, enabled: action.enabled } : g
        ),
      }

    case 'SET_STOCK_GROUP':
      return {
        ...state,
        stockGroups: state.stockGroups.map((g) =>
          g.groupKey === action.groupKey ? { ...g, enabled: action.enabled } : g
        ),
      }

    case 'SET_GROUP_COUNTS':
      return {
        ...state,
        etfGroups: state.etfGroups.map((g) => ({
          ...g,
          count: action.etf[g.groupKey] || 0,
        })),
        stockGroups: state.stockGroups.map((g) => ({
          ...g,
          count: action.stock[g.groupKey] || 0,
        })),
      }

    case 'SET_XETRA_READY':
      return { ...state, xetraReady: action.ready }

    case 'SET_XETRA_LOADING':
      return { ...state, xetraLoading: action.loading }

    case 'SET_XETRA_ACTIVE':
      return { ...state, xetraActive: action.active }

    case 'REMOVE_INSTRUMENT':
      return {
        ...state,
        instruments: state.instruments.filter((i) => i.isin !== action.isin),
      }

    case 'CLEAR_XETRA':
      return {
        ...state,
        instruments: state.instruments.filter((i) => i.source !== 'xetra'),
        xetraActive: false,
      }

    default:
      return state
  }
}

// ─── Context ─────────────────────────────────────────────────────────────────

const AppContext = createContext<{
  state: AppState
  dispatch: React.Dispatch<Action>
} | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, DEFAULT_STATE)
  return <AppContext.Provider value={{ state, dispatch }}>{children}</AppContext.Provider>
}

export function useAppState() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useAppState must be used within AppProvider')
  return ctx
}

// ─── Filtered / Sorted Instruments ───────────────────────────────────────────

export function useDisplayedInstruments() {
  const { state } = useAppState()
  const { instruments, tableState, settings } = state

  let filtered = [...instruments]

  // Type filter
  if (tableState.typeFilter === 'etf') {
    filtered = filtered.filter((i) => i.type === 'ETF' || i.type === 'ETC')
  } else if (tableState.typeFilter === 'stock') {
    filtered = filtered.filter((i) => i.type === 'Stock')
  }

  // Dedup filter (only ETFs)
  if (tableState.showDeduped) {
    filtered = filtered.filter((i) => {
      if (i.type === 'Stock') return true // stocks always shown
      if (i.source !== 'xetra') return true // manual input always shown
      return i.isDedupWinner !== false // show winners (or undeduped)
    })
  }

  // AUM floor — only applied when dedup is ON (when OFF user wants to see all)
  if (tableState.showDeduped) {
    filtered = filtered.filter((i) => {
      if (i.type === 'Stock' || i.source === 'manual') return true
      if (i.aum === null || i.aum === undefined) return true // show if unknown
      return i.aum >= settings.aumFloor
    })
  }

  // Sort
  const col = tableState.sortColumn
  const dir = tableState.sortDirection === 'desc' ? -1 : 1

  filtered.sort((a, b) => {
    const av = (a as any)[col]
    const bv = (b as any)[col]
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    return (av - bv) * dir
  })

  return filtered
}
