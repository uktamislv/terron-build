import { useEffect, useId, useState } from 'react'
import { ClipboardList } from 'lucide-react'
import { Button, EntryRow, Modal, Notice, Qty, Spinner } from '@/components/ui'
import { listPurchases } from '@/data/purchasesRepo'
import { DECISION_NOTE_MAX } from '@/data/requestsRepo'
import type { MaterialRequest, Purchase } from '@/data/types'
import { unitLabel } from '@/domain/units'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatDateTime, formatQty, formatSum } from '@/lib/format'

const tp = t.requestsPage

/** So'rov qisqa ko'rinishi (dialog boshida). */
function RequestSummary({ r }: { r: MaterialRequest }) {
  return (
    <EntryRow
      kind="neutral"
      icon={<ClipboardList className="size-[18px]" strokeWidth={1.75} />}
      title={r.material_name ?? '—'}
      meta={r.object_name ? <span>{r.object_name}</span> : undefined}
      trailing={<Qty value={r.qty_input} unit={unitLabel({ unit: r.unit_input, variant: r.unit_variant })} size="lg" />}
    />
  )
}

/** Rad etish: sabab majburiy (`decision_note`). */
export function RejectDialog({
  request,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  request: MaterialRequest
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: (reason: string) => void
}) {
  const id = useId()
  const [reason, setReason] = useState('')
  const [missing, setMissing] = useState(false)
  return (
    <Modal title={tp.rejectTitle} onClose={onCancel}>
      <div className="flex flex-col gap-4">
        <RequestSummary r={request} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={id} className="text-sm font-medium text-ink">
            {tp.rejectReason}
          </label>
          <textarea
            id={id}
            rows={3}
            maxLength={DECISION_NOTE_MAX}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value)
              setMissing(false)
            }}
            aria-invalid={missing || undefined}
            className={`min-h-11 rounded-xl border bg-paper px-3 py-2 text-base outline-none focus:border-brand focus:ring-3 focus:ring-brand/15 ${
              missing ? 'border-danger' : 'border-line'
            }`}
          />
          {missing && <p className="text-xs text-danger">{tp.rejectReasonRequired}</p>}
        </div>
        {error && <Notice>{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            {t.common.cancel}
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              if (!reason.trim()) {
                setMissing(true)
                return
              }
              onConfirm(reason)
            }}
          >
            {tp.reject}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** "Xarid qilindi": ixtiyoriy ravishda shu obyekt/material xaridini bog'lash. */
export function PurchasedDialog({
  request,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  request: MaterialRequest
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: (purchaseId: string | null) => void
}) {
  const name = useId()
  const [purchases, setPurchases] = useState<Purchase[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string>('')

  useEffect(() => {
    let alive = true
    listPurchases({ objectId: request.object_id, materialId: request.material_id })
      .then((page) => alive && setPurchases(page.rows))
      .catch((err: unknown) => alive && setLoadError(errorText(err)))
    return () => {
      alive = false
    }
  }, [request.object_id, request.material_id])

  const option = (value: string, label: string, sub?: string) => (
    <label
      key={value || 'none'}
      className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 ${
        selected === value ? 'border-brand bg-ice' : 'border-line hover:bg-canvas'
      }`}
    >
      <input type="radio" className="size-5 accent-brand" name={name} value={value} checked={selected === value} onChange={() => setSelected(value)} />
      <span className="flex flex-col">
        <span className="tabular text-sm font-medium text-ink">{label}</span>
        {sub && <span className="text-xs text-muted">{sub}</span>}
      </span>
    </label>
  )

  return (
    <Modal title={tp.purchasedTitle} onClose={onCancel}>
      <div className="flex flex-col gap-4">
        <RequestSummary r={request} />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-ink">{tp.linkPurchase}</legend>
          {option('', tp.noLink)}
          {loadError && <Notice>{loadError}</Notice>}
          {!purchases && !loadError && <Spinner />}
          {purchases && purchases.length === 0 && <p className="text-sm text-muted">{tp.noPurchases}</p>}
          {purchases?.map((p) =>
            option(
              p.id,
              `${formatQty(p.qty_input)} ${unitLabel({ unit: p.unit_input, variant: p.unit_variant })} · ${formatSum(p.total_amount)}`,
              `${formatDateTime(p.purchased_at)}${p.buyer_name ? ` · ${p.buyer_name}` : ''}`,
            ),
          )}
        </fieldset>
        {error && <Notice>{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            {t.common.cancel}
          </Button>
          <Button disabled={busy} onClick={() => onConfirm(selected || null)}>
            {tp.confirm}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
