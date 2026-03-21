import type { ReactNode } from 'react'

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'muted'

export function StatusBadge({
  tone,
  children,
  title,
  className = '',
}: {
  tone: StatusTone
  children: ReactNode
  title?: string
  className?: string
}) {
  const toneClass: Record<StatusTone, string> = {
    success: 'status-success',
    warning: 'status-warning',
    danger: 'status-danger',
    info: 'status-info',
    muted: 'status-muted',
  }

  return (
    <span className={`status-badge ${toneClass[tone]} ${className}`.trim()} title={title}>
      {children}
    </span>
  )
}
