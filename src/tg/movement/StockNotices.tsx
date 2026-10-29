// Chiqim: qoldiq holati (forma ochilishi bilan) va manfiy qoldiq tasdig'i.
import { ArrowDownLeft, TriangleAlert } from 'lucide-react'
import { Button, Notice } from '@/components/ui'
import { t } from '@/i18n'
import { formatQty } from '@/lib/format'

const tm = t.tg.movement

/**
 * Qoldiq ≤ 0: chiqim qilinadigan narsa yo'q — odatda kirim yozilmagan. "Kirimga o'tish" bir bosishda
 * turni almashtiradi (material va obyekt saqlanadi). Ochiq xarid bo'lsa — "hali qabul qilinmagan".
 */
export function EmptyStockNotice({ pending, onToKirim }: { pending: boolean; onToKirim: () => void }) {
  return (
    <div role="alert" data-testid="stock-empty" className="flex flex-col gap-3 rounded-xl border border-warn/25 bg-warn-bg p-3">
      <p className="flex items-start gap-2 text-sm text-warn">
        <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} />
        <span>
          <span className="block">{tm.stockEmpty}</span>
          {pending && <span className="mt-1 block font-semibold">{tm.stockEmptyPending}</span>}
        </span>
      </p>
      <Button variant="secondary" icon={<ArrowDownLeft aria-hidden className="size-5" strokeWidth={2} />} onClick={onToKirim}>
        {tm.toKirim}
      </Button>
    </div>
  )
}

/** Chiqimdan keyin qoldiq manfiy — ikkinchi bosish bilan tasdiq ("Baribir chiqim"), DuplicateWarning kabi. */
export function NegativeStockWarning({
  after,
  unit,
  busy,
  onConfirm,
  onCancel,
}: {
  after: string
  unit: string
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div role="alert" data-testid="negative-warning" className="flex flex-col gap-3 rounded-xl border border-danger/25 bg-danger-bg p-3">
      <p className="flex items-start gap-2 text-sm text-danger">
        <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} />
        <span>
          <span className="block font-semibold">{tm.negativeTitle}</span>
          {tm.negativeText(formatQty(after), unit)}
        </span>
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          {tm.negativeCancel}
        </Button>
        <Button variant="danger" disabled={busy} onClick={onConfirm}>
          {tm.negativeConfirm}
        </Button>
      </div>
    </div>
  )
}

/** Chiqim: miqdor kiritilmagan bo'lsa ham joriy qoldiq; so'rov xato — neytral qator. */
export function StockLine({ current, failed, unit }: { current: string | null; failed: boolean; unit: string }) {
  if (failed) return <Notice tone="info">{tm.stockUnknown}</Notice>
  if (current === null) return null
  return (
    <p data-testid="stock-now" className="tabular text-base font-medium text-ink">
      {tm.stockNow(formatQty(current), unit)}
    </p>
  )
}
