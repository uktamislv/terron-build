import type { ReactNode } from 'react'

export type BadgeTone = 'ok' | 'warn' | 'danger' | 'neutral' | 'info'

const tones: Record<BadgeTone, string> = {
  ok: 'bg-ok/10 text-ok',
  warn: 'bg-warn/10 text-warn',
  danger: 'bg-danger/10 text-danger',
  neutral: 'bg-slate-100 text-slate-700',
  info: 'bg-brand-light text-brand-dark',
}

export function StatusBadge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span data-tone={tone} className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  )
}
