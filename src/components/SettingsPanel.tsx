import { useState } from 'react'
import { Settings, X } from 'lucide-react'
import { useAppState } from '../store'
import type { MomentumWeights } from '../types'

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
  const norm = (v: number) => total > 0 ? v / total : 1 / 3
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

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-2 py-1.5 text-muted hover:text-gray-300 border border-border rounded text-xs font-mono transition-colors"
      >
        <Settings size={12} />
        Settings
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-surface border border-border rounded-lg w-[420px] p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-semibold text-gray-200 font-mono">Settings</h2>
              <button onClick={() => setOpen(false)} className="text-muted hover:text-gray-300"><X size={16} /></button>
            </div>

            {/* Momentum Weights */}
            <Section label="Momentum Weights" hint="auto-normalised">
              <WeightSlider label="1M" value={raw.w1m} effective={fmtW(raw.w1m)} onChange={(v) => updateWeight('w1m', v)} />
              <WeightSlider label="3M" value={raw.w3m} effective={fmtW(raw.w3m)} onChange={(v) => updateWeight('w3m', v)} />
              <WeightSlider label="6M" value={raw.w6m} effective={fmtW(raw.w6m)} onChange={(v) => updateWeight('w6m', v)} />
              <div className="text-[10px] text-muted font-mono mt-1">
                Effective: {fmtW(raw.w1m)} / {fmtW(raw.w3m)} / {fmtW(raw.w6m)}
              </div>
            </Section>

            {/* AUM Floor */}
            <Section label="AUM Floor (ETFs)">
              <div className="flex items-center gap-2">
                <span className="text-muted text-xs font-mono">€</span>
                <input
                  type="number"
                  value={aumFloor / 1_000_000}
                  onChange={(e) => dispatch({ type: 'SET_AUM_FLOOR', floor: Number(e.target.value) * 1_000_000 })}
                  className="w-32 bg-bg border border-border rounded px-2 py-1 text-xs font-mono text-gray-300 outline-none focus:border-accent"
                  min={0} step={10}
                />
                <span className="text-muted text-xs font-mono">M</span>
              </div>
            </Section>

            {/* Risk-Free Rate */}
            <Section label="Risk-Free Rate" hint="used for > Risk-Free filter">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={(riskFreeRate * 100).toFixed(2)}
                  onChange={(e) => dispatch({ type: 'SET_RISK_FREE_RATE', rate: Number(e.target.value) / 100 })}
                  className="w-24 bg-bg border border-border rounded px-2 py-1 text-xs font-mono text-gray-300 outline-none focus:border-accent"
                  min={0} max={20} step={0.1}
                />
                <span className="text-muted text-xs font-mono">% p.a.</span>
              </div>
              <div className="text-[10px] text-muted font-mono mt-1">
                ECB deposit rate ≈ 2.5% · Short-term EUR ≈ 3.5%
              </div>
            </Section>

            {/* Filters */}
            <Section label="Filters">
              <ToggleRow
                label="Deduplicated ETFs"
                hint="Hide non-winners in each dedup group"
                active={showDeduped}
                onToggle={() => dispatch({ type: 'SET_TABLE_STATE', updates: { showDeduped: !showDeduped } })}
              />
              <ToggleRow
                label="> Risk-Free"
                hint={`Hide instruments below ${(riskFreeRate * 100).toFixed(1)}% p.a. (annualised)`}
                active={filterBelowRiskFree}
                onToggle={() => dispatch({ type: 'SET_TABLE_STATE', updates: { filterBelowRiskFree: !filterBelowRiskFree } })}
              />
            </Section>

            {/* ATR Multiplier */}
            <Section label="Selling Threshold (ATR)" hint="Last Price − a × ATR(20)">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-muted w-4">a</span>
                <input
                  type="range" min={3} max={5} step={0.25} value={atrMultiplier}
                  onChange={(e) => dispatch({ type: 'SET_ATR_MULTIPLIER', multiplier: Number(e.target.value) })}
                  className="flex-1 accent-blue-500 h-1"
                />
                <span className="text-xs font-mono text-gray-300 w-8 text-right">{atrMultiplier.toFixed(2)}</span>
              </div>
              <div className="text-[10px] text-muted font-mono mt-1">
                3 = tight stop · 5 = wide stop · current: {atrMultiplier}× ATR(20)
              </div>
            </Section>

            <div className="flex justify-end gap-2 mt-2">
              <button onClick={() => setOpen(false)} className="px-3 py-1.5 text-xs font-mono text-muted hover:text-gray-300 border border-border rounded">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Section({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="text-xs text-muted uppercase tracking-wider font-mono mb-3">
        {label}
        {hint && <span className="ml-2 text-[10px] normal-case">({hint})</span>}
      </div>
      {children}
    </div>
  )
}

function WeightSlider({ label, value, effective, onChange }: { label: string; value: number; effective: string; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-3 mb-2">
      <span className="text-xs font-mono text-muted w-4">{label}</span>
      <input type="range" min={0} max={10} step={0.5} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-blue-500 h-1"
      />
      <span className="text-xs font-mono text-gray-300 w-8 text-right">{effective}</span>
    </div>
  )
}

function ToggleRow({
  label,
  hint,
  active,
  onToggle,
}: {
  label: string
  hint?: string
  active: boolean
  onToggle: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 mb-3">
      <div className="min-w-0">
        <div className="text-xs font-mono text-gray-300 truncate">{label}</div>
        {hint && <div className="text-[10px] text-muted font-mono mt-0.5">{hint}</div>}
      </div>
      <button
        onClick={onToggle}
        aria-pressed={active}
        className={`flex items-center px-2 py-1 text-xs font-mono rounded border transition-colors ${
          active
            ? 'bg-green-400/10 text-green-400 border-green-400/30'
            : 'text-muted border-border hover:text-gray-300'
        }`}
      >
        <span className={`relative inline-flex w-7 h-3.5 rounded-full transition-colors ${active ? 'bg-green-400' : 'bg-surface2 border border-border'}`}>
          <span className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow transition-transform ${active ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
        </span>
      </button>
    </div>
  )
}
