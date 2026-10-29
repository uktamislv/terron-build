import { useId, type ReactNode, type Ref } from 'react'
import { inputClass, TextAreaField } from '@/components/ui'
import type { DraftErrorCode } from '@/domain/movements'
import { t } from '@/i18n'
import { qtyAmbiguityHint } from './qtyHint'

/**
 * Katta raqam maydoni (miqdor, summa): 40 px qalin raqam, o'ngda ichida birlik ("kg", "so'm").
 * Ochilganda fokus (klaviatura darhol chiqadi), klaviaturada "Tayyor" (enterKeyHint="done") yoki —
 * `onEnter` berilsa — "Keyingi" (enterKeyHint="next": keyingi maydonga o'tadi).
 * Xato — `aria-describedby` + role="alert". `hint` — maydon ostidagi tasdiq qatori (masalan "1,5 kg …").
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
  hint,
  onEnter,
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
  /** Maydon ostidagi izoh (xato bo'lmaganda). */
  hint?: ReactNode
  /** Klaviaturadagi "Keyingi" — keyingi maydonga o'tish (berilmasa — "Tayyor", klaviatura yopiladi). */
  onEnter?: () => void
}) {
  const autoId = useId()
  const id = idProp ?? autoId
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
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
          enterKeyHint={onEnter ? 'next' : 'done'}
          autoComplete="off"
          // Forma ochilganda darhol klaviatura (3–4 bosish qoidasi)
          autoFocus={autoFocus}
          placeholder="0"
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            // "Keyingi" — keyingi maydon; "Tayyor" — klaviaturani yopish (MainButton ko'rinadi)
            if (onEnter) {
              e.preventDefault()
              onEnter()
            } else e.currentTarget.blur()
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
      {!error && hint && (
        <p id={hintId} data-testid="qty-hint" className="tabular text-sm font-medium text-warn">
          {hint}
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
      hint={qtyAmbiguityHint(value, suffix)}
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

/** Tanlangan material sarlavhasi va "O'zgartirish". `badge` — nom yonida (masalan "Kirim" / "Chiqim"). */
export function MaterialHeader({ name, onChange, badge }: { name: string; onChange: () => void; badge?: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-2">
      <div className="flex min-w-0 flex-col items-start gap-1">
        {badge}
        <p className="min-w-0 text-xl leading-tight font-semibold break-words text-ink">{name}</p>
      </div>
      <button type="button" onClick={onChange} className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-semibold text-brand hover:bg-ice">
        {t.tg.movement.change}
      </button>
    </div>
  )
}
