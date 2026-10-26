import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { chipClass } from './chipClass'
import { cx } from './cx'

/**
 * Filtr chipi: "Obyekt: Hammasi ▾". `onClear` berilsa va `active` — o'ngda "×" (alohida tugma).
 */
export function Chip({
  active = false,
  label,
  value,
  icon,
  caret = true,
  onClear,
  clearLabel,
  className,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'value'> & {
  active?: boolean
  label: string
  /** Tanlangan qiymat matni ("Hammasi", "Obyekt A"). */
  value?: ReactNode
  icon?: ReactNode
  caret?: boolean
  onClear?: () => void
  clearLabel?: string
}) {
  const main = (
    <button type="button" className={cx(chipClass(active), onClear && active && 'rounded-r-none border-r-0 pr-2', className)} {...props}>
      {icon}
      <span className={cx(value !== undefined && 'text-muted', active && 'text-brand')}>
        {label}
        {value !== undefined && ':'}
      </span>
      {value !== undefined && <span className="max-w-40 truncate font-semibold">{value}</span>}
      {caret && <ChevronDown aria-hidden className="size-4 opacity-70" strokeWidth={1.75} />}
    </button>
  )
  if (!(onClear && active)) return main
  return (
    <span className="inline-flex shrink-0">
      {main}
      <button
        type="button"
        aria-label={clearLabel ?? label}
        onClick={onClear}
        className="inline-flex min-h-11 items-center rounded-r-full border border-l-0 border-brand bg-ice pr-3 pl-1 text-brand hover:bg-ice-hover"
      >
        <X aria-hidden className="size-4" strokeWidth={2} />
      </button>
    </span>
  )
}
