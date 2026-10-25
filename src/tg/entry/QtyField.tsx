import { useId } from 'react'
import type { DraftErrorCode } from '@/domain/movements'
import { t } from '@/i18n'

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
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
        className={`min-h-14 rounded-xl border px-4 text-2xl font-semibold outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 ${
          error ? 'border-danger' : 'border-slate-300'
        }`}
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
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      <textarea
        id={id}
        rows={2}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 rounded-xl border border-slate-300 px-3 py-2 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
    </div>
  )
}

/** "Material · O'zgartirish" sarlavhasi. */
export function MaterialHeader({ name, onChange }: { name: string; onChange: () => void }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-2">
      <p className="text-lg font-semibold text-slate-900">{name}</p>
      <button type="button" onClick={onChange} className="min-h-11 px-2 text-sm font-medium text-brand">
        {t.tg.movement.change}
      </button>
    </div>
  )
}
