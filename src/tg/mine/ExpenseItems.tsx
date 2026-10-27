// "Yozuvlar" — xarajat qatori va tafsiloti. Muallif 30 daqiqa ichida: "Tuzatish" (summa, obyekt, izoh, sabab)
// va "Bekor qilish" (cancel_own_entry). Oyna — `selfCorrection` (src/domain/corrections.ts).
import { useState } from 'react'
import { Camera, PencilLine, Receipt, Trash2 } from 'lucide-react'
import { MovementPhoto } from '@/components/MovementPhoto'
import { ExpenseCorrectionForm } from '@/components/corrections/ExpenseCorrectionForm'
import { Badge, BottomSheet, Button, DetailRows, EntryRow, Money } from '@/components/ui'
import { cancelOwnEntry, CORRECTION_NOTE_MAX } from '@/data/correctionsRepo'
import type { Expense } from '@/data/types'
import { remainingMinutes, selfCorrection, type CorrectableEntry } from '@/domain/corrections'
import { t } from '@/i18n'
import { formatDateTime, formatSum } from '@/lib/format'
import { haptic } from '../telegram'
import { BackLink } from '../ui'
import { ReasonForm } from './ReasonForm'

const tm = t.tg.mine
const te = t.expenses

function correctable(e: Expense): CorrectableEntry {
  return { table: 'expenses', createdBy: e.created_by, createdAt: e.created_at, deletedAt: e.deleted_at }
}

/** Xarajat mening nomimga boshqa odam (admin) tomonidan kiritilgan. */
function byOther(e: Expense, myId: string): boolean {
  return e.created_by !== null && e.created_by !== myId
}

export function ExpenseRow({ row, myId, nowIso, onOpen }: { row: Expense; myId: string; nowIso: string; onOpen: () => void }) {
  const fix = selfCorrection(correctable(row), myId, nowIso)
  return (
    <EntryRow
      as="li"
      testId="mine-expense"
      kind="xarid"
      icon={<Receipt className="size-5" strokeWidth={1.75} />}
      deleted={Boolean(row.deleted_at)}
      title={row.category_name ?? te.one}
      badge={
        <>
          {row.receipt_photo_path && <Camera role="img" aria-label={t.movements.hasPhoto} className="size-4 text-muted" strokeWidth={1.75} />}
          {row.deleted_at && <Badge tone="danger">{t.movements.deleted}</Badge>}
          {byOther(row, myId) && <Badge tone="info">{tm.enteredByOther}</Badge>}
          {fix.allowed && (
            <Badge tone="info" icon={<PencilLine aria-hidden strokeWidth={2} />}>
              {t.correction.remainingShort(remainingMinutes(fix.remainingMs))}
            </Badge>
          )}
        </>
      }
      meta={
        <>
          <span>
            <span className="font-medium text-ink">{te.one}</span>
            <span>{row.object_name ?? te.general}</span>
          </span>
          <span className="tabular">{formatDateTime(row.spent_at)}</span>
        </>
      }
      trailing={<Money value={row.amount} />}
      onClick={onOpen}
    />
  )
}

export function ExpenseDetail({
  row,
  myId,
  nowIso,
  onClose,
  onCorrected,
  onCancelled,
}: {
  row: Expense
  myId: string
  nowIso: string
  onClose: () => void
  onCorrected: () => void
  onCancelled: () => void
}) {
  const [correcting, setCorrecting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const fix = selfCorrection(correctable(row), myId, nowIso)
  return (
    <article className="flex flex-col gap-4" aria-label={tm.detail} data-testid="mine-expense-detail">
      <BackLink label={t.common.back} onClick={onClose} />
      <div className="flex items-center gap-3">
        <span aria-hidden className="inline-flex size-12 shrink-0 items-center justify-center rounded-xl bg-ice text-navy [&>svg]:size-6">
          <Receipt strokeWidth={1.75} />
        </span>
        <div className="flex flex-col items-start gap-1">
          <h2 className="text-xl font-semibold text-ink">{te.one}</h2>
          {row.deleted_at && <Badge tone="danger">{t.movements.deleted}</Badge>}
          {byOther(row, myId) && <Badge tone="info">{tm.enteredByOther}</Badge>}
        </div>
      </div>
      <div className="flex flex-col gap-1 rounded-xl border border-line bg-paper px-4 py-3">
        <span className="text-sm text-muted">{row.category_name}</span>
        <Money value={row.amount} size="hero" />
      </div>
      {fix.allowed && (
        <Button
          variant="secondary"
          size="lg"
          icon={<PencilLine aria-hidden className="size-5" strokeWidth={1.75} />}
          onClick={() => {
            haptic.tap()
            setCorrecting(true)
          }}
        >
          {t.correction.actionWithTime(remainingMinutes(fix.remainingMs))}
        </Button>
      )}
      {fix.allowed && (
        <Button
          variant="danger"
          size="lg"
          icon={<Trash2 aria-hidden className="size-5" strokeWidth={1.75} />}
          onClick={() => {
            haptic.tap()
            setCancelling(true)
          }}
        >
          {t.correction.cancelAction}
        </Button>
      )}
      <DetailRows
        className="rounded-xl border border-line bg-paper px-4"
        items={[
          { label: te.category, value: row.category_name },
          { label: tm.sum, value: <span className="tabular font-semibold">{formatSum(row.amount)}</span> },
          { label: tm.object, value: row.object_name ?? te.general },
          { label: te.paymentSource, value: t.purchases.paymentSources[row.payment_source] },
          row.supplier_name ? { label: tm.supplier, value: row.supplier_name } : null,
          { label: tm.time, value: <span className="tabular">{formatDateTime(row.spent_at)}</span> },
          row.note ? { label: t.movements.note, value: <span className="whitespace-pre-wrap">{row.note}</span> } : null,
        ]}
      />
      {row.receipt_photo_path ? <MovementPhoto path={row.receipt_photo_path} alt={te.receipt} /> : <p className="text-sm text-muted">{te.noReceipt}</p>}
      {correcting && (
        <BottomSheet title={t.correction.title} onClose={() => setCorrecting(false)}>
          <ExpenseCorrectionForm
            target={row}
            allowMove
            size="lg"
            remaining={remainingMinutes(fix.remainingMs)}
            onCancel={() => setCorrecting(false)}
            onDone={() => {
              setCorrecting(false)
              onCorrected()
            }}
          />
        </BottomSheet>
      )}
      {cancelling && (
        <BottomSheet title={t.correction.cancelTitle} onClose={() => setCancelling(false)}>
          <ReasonForm
            text={t.correction.cancelText}
            label={t.correction.cancelReason}
            requiredText={t.correction.errCancelReason}
            confirm={t.correction.cancelConfirm}
            maxLength={CORRECTION_NOTE_MAX}
            onCancel={() => setCancelling(false)}
            onSubmit={(reason) => cancelOwnEntry('expenses', row.id, reason)}
            onDone={() => {
              setCancelling(false)
              onCancelled()
            }}
          />
        </BottomSheet>
      )}
    </article>
  )
}
