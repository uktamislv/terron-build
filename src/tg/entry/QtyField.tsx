import { useId, type Ref } from 'react'
import { inputClass, TextAreaField } from '@/components/ui'
import type { DraftErrorCode } from '@/domain/movements'
import { t } from '@/i18n'

/**
 * Katta raqam maydoni (miqdor, summa): 40 px qalin raqam, o'ngda ichida birlik ("kg", "so'm").
 * Ochilganda fokus (klaviatura darhol chiqadi), klaviaturada "Tayyor" (enterKeyHint="done").
 * Xato — `aria-describedby` + role="alert".
 */
export function BigNumberInput({
  id: idProp,
  label,
  value,
  onChange,
  error,
  suffix,
  autoFocus = true,
  inputMode = 'decimal',
  inputRef,
}: {
  id?: string
  label: string
  value: string
  /** `caret` — kursor joyi (summa formatlashda kursorni saqlash uchun). */
  onChange: (v: string, caret: number | null) => void
  inputRef?: Ref<HTMLInputElement>
  /** Xato matni (bo'sh — xato yo'q). */
  error?: string | null
  /** Maydon ichidagi birlik (qisqa). */
  suffix?: string | null
  autoFocus?: boolean
  inputMode?: 'decimal' | 'numeric'
}) {
  const autoId = useId()
  const id = idProp ?? autoId
  const errorId = `${id}-error`
  const unit = suffix?.trim() ?? ''
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          ref={inputRef}
          inputMode={inputMode}
          enterKeyHint="done"
          autoComplete="off"
          // Forma ochilganda darhol klaviatura (3–4 bosish qoidasi)
          autoFocus={autoFocus}
          placeholder="0"
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
          onKeyDown={(e) => {
            // "Tayyor" — klaviaturani yopish (MainButton ko'rinadi)
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          className={inputClass({ size: 'hero', error: Boolean(error) })}
          style={unit ? { paddingRight: `${Math.min(unit.length, 12) * 0.65 + 1.75}rem` } : undefined}
        />
        {unit && (
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-lg font-medium text-muted">
            {unit}
          </span>
        )}
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

/** Katta miqdor maydoni (Mini App formalari uchun umumiy). */
export function QtyField({
  label,
  value,
  error,
  suffix,
  autoFocus = true,
  onChange,
}: {
  label: string
  value: string
  error?: DraftErrorCode
  suffix?: string | null
  autoFocus?: boolean
  onChange: (v: string) => void
}) {
  return (
    <BigNumberInput
      label={label}
      value={value}
      onChange={onChange}
      suffix={suffix}
      autoFocus={autoFocus}
      error={error ? t.tg.movement.errors.qty[error] : null}
    />
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
  return <TextAreaField label={label} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
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
