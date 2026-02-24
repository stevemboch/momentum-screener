import { useState } from 'react'
import { Settings, X } from 'lucide-react'
import { useAppState } from '../store'
import type { MomentumWeights } from '../types'

export function SettingsPanel() {
  const [open, setOpen] = useState(false)
  const { state, dispatch } = useAppState()
  const { weights, aumFloor } = state.settings

  const [localW1m, setLocalW1m] = useState(weights.w1m)
  const [localW3m, setLocalW3m] = useState(weights.w3m)
  const [localW6m, setLocalW6m] = useState(weights.w6m)

  const total = localW1m + localW3m + localW6m
  const norm = (v: number) => total > 0 ? v / total : 1 / 3

  const applyWeights = () => {
    const w: MomentumWeights = {
      w1m: norm(localW1m),
      w3m: norm(localW3m),
      w6m: norm(localW6m),
    }
    dispatch({ type: 'SET_WEIGHTS', weights: w })
    setOpen(false)
  }

  const fmtW = (v: number) => `${(norm(v) * 100).toFixed(0)}%`

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-2 py-1.5 text-muted hover:text-gray-300 border border-border rounded text-xs font-mono transition-colors"
        title="Settings"
      >
        <Settings size={12} />
        Settings
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-surface border border-border rounded-lg w-[380px] p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-semibold text-gray-200 font-mono">Settings</h2>
              <button onClick={() => setOpen(false)} className="text-muted hover:text-gray-300">
                <X size={16} />
              </button>
            </div>

            {/* Momentum Weights */}
            <div className="mb-6">
              <div className="text-xs text-muted uppercase tracking-wider font-mono mb-3">
                Momentum Weights
                <span className="ml-2 text-[10px] normal-case">(auto-normalised)</span>
              </div>

              <WeightSlider
                label="1M" value={localW1m} effective={fmtW(localW1m)}
                onChange={setLocalW1m}
              />
              <WeightSlider
                label="3M" value={localW3m} effective={fmtW(localW3m)}
                onChange={setLocalW3m}
              />
              <WeightSlider
                label="6M" value={localW6m} effective={fmtW(localW6m)}
                onChange={setLocalW6m}
              />

              <div className="text-[10px] text-muted font-mono mt-1">
                Effective: {fmtW(localW1m)} / {fmtW(localW3m)} / {fmtW(localW6m)}
              </div>
            </div>

            {/* AUM Floor */}
            <div className="mb-6">
              <div className="text-xs text-muted uppercase tracking-wider font-mono mb-2">
                AUM Floor (ETFs)
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted text-xs font-mono">€</span>
                <input
                  type="number"
                  value={aumFloor / 1_000_000}
                  onChange={(e) =>
                    dispatch({ type: 'SET_AUM_FLOOR', floor: Number(e.target.value) * 1_000_000 })
                  }
                  className="w-32 bg-bg border border-border rounded px-2 py-1 text-xs font-mono text-gray-300 outline-none focus:border-accent"
                  min={0}
                  step={10}
                />
                <span className="text-muted text-xs font-mono">M</span>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                className="px-3 py-1.5 text-xs font-mono text-muted hover:text-gray-300 border border-border rounded"
              >
                Cancel
              </button>
              <button
                onClick={applyWeights}
                className="px-3 py-1.5 text-xs font-mono text-accent bg-accent/10 border border-accent/30 rounded hover:bg-accent/20"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function WeightSlider({
  label, value, effective, onChange
}: {
  label: string; value: number; effective: string; onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-3 mb-2">
      <span className="text-xs font-mono text-muted w-4">{label}</span>
      <input
        type="range" min={0} max={10} step={0.5} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-blue-500 h-1"
      />
      <span className="text-xs font-mono text-gray-300 w-8 text-right">{effective}</span>
    </div>
  )
}
