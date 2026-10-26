// Forma maydonlari: yorliq har doim ko'rinadi, 16 px matn (iOS kattalashtirmasin), 44 px balandlik.
// Uslub — yagona `inputClass` (./inputClass.ts).
import { useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { t } from '@/i18n'
import { isoDateToDisplay, maskDateInput, parseDisplayDate } from '@/lib/format'
import { cx } from './cx'
import { inputClass } from './inputClass'

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
    <p id={id} role={error ? 'alert' : undefined} className={cx('text-xs', error ? 'text-danger' : 'text-muted')}>
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
  const autoId = useId()
  const id = props.id ?? autoId
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-desc` : undefined}
        className={inputClass({ error: Boolean(error) })}
        {...props}
      />
      <Help id={`${id}-desc`} error={error} hint={hint} />
    </div>
  )
}

/** Ko'p qatorli matn (izoh, sabab). */
export function TextAreaField({
  label,
  error,
  hint,
  className = '',
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string | null; hint?: string }) {
  const autoId = useId()
  const id = props.id ?? autoId
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      <textarea
        id={id}
        rows={2}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-desc` : undefined}
        className={inputClass({ error: Boolean(error), multiline: true })}
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
          className={cx(inputClass(), 'appearance-none pr-10')}
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

type DateInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type' | 'min' | 'max'> & {
  /** ISO `yyyy-mm-dd` yoki ''. */
  value: string
  onChange: (iso: string) => void
  /** ISO chegaralar (ixtiyoriy). */
  min?: string
  max?: string
  /** Xato holati o'zgarganda (masalan, tashqi xabar uchun). */
  onInvalidChange?: (message: string | null) => void
}

/** Sana xatosi: noto'g'ri yoki chegaradan tashqari — matn, aks holda null. */
function dateError(text: string, min?: string, max?: string): string | null {
  if (text === '') return null
  const iso = parseDisplayDate(text)
  if (!iso) return t.ui.dateInvalid
  if ((min && iso < min) || (max && iso > max)) return t.ui.dateOutOfRange
  return null
}

/**
 * Niqobli sana maydoni (yorliqsiz): `dd.mm.yyyy`, raqam klaviaturasi, nuqtalar o'zi qo'yiladi.
 * Ichkarida qiymat doim ISO: to'liq va to'g'ri sana kiritilganda yoki maydon tozalanganda `onChange`.
 * Noto'g'ri sana — maydondan chiqqanda xato (onChange('')).
 */
export function DateInput({ value, onChange, min, max, onInvalidChange, className, onBlur, ...rest }: DateInputProps) {
  const [text, setText] = useState(() => isoDateToDisplay(value))
  const [shown, setShown] = useState(value)
  // Tashqaridan o'zgarsa (Tozalash, boshlang'ich qiymat) — matn ham yangilanadi
  if (value !== shown) {
    setShown(value)
    if (parseDisplayDate(text) !== value) setText(isoDateToDisplay(value))
  }

  const emit = (iso: string) => {
    setShown(iso)
    onChange(iso)
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder={t.ui.dateFormatHint}
      maxLength={10}
      value={text}
      className={className}
      onChange={(e) => {
        const raw = e.target.value
        // ISO qiymat (nusxa qo'yish) — to'g'ridan-to'g'ri
        const next = /^\d{4}-\d{2}-\d{2}$/.test(raw.trim()) ? isoDateToDisplay(raw.trim()) : maskDateInput(raw)
        setText(next)
        if (next === '') {
          onInvalidChange?.(null)
          emit('')
          return
        }
        if (next.length === 10) {
          const err = dateError(next, min, max)
          onInvalidChange?.(err)
          if (!err) emit(parseDisplayDate(next) ?? '')
        }
      }}
      onBlur={(e) => {
        const err = dateError(text, min, max)
        onInvalidChange?.(err)
        if (err && value !== '') emit('')
        onBlur?.(e)
      }}
      {...rest}
    />
  )
}

export function DateField({
  label,
  value,
  onChange,
  className,
  error,
  hint,
  ...rest
}: Omit<DateInputProps, 'onInvalidChange'> & {
  label: string
  error?: string | null
  hint?: string
}) {
  const id = useId()
  const [invalid, setInvalid] = useState<string | null>(null)
  const shownError = error || invalid
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      <DateInput
        id={id}
        value={value}
        onChange={onChange}
        onInvalidChange={setInvalid}
        aria-invalid={shownError ? true : undefined}
        aria-describedby={`${id}-desc`}
        className={cx(inputClass({ error: Boolean(shownError) }), 'tabular')}
        {...rest}
      />
      <Help id={`${id}-desc`} error={shownError} hint={hint ?? t.ui.dateFormatHint} />
    </div>
  )
}
