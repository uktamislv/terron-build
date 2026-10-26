import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from './cx'

export interface TabItem<K extends string> {
  key: K
  label: string
  icon?: ReactNode
  /** Kichik hisoblagich (masalan, yangi ogohlantirishlar). */
  count?: number
}

/** Sahifa ichidagi bo'limlar (role="tablist"). ←/→, Home/End bilan o'tish; telefonda gorizontal aylanadi. */
export function Tabs<K extends string>({
  label,
  items,
  value,
  onChange,
  className,
}: {
  label: string
  items: readonly TabItem<K>[]
  value: K
  onChange: (key: K) => void
  className?: string
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number
    if (e.key === 'ArrowRight') next = (index + 1) % items.length
    else if (e.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    else return
    e.preventDefault()
    const item = items[next]
    if (!item) return
    onChange(item.key)
    refs.current[next]?.focus()
  }
  return (
    <div role="tablist" aria-label={label} className={cx('no-scrollbar -mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 md:mx-0 md:px-0', className)}>
      {items.map((item, i) => {
        const selected = item.key === value
        return (
          <button
            key={item.key}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.key)}
            onKeyDown={(e) => onKey(e, i)}
            className={cx(
              'relative inline-flex min-h-11 shrink-0 items-center gap-2 px-3 text-sm font-semibold whitespace-nowrap transition-colors [&>svg]:size-5',
              selected ? 'text-brand' : 'text-muted hover:text-ink',
            )}
          >
            {item.icon}
            {item.label}
            {item.count ? (
              <span className="tabular rounded-full bg-danger px-1.5 text-xs leading-5 text-white">{item.count}</span>
            ) : null}
            <span aria-hidden className={cx('absolute inset-x-2 -bottom-px h-0.5 rounded-full', selected ? 'bg-brand' : 'bg-transparent')} />
          </button>
        )
      })}
    </div>
  )
}
