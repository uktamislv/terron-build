// Forma maydonlari: yorliq har doim ko'rinadi, 16 px matn (iOS kattalashtirmasin), 44 px balandlik.
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cx } from './cx'

const control =
  'min-h-11 w-full rounded-xl border bg-paper px-3 text-base text-ink placeholder:text-muted/70 outline-none transition-colors focus:border-brand focus:ring-3 focus:ring-brand/15 disabled:bg-canvas disabled:text-muted'

function Label({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
      {children}
    </label>
  )
}

function Help({ id, error, hint }: { id: string; error?: string | null; hint?: ReactNode }) {
  if (!error && !hint) return null
  return (
    <p id={id} className={cx('text-xs', error ? 'text-danger' : 'text-muted')}>
      {error || hint}
    </p>
  )
}

export function TextField({
  label,
  error,
  hint,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | null; hint?: string }) {
  const id = useId()
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-desc` : undefined}
        className={cx(control, error ? 'border-danger' : 'border-line')}
        {...props}
      />
      <Help id={`${id}-desc`} error={error} hint={hint} />
    </div>
  )
}

export function SelectField({
  label,
  value,
  onChange,
  children,
  className,
  hint,
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> & {
  label: string
  value: string
  onChange: (v: string) => void
  children: ReactNode
  hint?: string
}) {
  const id = useId()
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={hint ? `${id}-desc` : undefined}
          className={cx(control, 'appearance-none border-line pr-10')}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-5 -translate-y-1/2 text-muted" strokeWidth={1.75} />
      </div>
      <Help id={`${id}-desc`} hint={hint} />
    </div>
  )
}

export function DateField({
  label,
  value,
  onChange,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> & {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  const id = useId()
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      <input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} className={cx(control, 'border-line')} {...rest} />
    </div>
  )
}
