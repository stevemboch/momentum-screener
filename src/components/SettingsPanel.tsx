import { useState } from 'react'
import { Settings } from 'lucide-react'
import { useAppState } from '../store'
import type { MomentumWeights } from '../types'
import { FieldRow } from './ui/FieldRow'
import { ModalShell } from './ui/ModalShell'
import { ToggleRow } from './ui/ToggleRow'

export function SettingsPanel() {
  const [open, setOpen] = useState(false)
  const { state, dispatch } = useAppState()
  const { weights, aumFloor, atrMultiplier, riskFreeRate } = state.settings
  const { showDeduped, filterBelowRiskFree } = state.tableState

  const raw = {
    w1m: weights.w1m * 10,
    w3m: weights.w3m * 10,
    w6m: weights.w6m * 10,
  }
  const total = raw.w1m + raw.w3m + raw.w6m
  const norm = (v: number) => (total > 0 ? v / total : 1 / 3)
  const fmtW = (v: number) => `${(norm(v) * 100).toFixed(0)}%`

  const updateWeight = (key: keyof MomentumWeights, value: number) => {
    const next = { ...raw, [key]: value }
    const nextTotal = next.w1m + next.w3m + next.w6m
    const normalized = {
      w1m: nextTotal > 0 ? next.w1m / nextTotal : 1 / 3,
      w3m: nextTotal > 0 ? next.w3m / nextTotal : 1 / 3,
      w6m: nextTotal > 0 ? next.w6m / nextTotal : 1 / 3,
    }
    dispatch({ type: 'SET_WEIGHTS', weights: normalized })
  }

  const resetDefaults = () => {
    dispatch({ type: 'SET_WEIGHTS', weights: { w1m: 1 / 3, w3m: 1 / 3, w6m: 1 / 3 } })
    dispatch({ type: 'SET_ATR_MULTIPLIER', multiplier: 4 })
    dispatch({ type: 'SET_AUM_FLOOR', floor: 100_000_000 })
    dispatch({ type: 'SET_RISK_FREE_RATE', rate: 0.035 })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-sm btn-secondary focus-ring"
      >
        <Settings size={12} />
        Settings
      </button>

      {open && (
        <ModalShell
          title="Settings"
          subtitle="Scoring, risk, and visibility preferences"
          onClose={() => setOpen(false)}
          widthClass="max-w-lg"
          footer={(
            <div className="flex justify-end gap-2">
              <button type="button" onClick={resetDefaults} className="btn btn-sm btn-ghost focus-ring">
                Reset defaults
              </button>
              <button type="button" onClick={() => setOpen(false)} className="btn btn-sm btn-secondary focus-ring">
                Close
              </button>
            </div>
          )}
        >
          <FieldRow label="Momentum Weights" hint="Auto-normalized">
            <WeightSlider
              label="1M"
              value={raw.w1m}
              effective={fmtW(raw.w1m)}
              onChange={(v) => updateWeight('w1m', v)}
            />
            <WeightSlider
              label="3M"
              value={raw.w3m}
              effective={fmtW(raw.w3m)}
              onChange={(v) => updateWeight('w3m', v)}
            />
            <WeightSlider
              label="6M"
              value={raw.w6m}
              effective={fmtW(raw.w6m)}
              onChange={(v) => updateWeight('w6m', v)}
            />
            <div className="mt-1 text-ui-xs font-mono text-muted">
              Effective: {fmtW(raw.w1m)} / {fmtW(raw.w3m)} / {fmtW(raw.w6m)}
            </div>
          </FieldRow>

          <FieldRow label="Selling Threshold (ATR)" hint="Last Price - a × ATR(20)">
            <div className="flex items-center gap-3">
              <span className="w-4 text-ui-sm font-mono text-muted">a</span>
              <input
                type="range"
                min={3}
                max={5}
                step={0.25}
                value={atrMultiplier}
                onChange={(e) =>
                  dispatch({ type: 'SET_ATR_MULTIPLIER', multiplier: Number(e.target.value) })
                }
                className="h-1 flex-1 accent-blue-500"
              />
              <span className="w-10 text-right text-ui-sm font-mono text-gray-300">{atrMultiplier.toFixed(2)}</span>
            </div>
            <div className="mt-1 text-ui-xs font-mono text-muted">
              3 = tighter stop · 5 = wider stop · current: {atrMultiplier}× ATR(20)
            </div>
          </FieldRow>

          <FieldRow label="Dedup Filter">
            <ToggleRow
              label="Deduplicated ETFs"
              hint="Hide non-winners in each dedup group"
              active={showDeduped}
              onToggle={() =>
                dispatch({ type: 'SET_TABLE_STATE', updates: { showDeduped: !showDeduped } })
              }
            />
          </FieldRow>

          <FieldRow label="Risk-Free Filter">
            <ToggleRow
              label="Above risk-free rate"
              hint={`Hide instruments below ${(riskFreeRate * 100).toFixed(1)}% annualized`}
              active={filterBelowRiskFree}
              onToggle={() =>
                dispatch({
                  type: 'SET_TABLE_STATE',
                  updates: { filterBelowRiskFree: !filterBelowRiskFree },
                })
              }
            />
          </FieldRow>

          <FieldRow label="Risk-Free Rate" hint="Used by the risk-free filter">
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={(riskFreeRate * 100).toFixed(2)}
                onChange={(e) =>
                  dispatch({ type: 'SET_RISK_FREE_RATE', rate: Number(e.target.value) / 100 })
                }
                className="focus-ring w-24 rounded border border-border bg-bg px-2 py-1 text-ui-sm font-mono text-gray-300"
                min={0}
                max={20}
                step={0.1}
                aria-label="Risk-free rate in percent"
              />
              <span className="text-ui-sm font-mono text-muted">% p.a.</span>
            </div>
            <div className="mt-1 text-ui-xs font-mono text-muted">
              ECB deposit rate ~2.5% · short-term EUR yields ~3.5%
            </div>
          </FieldRow>

          <FieldRow label="AUM Floor (ETFs)">
            <div className="flex items-center gap-2">
              <span className="text-ui-sm font-mono text-muted">EUR</span>
              <input
                type="number"
                value={aumFloor / 1_000_000}
                onChange={(e) =>
                  dispatch({ type: 'SET_AUM_FLOOR', floor: Number(e.target.value) * 1_000_000 })
                }
                className="focus-ring w-32 rounded border border-border bg-bg px-2 py-1 text-ui-sm font-mono text-gray-300"
                min={0}
                step={10}
                aria-label="AUM floor in millions"
              />
              <span className="text-ui-sm font-mono text-muted">M</span>
            </div>
          </FieldRow>
        </ModalShell>
      )}
    </>
  )
}

function WeightSlider({
  label,
  value,
  effective,
  onChange,
}: {
  label: string
  value: number
  effective: string
  onChange: (v: number) => void
}) {
  return (
    <div className="mb-2 flex items-center gap-3">
      <span className="w-6 text-ui-sm font-mono text-muted">{label}</span>
      <input
        type="range"
        min={0}
        max={10}
        step={0.5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 flex-1 accent-blue-500"
      />
      <span className="w-10 text-right text-ui-sm font-mono text-gray-300">{effective}</span>
    </div>
  )
}
