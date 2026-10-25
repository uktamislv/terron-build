import { useEffect, useState } from 'react'
import { MovementPhoto } from '@/components/MovementPhoto'
import { StatusBadge } from '@/components/StatusBadge'
import { Modal, Notice, Spinner } from '@/components/ui'
import { listAlerts } from '@/data/alertsRepo'
import { listMovements } from '@/data/movementsRepo'
import type { Alert, Movement, Purchase } from '@/data/types'
import { round } from '@/domain/decimal'
import { unitLabel } from '@/domain/units'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatDateTime, formatQty, formatSum } from '@/lib/format'
import { alertDetailText } from '../alerts/alertDetails'
import { SEVERITY_TONE, STATUS_TONE } from '../alerts/alertTones'
import { ReceiptBadge } from './ReceiptBadge'

const tp = t.purchases
const ta = t.alertTexts

/** Xarid tafsiloti: ma'lumotlar, chek rasmi, bog'langan kirimlar va alertlar. */
export function PurchaseDetailDialog({
  purchase,
  canSeeAlerts,
  thresholdPct,
  nowIso,
  onClose,
}: {
  purchase: Purchase
  canSeeAlerts: boolean
  thresholdPct: string
  nowIso: string
  onClose: () => void
}) {
  const [movements, setMovements] = useState<Movement[] | null>(null)
  const [alerts, setAlerts] = useState<Alert[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    listMovements({ purchaseId: purchase.id }, 0)
      .then((r) => alive && setMovements(r.rows))
      .catch((err: unknown) => alive && setError(errorText(err)))
    if (canSeeAlerts) {
      listAlerts({ purchaseId: purchase.id }, 0)
        .then((r) => alive && setAlerts(r.rows))
        .catch(() => alive && setAlerts([]))
    }
    return () => {
      alive = false
    }
  }, [purchase.id, canSeeAlerts])

  const base = purchase.base_unit ?? ''

  return (
    <Modal title={tp.detailTitle} onClose={onClose} size="lg">
      <div className="flex flex-col gap-5">
        <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-slate-500">{tp.colDate}</dt>
          <dd>{formatDateTime(purchase.purchased_at)}</dd>
          <dt className="text-slate-500">{tp.colBuyer}</dt>
          <dd>{purchase.buyer_name}</dd>
          <dt className="text-slate-500">{tp.colObject}</dt>
          <dd>{purchase.object_name}</dd>
          <dt className="text-slate-500">{tp.colMaterial}</dt>
          <dd className="font-medium">{purchase.material_name}</dd>
          <dt className="text-slate-500">{tp.colQty}</dt>
          <dd>
            {formatQty(purchase.qty_input)} {unitLabel({ unit: purchase.unit_input, variant: purchase.unit_variant })}{' '}
            <span className="text-slate-500">
              (= {formatQty(purchase.qty_base)} {base})
            </span>
          </dd>
          <dt className="text-slate-500">{tp.colTotal}</dt>
          <dd className="font-semibold">{formatSum(purchase.total_amount)}</dd>
          <dt className="text-slate-500">{tp.perBase(base)}</dt>
          <dd>{formatSum(round(purchase.price_per_base, 2))}</dd>
          <dt className="text-slate-500">{tp.colSupplier}</dt>
          <dd>{purchase.supplier_name ?? '—'}</dd>
          <dt className="text-slate-500">{tp.colStatus}</dt>
          <dd>
            <ReceiptBadge p={purchase} thresholdPct={thresholdPct} nowIso={nowIso} />
          </dd>
          {purchase.note && (
            <>
              <dt className="text-slate-500">{t.movements.note}</dt>
              <dd className="whitespace-pre-wrap">{purchase.note}</dd>
            </>
          )}
        </dl>

        <section className="flex flex-col gap-2">
          <h3 className="font-semibold text-brand-dark">{tp.receiptPhoto}</h3>
          {purchase.receipt_photo_path ? (
            <MovementPhoto path={purchase.receipt_photo_path} alt={tp.receiptPhoto} />
          ) : (
            <p className="text-sm text-slate-500">{tp.noReceipt}</p>
          )}
        </section>

        <section className="flex flex-col gap-2" aria-label={tp.linkedMovements}>
          <h3 className="font-semibold text-brand-dark">{tp.linkedMovements}</h3>
          {error && <Notice>{error}</Notice>}
          {!movements && !error && <Spinner />}
          {movements && movements.length === 0 && <p className="text-sm text-slate-500">{tp.noLinked}</p>}
          {movements && movements.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {movements.map((m) => (
                <li key={m.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                  <span>
                    {formatDateTime(m.occurred_at)} · {m.created_by_name}
                  </span>
                  <span className="font-medium">
                    {formatQty(m.qty_input)} {unitLabel({ unit: m.unit_input, variant: m.unit_variant })} (=
                    {' '}
                    {formatQty(m.qty_base)} {m.base_unit ?? ''})
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {canSeeAlerts && (
          <section className="flex flex-col gap-2" aria-label={tp.alerts}>
            <h3 className="font-semibold text-brand-dark">{tp.alerts}</h3>
            {!alerts && <Spinner />}
            {alerts && alerts.length === 0 && <p className="text-sm text-slate-500">{tp.noAlerts}</p>}
            {alerts && alerts.length > 0 && (
              <ul className="flex flex-col gap-1 text-sm">
                {alerts.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
                    <StatusBadge tone={SEVERITY_TONE[a.severity]}>{ta.types[a.type]}</StatusBadge>
                    <span className="flex-1">{alertDetailText(a)}</span>
                    <StatusBadge tone={STATUS_TONE[a.status]}>{ta.statuses[a.status]}</StatusBadge>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </Modal>
  )
}
