// Batch 12: xarid tafsilotida chek QR maydonlari (G) va yozuv joylashuvi (D).
import { ExternalLink, MapPin } from 'lucide-react'
import type { ReactNode } from 'react'
import { Money } from '@/components/ui'
import type { GeoColumns, Purchase } from '@/data/types'

/** Xarid va xarajat uchun umumiy chek QR maydonlari. */
export type ReceiptQrFields = Pick<Purchase, 'receipt_fiscal_sign' | 'receipt_terminal_id' | 'receipt_no' | 'receipt_total' | 'seller_tin' | 'receipt_verified'>
import { t } from '@/i18n'
import { formatQty } from '@/lib/format'

const tp = t.purchases

export function PurchaseQr({ p }: { p: ReceiptQrFields }) {
  const item = (label: string, value: ReactNode) => (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </>
  )
  return (
    <dl data-testid="purchase-qr" className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      {item(tp.qrFiscalSign, <span className="tabular">{p.receipt_fiscal_sign}</span>)}
      {p.receipt_terminal_id && item(tp.qrTerminal, <span className="tabular">{p.receipt_terminal_id}</span>)}
      {p.receipt_no && item(tp.qrReceiptNo, <span className="tabular">{p.receipt_no}</span>)}
      {p.receipt_total && item(tp.qrTotal, <Money value={p.receipt_total} size="sm" />)}
      {p.seller_tin && item(tp.qrSellerTin, <span className="tabular">{p.seller_tin}</span>)}
      {item('', <span className={p.receipt_verified ? 'text-ok' : 'text-muted'}>{p.receipt_verified ? tp.qrVerifiedYes : tp.qrVerifiedNo}</span>)}
    </dl>
  )
}

/** Joylashuv: holat, koordinata va aniqlik, xaritada ochish havolasi (xarid do'konda — alert yo'q). */
export function PurchaseGeo({ p }: { p: GeoColumns }) {
  if (!p.geo_status) return <p className="text-sm text-muted">{tp.geoNone}</p>
  const ok = p.geo_status === 'ok' && p.geo_lat && p.geo_lng
  return (
    <div data-testid="purchase-geo" className="flex flex-col gap-1 text-sm">
      <span className="inline-flex items-center gap-1.5 text-ink">
        <MapPin aria-hidden className="size-4 text-muted" strokeWidth={1.75} />
        {tp.geoStatus[p.geo_status]}
      </span>
      {ok && (
        <>
          <span className="tabular text-muted">
            {tp.geoOk(p.geo_lat ?? '', p.geo_lng ?? '')}
            {p.geo_accuracy_m != null && ` · ${tp.geoAccuracy(formatQty(String(p.geo_accuracy_m), 0))}`}
          </span>
          <a
            href={`https://www.openstreetmap.org/?mlat=${encodeURIComponent(p.geo_lat ?? '')}&mlon=${encodeURIComponent(p.geo_lng ?? '')}#map=17/${encodeURIComponent(p.geo_lat ?? '')}/${encodeURIComponent(p.geo_lng ?? '')}`}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex min-h-11 items-center gap-1.5 self-start font-semibold text-brand hover:underline"
          >
            <ExternalLink aria-hidden className="size-4" strokeWidth={1.75} />
            {tp.geoOpenMap}
          </a>
        </>
      )}
    </div>
  )
}
