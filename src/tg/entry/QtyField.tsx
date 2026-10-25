import { useId } from 'react'
import type { DraftErrorCode } from '@/domain/movements'
import { t } from '@/i18n'
import { bigInputClass } from './styles'

/** Katta miqdor maydoni (Mini App formalari uchun umumiy). */
export function QtyField({
  label,
  value,
  error,
  onChange,
}: {
  label: string
  value: string
  error?: DraftErrorCode
  onChange: (v: string) => void
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        placeholder="0"
        value={value}
        aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
        className={bigInputClass(Boolean(error))}
      />
      {error && <p className="text-sm text-danger">{t.tg.movement.errors.qty[error]}</p>}
    </div>
  )
}

/** Ixtiyoriy izoh maydoni. */
export function NoteField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string
  value: string
  placeholder?: string
  onChange: (v: string) => void
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <textarea
        id={id}
        rows={2}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 rounded-xl border border-line bg-paper px-3 py-2 text-base outline-none placeholder:text-muted/70 focus:border-brand focus:ring-3 focus:ring-brand/15"
      />
    </div>
  )
}

/** Tanlangan material sarlavhasi va "O'zgartirish". */
export function MaterialHeader({ name, onChange }: { name: string; onChange: () => void }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-2">
      <p className="min-w-0 text-xl leading-tight font-semibold text-ink">{name}</p>
      <button type="button" onClick={onChange} className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-semibold text-brand hover:bg-ice">
        {t.tg.movement.change}
      </button>
    </div>
  )
}
