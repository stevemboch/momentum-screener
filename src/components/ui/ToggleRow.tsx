export function ToggleRow({
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
    <div className="mb-2 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="truncate text-ui-sm font-mono text-gray-300">{label}</div>
        {hint ? <div className="mt-0.5 text-ui-xs font-mono text-muted">{hint}</div> : null}
      </div>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={active}
        aria-label={`${label}: ${active ? 'enabled' : 'disabled'}`}
        className={`focus-ring inline-flex items-center rounded-full border px-2 py-1 transition-colors ${
          active
            ? 'border-green-400/40 bg-green-400/10 text-green-400'
            : 'border-border text-muted hover:text-gray-300'
        }`}
      >
        <span
          className={`relative inline-flex h-3.5 w-7 rounded-full transition-colors ${
            active ? 'bg-green-400' : 'border border-border bg-surface2'
          }`}
        >
          <span
            className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white shadow transition-transform ${
              active ? 'translate-x-3.5' : 'translate-x-0.5'
            }`}
          />
        </span>
      </button>
    </div>
  )
}
