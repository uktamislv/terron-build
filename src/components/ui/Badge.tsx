import type { ReactNode } from 'react'
import { cx } from './cx'

export type BadgeTone = 'ok' | 'warn' | 'danger' | 'neutral' | 'info'

const tones: Record<BadgeTone, string> = {
  ok: 'bg-ok-bg text-ok',
  warn: 'bg-warn-bg text-warn',
  danger: 'bg-danger-bg text-danger',
  neutral: 'bg-canvas text-muted ring-1 ring-inset ring-line',
  info: 'bg-ice text-navy',
}

/** Holat belgisi (radius 8). `icon` — ixtiyoriy Lucide belgi (14 px). */
export function Badge({ tone, icon, children, className }: { tone: BadgeTone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span
      data-tone={tone}
      className={cx('inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-semibold whitespace-nowrap [&>svg]:size-3.5', tones[tone], className)}
    >
      {icon}
      {children}
    </span>
  )
}

/** Eski nom (holat belgisi). */
export const StatusBadge = Badge
