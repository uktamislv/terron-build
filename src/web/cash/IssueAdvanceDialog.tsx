import { useId, useState, type FormEvent } from 'react'
import { Button, Modal, Notice, TextField } from '@/components/ui'
import { issueAdvance } from '@/data/cashRepo'
import type { CashAdvance, Profile } from '@/data/types'
import { formatSumInput, parseSumInput } from '@/domain/cash'
import { cmp } from '@/domain/decimal'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatSum } from '@/lib/format'
import { uuid } from '@/lib/uuid'
import { SelectField } from '../fields'
import { issuedAtIso, todayTashkent } from './cashDates'

const tc = t.cash

/** "Pul berish": kimga, summa, sana, izoh. Idempotent — dialog davomida bitta id. */
export function IssueAdvanceDialog({
  companyId,
  recipients,
  initial,
  onClose,
  onIssued,
  onStale,
}: {
  companyId: string
  recipients: Profile[]
  /** "O'chirish va qayta berish" — oldingi yozuv qiymatlari bilan. */
  initial?: { recipientId: string; amount: string; note?: string | null }
  onClose: () => void
  onIssued: (advance: CashAdvance) => void
  /** Avvalgi urinish boshqa qiymatlar bilan saqlangan — ro'yxatni yangilash uchun. */
  onStale?: () => void
}) {
  // Idempotentlik kaliti: qayta urinishda shu id; "Yangi yozuv sifatida berish" — yangi id
  const [id, setId] = useState(() => uuid())
  const [today] = useState(todayTashkent)
  const [recipientId, setRecipientId] = useState(
    initial?.recipientId ?? (recipients.length === 1 ? (recipients[0]?.id ?? '') : ''),
  )
  const [amount, setAmount] = useState(initial ? formatSumInput(initial.amount.replace('.', ',')) : '')
  const [mismatch, setMismatch] = useState<CashAdvance | null>(null)
  const [date, setDate] = useState(today)
  const [note, setNote] = useState(initial?.note ?? '')
  const [errors, setErrors] = useState<{ recipient?: boolean; amount?: boolean; date?: boolean }>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const noteId = useId()

  const submit = async (e: FormEvent | null, attemptId: string = id) => {
    e?.preventDefault()
    if (busy) return
    setMismatch(null)
    const value = parseSumInput(amount)
    const issuedAt = issuedAtIso(date, today)
    const next = {
      recipient: !recipientId || undefined,
      amount: value === null || cmp(value, '0') <= 0 || undefined,
      date: issuedAt === undefined || undefined,
    }
    setErrors(next)
    if (next.recipient || next.amount || next.date || value === null || issuedAt === undefined) return
    setBusy(true)
    setError(null)
    try {
      const saved = await issueAdvance({ id: attemptId, companyId, recipientId, amount: value, issuedAt, note })
      // 23505 (shu id avval saqlangan) — qaytgan qator kiritilganidan farq qilishi mumkin
      if (saved.recipient_id !== recipientId || cmp(saved.amount, value) !== 0) {
        setMismatch(saved)
        onStale?.()
        return
      }
      onIssued(saved)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={tc.issueTitle} onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)} noValidate>
        <div className="flex flex-col gap-1">
          <SelectField label={tc.recipient} value={recipientId} onChange={setRecipientId}>
            <option value="">{tc.chooseRecipient}</option>
            {recipients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name} · {t.roles[p.role]}
              </option>
            ))}
          </SelectField>
          {errors.recipient && <p className="text-xs text-danger">{tc.errRecipient}</p>}
        </div>
        <TextField
          label={tc.amount}
          inputMode="numeric"
          autoComplete="off"
          value={amount}
          error={errors.amount ? tc.errAmount : null}
          onChange={(e) => setAmount(formatSumInput(e.target.value))}
        />
        <TextField
          label={tc.issuedAt}
          type="date"
          value={date}
          max={today}
          error={errors.date ? tc.errDate : null}
          onChange={(e) => setDate(e.target.value)}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={noteId} className="text-sm font-medium text-slate-700">
            {tc.note}
          </label>
          <textarea
            id={noteId}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="min-h-11 rounded-xl border border-slate-300 px-3 py-2 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </div>
        <p className="text-xs text-slate-500">{tc.amountLockedHint}</p>
        {error && <Notice>{error}</Notice>}
        {mismatch && (
          <div role="alert" className="flex flex-col gap-2 rounded-xl border border-warn/30 bg-warn/5 p-3">
            <p className="text-sm text-warn">
              {tc.previousDiffers(formatSum(mismatch.amount), mismatch.recipient_name ?? '')}
            </p>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                const next = uuid()
                setId(next)
                void submit(null, next)
              }}
            >
              {tc.sendAsNew}
            </Button>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? t.common.saving : tc.issue}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
