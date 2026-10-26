// Smeta sahifalari uchun kichik UI bo'laklari.
import type { ReactNode } from 'react'
import { Checkbox as Box } from '@/components/ui'

export function Checkbox({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  hint?: string
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-ink">
      <Box checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  )
}

/** Raqamli kartochka (tekshirish bosqichi). */
export function Stat({ label, value, tone = 'neutral' }: { label: string; value: ReactNode; tone?: 'neutral' | 'warn' | 'danger' | 'ok' }) {
  const tones = {
    neutral: 'text-ink',
    warn: 'text-warn',
    danger: 'text-danger',
    ok: 'text-ok',
  }
  return (
    <div className="rounded-xl border border-line bg-paper p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className={`tabular mt-1 text-2xl leading-tight font-semibold ${tones[tone]}`}>{value}</p>
    </div>
  )
}
