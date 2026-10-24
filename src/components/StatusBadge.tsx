import type { ReactNode } from 'react'

type Tone = 'ok' | 'warn' | 'danger'

const tones: Record<Tone, string> = {
  ok: 'bg-ok/10 text-ok',
  warn: 'bg-warn/10 text-warn',
  danger: 'bg-danger/10 text-danger',
}

export function StatusBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${tones[tone]}`}>{children}</span>
}
