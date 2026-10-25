import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from './cx'

export type SegmentTone = 'brand' | 'ok' | 'navy' | 'transfer' | 'danger'

const selectedTone: Record<SegmentTone, string> = {
  brand: 'bg-brand text-white',
  ok: 'bg-ok text-white',
  navy: 'bg-navy text-white',
  transfer: 'bg-transfer text-white',
  danger: 'bg-danger text-white',
}

export interface Segment<V extends string> {
  value: V
  label: string
  icon?: ReactNode
  /** Tanlangan bo'lak rangi (masalan, kirim — ok, chiqim — brand). */
  tone?: SegmentTone
}

/**
 * Bo'lakli almashtirgich: tugmalar guruhi (`aria-pressed`). Klaviatura: ←/→ (va ↑/↓), Home/End —
 * keyingi bo'lakka o'tadi va tanlaydi; guruhga Tab bilan bitta to'xtash (roving tabindex).
 */
export function SegmentedControl<V extends string>({
  label,
  value,
  onChange,
  options,
  size = 'md',
  className,
}: {
  label: string
  value: V
  onChange: (value: V) => void
  options: readonly Segment<V>[]
  size?: 'md' | 'lg'
  className?: string
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const current = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  )

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % options.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + options.length) % options.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = options.length - 1
    else return
    e.preventDefault()
    const opt = options[next]
    if (!opt) return
    onChange(opt.value)
    refs.current[next]?.focus()
  }

  return (
    <div
      role="group"
      aria-label={label}
      className={cx('grid gap-1 rounded-2xl border border-line bg-canvas p-1', className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o, i) => {
        const selected = o.value === value
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            aria-pressed={selected}
            tabIndex={i === current ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={cx(
              'inline-flex items-center justify-center gap-2 rounded-xl px-3 font-semibold transition-colors [&>svg]:size-5',
              size === 'lg' ? 'min-h-13 text-base' : 'min-h-11 text-sm',
              selected ? selectedTone[o.tone ?? 'brand'] : 'text-muted hover:bg-paper hover:text-ink',
            )}
          >
            {o.icon}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
