import React, { createContext, useContext, useReducer } from 'react';
import type {
  Instrument, AppSettings, FetchStatus, ETFGroup, TableState, MomentumWeights,
} from './types';
import { ETF_GROUPS, STOCK_GROUPS, DEFAULT_ETF_GROUPS, DEFAULT_STOCK_GROUPS } from './types';
import { recalculateAll } from './utils/calculations';

interface AppState {
  instruments: Instrument[];
  xetraReady: boolean;
  xetraLoading: boolean;
  settings: AppSettings;
  tableState: TableState;
  etfGroups: ETFGroup[];
  stockGroups: ETFGroup[];
  fetchStatus: FetchStatus;
  xetraActive: boolean;
}

const DEFAULT_WEIGHTS: MomentumWeights = { w1m: 1 / 3, w3m: 1 / 3, w6m: 1 / 3 };

const DEFAULT_STATE: AppState = {
  instruments: [],
  xetraReady: false,
  xetraLoading: false,
  settings: {
    weights: DEFAULT_WEIGHTS,
    aumFloor: 100_000_000,
    atrMultiplier: 4,
    riskFreeRate: 0.035, // 3.5% p.a. (ECB/EUR)
  },
  tableState: {
    sortColumn: 'sharpeScore', // ← Sharpe as default
    sortDirection: 'desc',
    typeFilter: 'all',
    showDeduped: false, // Set to false by default
    aumFloor: 100_000_000,
    filterBelowRiskFree: true, // ← ON by default
  },
  etfGroups: ETF_GROUPS.map((g) => ({ ...g, count: 0, enabled: DEFAULT_ETF_GROUPS.includes(g.groupKey) })),
  stockGroups: STOCK_GROUPS.map((g) => ({ ...g, count: 0, enabled: DEFAULT_STOCK_GROUPS.includes(g.groupKey) })),
  fetchStatus: { phase: 'idle', message: '', current: 0, total: 0 },
  xetraActive: false,
};

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
  | { type: 'SET_TABLE_STATE'; updates: Partial<TableState> }
  | { type: 'SET_ETF_GROUP'; groupKey: string; enabled: boolean }
  | { type: 'SET_STOCK_GROUP'; groupKey: string; enabled: boolean }
  | { type: 'SET_GROUP_COUNTS'; etf: Record<string, number>; stock: Record<string, number> }
  | { type: 'SET_XETRA_READY'; ready: boolean }
  | { type: 'SET_XETRA_LOADING'; loading: boolean }
  | { type: 'SET_XETRA_ACTIVE'; active: boolean }
  | { type: 'REMOVE_INSTRUMENT'; isin: string }
  | { type: 'CLEAR_XETRA' };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'ADD_INSTRUMENTS': {
      const existingISINs = new Set(state.instruments.map((i) => i.isin));
      const newInst = action.instruments.filter((i) => !existingISINs.has(i.isin));
      const merged = [...state.instruments, ...newInst];
      return { ...state, instruments: recalculateAll(merged, state.settings.weights, state.settings.atrMultiplier) };
    }
    case 'SET_INSTRUMENTS':
      return { ...state, instruments: recalculateAll(action.instruments, state.settings.weights, state.settings.atrMultiplier) };
    case 'UPDATE_INSTRUMENT': {
      const instruments = state.instruments.map((inst) =>
        inst.isin === action.isin ? { ...inst, ...action.updates } : inst
      );
      return { ...state, instruments: recalculateAll(instruments, state.settings.weights, state.settings.atrMultiplier) };
    }
    case 'UPDATE_INSTRUMENTS': {
      const instruments = state.instruments.map((inst) => {
        const updates = action.updates.get(inst.isin);
        return updates ? { ...inst, ...updates } : inst;
      });
      return { ...state, instruments: recalculateAll(instruments, state.settings.weights, state.settings.atrMultiplier) };
    }
    case 'SET_FETCH_STATUS':
      return { ...state, fetchStatus: { ...state.fetchStatus, ...action.status } };
    case 'SET_WEIGHTS': {
      const instruments = recalculateAll(state.instruments, action.weights, state.settings.atrMultiplier);
      return { ...state, settings: { ...state.settings, weights: action.weights }, instruments };
    }
    case 'SET_AUM_FLOOR':
      return {
        ...state,
        settings: { ...state.settings, aumFloor: action.floor },
        tableState: { ...state.tableState, aumFloor: action.floor },
      };
    case 'SET_ATR_MULTIPLIER': {
      const instruments = recalculateAll(state.instruments, state.settings.weights, action.multiplier);
      return { ...state, settings: { ...state.settings, atrMultiplier: action.multiplier }, instruments };
    }
    case 'SET_RISK_FREE_RATE':
      return { ...state, settings: { ...state.settings, riskFreeRate: action.rate } };
    case 'SET_TABLE_STATE':
      return { ...state, tableState: { ...state.tableState, ...action.updates } };
    case 'SET_ETF_GROUP':
      return {
        ...state,
        etfGroups: state.etfGroups.map((g) =>
          g.groupKey === action.groupKey ? { ...g, enabled: action.enabled } : g
        ),
      };
    case 'SET_STOCK_GROUP':
      return {
        ...state,
        stockGroups: state.stockGroups.map((g) =>
          g.groupKey === action.groupKey ? { ...g, enabled: action.enabled } : g
        ),
      };
    case 'SET_GROUP_COUNTS':
      return {
        ...state,
        etfGroups: state.etfGroups.map((g) => ({ ...g, count: action.etf[g.groupKey] || 0 })),
        stockGroups: state.stockGroups.map((g) => ({ ...g, count: action.stock[g.groupKey] || 0 })),
      };
    case 'SET_XETRA_READY': return { ...state, xetraReady: action.ready };
    case 'SET_XETRA_LOADING': return { ...state, xetraLoading: action.loading };
    case 'SET_XETRA_ACTIVE': return { ...state, xetraActive: action.active };
    case 'REMOVE_INSTRUMENT':
      return { ...state, instruments: state.instruments.filter((i) => i.isin !== action.isin) };
    case 'CLEAR_XETRA':
      return { ...state, instruments: state.instruments.filter((i) => i.source !== 'xetra'), xetraActive: false };
    default:
      return state;
  }
}

