// Xarajatni tuzatish (RPC `correct_entry('expenses', …)`): summa, obyekt (faqat muallif), izoh va majburiy sabab.
// Veb (admin — istalgan vaqtda; muallif — 30 daqiqa) va Telegram ilovasi uchun umumiy. Tekshiruv —
// `validateExpenseCorrection` (src/domain/expenses.ts).
import { useEffect, useState, type FormEvent } from 'react'
import { Button, Notice, SelectField, TextAreaField, TextField } from '@/components/ui'
import { correctEntry, CORRECTION_NOTE_MAX } from '@/data/correctionsRepo'
import { listObjects } from '@/data/objectsRepo'
import type { Expense, ObjectRow } from '@/data/types'
import { formatSumInput } from '@/domain/cash'
import { validateExpenseCorrection } from '@/domain/expenses'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'

const tc = t.correction
const te = t.expenses

export type ExpenseCorrectionTarget = Pick<Expense, 'id' | 'amount' | 'note' | 'object_id' | 'object_name' | 'category_name'>

export function ExpenseCorrectionForm({
  target,
  onDone,
  onCancel,
  remaining,
  allowMove = false,
  size = 'md',
}: {
  target: ExpenseCorrectionTarget
  onDone: () => void
  onCancel: () => void
  /** Muallif uchun qolgan butun daqiqalar; admin — yo'q. */
  remaining?: number | null
  /** Muallif (30 daqiqa): obyektni ham almashtira oladi. */
  allowMove?: boolean
  /** Tugmalar: md — veb, lg — Telegram ilovasi. */
  size?: 'md' | 'lg'
}) {
  const [amount, setAmount] = useState(() => formatSumInput(target.amount.replace('.', ',')))
  const [objectId, setObjectId] = useState<string>(target.object_id ?? '')
  const [note, setNote] = useState(target.note ?? '')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<{ amount?: 'required' | 'invalid'; reason?: 'required' }>({})
  const [objects, setObjects] = useState<ObjectRow[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!allowMove) return
    let alive = true
    Promise.resolve()
      .then(() => listObjects())
      .then((list) => alive && Array.isArray(list) && setObjects(list.filter((o) => o.status === 'faol' || o.id === target.object_id)))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [allowMove, target.object_id])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return
    const result = validateExpenseCorrection({
      original: { amount: target.amount, note: target.note, objectId: target.object_id },
      amountInput: amount,
      objectId: allowMove && objectId ? objectId : null,
      note,
      reason,
    })
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      await correctEntry({
        table: 'expenses',
        id: target.id,
        qtyInput: null,
        unitId: null,
        totalAmount: result.value.totalAmount,
        reason: result.value.reason,
        note: result.value.note,
        objectId: result.value.objectId,
      })
      onDone()
    } catch (err) {
      setSaveError(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" aria-label={tc.title} data-testid="expense-correction">
      <p className="text-sm text-muted">{allowMove ? te.correctIntro : te.correctIntroAdmin}</p>
      {target.category_name && <p className="text-base font-semibold text-ink">{target.category_name}</p>}
      {remaining != null && (
        <Notice tone="info">
          <span data-testid="correction-remaining">{tc.remaining(remaining)}</span>
        </Notice>
      )}
      <TextField
        label={te.amount}
        inputMode="numeric"
        autoComplete="off"
        value={amount}
        suffix={t.ui.sum}
        error={errors.amount ? (errors.amount === 'required' ? te.errors.amountRequired : te.errors.amountInvalid) : null}
        onChange={(e) => {
          setAmount(formatSumInput(e.target.value))
          setErrors((er) => ({ ...er, amount: undefined }))
        }}
      />
      {allowMove && (
        <SelectField label={te.object} hint={te.correctObjectHint} value={objectId} onChange={setObjectId}>
          {/* "Umumiy" — faqat hozir obyektsiz bo'lsa (obyektdan "Umumiy" ga qaytarib bo'lmaydi) */}
          {!target.object_id && <option value="">{te.general}</option>}
          {target.object_id && !objects.some((o) => o.id === target.object_id) && (
            <option value={target.object_id}>{target.object_name ?? te.object}</option>
          )}
          {objects.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </SelectField>
      )}
      <TextAreaField
        label={tc.reason}
        required
        aria-required="true"
        rows={2}
        maxLength={CORRECTION_NOTE_MAX}
        placeholder={tc.reasonPlaceholder}
        value={reason}
        hint={tc.reasonHint}
        error={errors.reason ? tc.errReason : null}
        onChange={(e) => {
          setReason(e.target.value)
          setErrors((er) => ({ ...er, reason: undefined }))
        }}
      />
      <TextAreaField label={tc.note} rows={2} maxLength={CORRECTION_NOTE_MAX} value={note} hint={tc.noteHint} onChange={(e) => setNote(e.target.value)} />
      {saveError && <Notice>{saveError}</Notice>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" size={size} onClick={onCancel}>
          {t.common.cancel}
        </Button>
        <Button type="submit" size={size} loading={saving} disabled={saving}>
          {saving ? t.common.saving : tc.save}
        </Button>
      </div>
    </form>
  )
}
