import { t } from '@/i18n'
import { formatQty, formatSumNumber } from '@/lib/format'
import { cx } from './cx'

export type QtySize = 'sm' | 'md' | 'lg' | 'hero'

const numSize: Record<QtySize, string> = {
  sm: 'text-sm font-semibold',
  md: 'text-base font-semibold',
  lg: 'text-xl font-semibold',
  hero: 'text-hero leading-none font-bold',
}

const unitSize: Record<QtySize, string> = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-sm',
  hero: 'text-lg font-medium',
}

/**
 * "Yuk xati" raqami: katta tabular raqam + kichik kulrang birlik ("150 kg").
 * `value` — tayyor satr yoki `numeric` (formatQty bilan formatlanadi).
 */
export function Qty({
  value,
  unit,
  size = 'md',
  tone,
  format = true,
  className,
}: {
  value: string | bigint
  unit?: string | null
  size?: QtySize
  /** danger — manfiy/kamomad, ok — joyida. */
  tone?: 'danger' | 'ok' | 'muted'
  /** false — `value` tayyor matn (formatlanmaydi). */
  format?: boolean
  className?: string
}) {
  const text = format ? formatQty(value) : String(value)
  return (
    <span
      className={cx(
        'tabular inline-flex flex-wrap items-baseline gap-x-1',
        tone === 'danger' ? 'text-danger' : tone === 'ok' ? 'text-ok' : tone === 'muted' ? 'text-muted' : 'text-ink',
        className,
      )}
    >
      <span className={cx('whitespace-nowrap', numSize[size])}>{text}</span>{unit ? ' ' : null}
      {unit ? <span className={cx(tone === 'danger' ? 'text-danger' : 'text-muted', unitSize[size])}>{unit}</span> : null}
    </span>
  )
}

/** Summa: raqam + "so'm" (birlik kabi kichik). Manfiy — qizil. */
export function Money({
  value,
  size = 'md',
  className,
  signTone = true,
  tone,
}: {
  value: string | bigint
  size?: QtySize
  className?: string
  /** true — manfiy summa qizil. */
  signTone?: boolean
  /** Rangni majburlash (masalan, musbat qoldiq — ok). */
  tone?: 'ok' | 'muted' | 'danger'
}) {
  const num = formatSumNumber(value)
  const unit = t.ui.sum
  const negative = String(value).trim().startsWith('-') && /[1-9]/.test(String(value))
  return (
    <span
      data-negative={negative || undefined}
      className={cx(
        'tabular inline-flex flex-wrap items-baseline gap-x-1',
        tone === 'ok' ? 'text-ok' : tone === 'muted' ? 'text-muted' : tone === 'danger' || (negative && signTone) ? 'text-danger' : 'text-ink',
        className,
      )}
    >
      <span className={cx('whitespace-nowrap', numSize[size])}>{num}</span>{' '}
      <span className={cx(negative && signTone ? 'text-danger' : 'text-muted', unitSize[size])}>{unit}</span>
    </span>
  )
}