const AppContext = createContext<{ state: AppState; dispatch: React.Dispatch<Action> } | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, DEFAULT_STATE);
  return <AppContext.Provider value={{ state, dispatch }}>{children}</AppContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppState must be used within AppProvider');
  return ctx;
}

export function useDisplayedInstruments() {
  const { state } = useAppState();
  const { instruments, tableState, settings } = state;

  let filtered = [...instruments];

  // Type filter
  if (tableState.typeFilter === 'etf') {
    filtered = filtered.filter((i) => i.type === 'ETF' || i.type === 'ETC');
  } else if (tableState.typeFilter === 'stock') {
    filtered = filtered.filter((i) => i.type === 'Stock');
  }

  // Dedup filter
  if (!tableState.showDeduped) {
    filtered = filtered.filter((i) => {
      if (i.type === 'Stock') return true;
      if (i.source !== 'xetra') return true;
      return i.isDedupWinner !== false;
    });
  }

  // AUM floor
  if (tableState.showDeduped) {
    filtered = filtered.filter((i) => {
      if (i.type === 'Stock' || i.source === 'manual') return true;
      if (i.aum == null) return true;
      return i.aum >= settings.aumFloor;
    });
  }

  // Risk-free rate filter
  // Compares 6M return (annualised × 2) against risk-free rate.
  // Falls back to 3M (×4) if 6M unavailable.
  if (tableState.filterBelowRiskFree) {
    const rfr = settings.riskFreeRate;
    filtered = filtered.filter((i) => {
      if (i.r6m !== null && i.r6m !== undefined) {
        return i.r6m * 2 >= rfr; // annualise 6M return
      }
      if (i.r3m !== null && i.r3m !== undefined) {
        return i.r3m * 4 >= rfr; // annualise 3M return
      }
      return true; // no data → keep
    });
  }

  // Sort
  const col = tableState.sortColumn;
  const dir = tableState.sortDirection === 'desc' ? -1 : 1;
  filtered.sort((a, b) => {
    const av = (a as any)[col];
    const bv = (b as any)[col];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av - bv) * dir;
  });

  return filtered;
}