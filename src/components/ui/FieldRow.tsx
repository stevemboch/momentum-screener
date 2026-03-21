import type { ReactNode } from 'react'

export function FieldRow({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-ui-xs font-mono uppercase tracking-wider text-muted">{label}</span>
        {hint ? <span className="text-ui-xs font-mono text-muted/80">({hint})</span> : null}
      </div>
      {children}
    </div>
  )
}
