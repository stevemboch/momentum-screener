import { ChevronDown, ChevronUp } from 'lucide-react'
import type { ReactNode } from 'react'

export function PanelShell({
  title,
  subtitle,
  actions,
  collapsible = false,
  open = true,
  onToggle,
  children,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
  collapsible?: boolean
  open?: boolean
  onToggle?: () => void
  children?: ReactNode
}) {
  const header = (
    <>
      <div className="min-w-0">
        <div className="panel-title">{title}</div>
        {subtitle ? <div className="panel-subtitle mt-0.5">{subtitle}</div> : null}
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        {actions}
        {collapsible ? (
          <span className="text-muted" aria-hidden>
            {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </span>
        ) : null}
      </div>
    </>
  )

  return (
    <section className="panel-shell overflow-hidden">
      {collapsible ? (
        <button
          type="button"
          className="panel-header w-full text-left focus-ring"
          onClick={onToggle}
          aria-expanded={open}
        >
          {header}
        </button>
      ) : (
        <div className="panel-header">{header}</div>
      )}
      {(!collapsible || open) && <div className="p-3">{children}</div>}
    </section>
  )
}
