import { useEffect, useState, type ReactNode } from 'react'
import { MovementPhoto } from '@/components/MovementPhoto'
import { Badge, DetailSheet, EntryRow, Money, Notice, Qty, sameQty, Spinner } from '@/components/ui'
import { listAlerts } from '@/data/alertsRepo'
import { listMovements } from '@/data/movementsRepo'
import type { Alert, Movement, Purchase } from '@/data/types'
import { round } from '@/domain/decimal'
import { unitLabel } from '@/domain/units'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { formatDateTime } from '@/lib/format'
import { alertDetailText } from '../alerts/alertDetails'
import { SEVERITY_TONE, STATUS_TONE } from '../alerts/alertTones'
import { PurchaseGeo, PurchaseQr } from './PurchaseAutomationInfo'
import { QrBadge } from './QrBadge'
import { ReceiptBadge } from './ReceiptBadge'

const tp = t.purchases
const ta = t.alertTexts

function Section({ title, children, label }: { title: string; children: ReactNode; label?: string }) {
  return (
    <section className="flex flex-col gap-2" aria-label={label}>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {children}
    </section>
  )
}

/** Xarid tafsiloti: ma'lumotlar, chek rasmi, bog'langan kirimlar va alertlar. */
export function PurchaseDetailDialog({
  purchase,
  canSeeAlerts,
  thresholdPct,
  nowIso,
  onClose,
  footer,
}: {
  purchase: Purchase
  canSeeAlerts: boolean
  thresholdPct: string
  nowIso: string
  onClose: () => void
  /** Amallar (o'chirish/tiklash) — container beradi. */
  footer?: ReactNode
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
  const row = (label: string, value: ReactNode) => (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </>
  )

  return (
    <DetailSheet title={tp.detailTitle} onClose={onClose} size="lg" footer={footer}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-line bg-canvas p-4">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-lg font-semibold text-ink">{purchase.material_name}</span>
            <Qty value={purchase.qty_input} unit={unitLabel({ unit: purchase.unit_input, variant: purchase.unit_variant })} size="lg" />
            {!sameQty({ value: purchase.qty_input, unit: unitLabel({ unit: purchase.unit_input, variant: purchase.unit_variant }) }, { value: purchase.qty_base, unit: base }) && (
              <span className="text-sm text-muted">
                = <Qty value={purchase.qty_base} unit={base} size="sm" tone="muted" />
              </span>
            )}
          </div>
          <span className="flex flex-col items-end gap-1.5">
            <Money value={purchase.total_amount} size="hero" />
            <QrBadge p={purchase} />
          </span>
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {row(tp.colDate, <span className="tabular">{formatDateTime(purchase.purchased_at)}</span>)}
          {row(tp.colBuyer, purchase.buyer_name)}
          {row(tp.colObject, purchase.object_name)}
          {row(tp.perBase(base), <Money value={round(purchase.price_per_base, 2)} size="sm" />)}
          {row(tp.colSupplier, purchase.supplier_name ?? '—')}
          {row(tp.colStatus, <ReceiptBadge p={purchase} thresholdPct={thresholdPct} nowIso={nowIso} level />)}
          {purchase.request_id && row(tp.byRequest, <span className="font-mono text-xs">{purchase.request_id.slice(0, 8)}</span>)}
          {purchase.note && row(t.movements.note, <span className="whitespace-pre-wrap">{purchase.note}</span>)}
        </dl>

        <Section title={tp.receiptPhoto}>
          {purchase.receipt_photo_path ? (
            <MovementPhoto path={purchase.receipt_photo_path} alt={tp.receiptPhoto} />
          ) : (
            <p className="text-sm text-muted">{tp.noReceipt}</p>
          )}
        </Section>

        {purchase.receipt_fiscal_sign && (
          <Section title={tp.qrTitle} label={tp.qrTitle}>
            <PurchaseQr p={purchase} />
          </Section>
        )}

        <Section title={tp.geoTitle} label={tp.geoTitle}>
          <PurchaseGeo p={purchase} />
        </Section>

        <Section title={tp.linkedMovements} label={tp.linkedMovements}>
          {error && <Notice>{error}</Notice>}
          {!movements && !error && <Spinner />}
          {movements && movements.length === 0 && <p className="text-sm text-muted">{tp.noLinked}</p>}
          {movements && movements.length > 0 && (
            <ul className="flex flex-col gap-2">
              {movements.map((m) => (
                <EntryRow
                  key={m.id}
                  as="li"
                  kind="kirim"
                  title={m.created_by_name ?? '—'}
                  meta={<span className="tabular">{formatDateTime(m.occurred_at)}</span>}
                  qty={{ value: m.qty_input, unit: unitLabel({ unit: m.unit_input, variant: m.unit_variant }) }}
                  baseQty={{ value: m.qty_base, unit: m.base_unit }}
                />
              ))}
            </ul>
          )}
        </Section>

        {canSeeAlerts && (
          <Section title={tp.alerts} label={tp.alerts}>
            {!alerts && <Spinner />}
            {alerts && alerts.length === 0 && <p className="text-sm text-muted">{tp.noAlerts}</p>}
            {alerts && alerts.length > 0 && (
              <ul className="flex flex-col gap-2 text-sm">
                {alerts.map((a) => (
                  <li key={a.id} className="flex flex-col gap-1.5 rounded-xl border border-line px-3 py-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone={SEVERITY_TONE[a.severity]}>{ta.types[a.type]}</Badge>
                      <Badge tone={STATUS_TONE[a.status]}>{ta.statuses[a.status]}</Badge>
                    </span>
                    <span className="text-ink">{alertDetailText(a)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}
      </div>
    </DetailSheet>
  )
}
