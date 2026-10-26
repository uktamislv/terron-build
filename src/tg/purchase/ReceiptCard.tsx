// Batch 12 (G): chek QR — skanerlash tugmasi, chek kartasi (tasdiqlangan / qo'lda), ko'p qatorli chekda
// qator tanlash. Taqdimot komponenti — holat PurchasePage'da.
import { BadgeCheck, LoaderCircle, QrCode, ReceiptText, X } from 'lucide-react'
import { choiceClass, cx, Notice } from '@/components/ui'
import type { ReceiptLine } from '@/data/receiptRepo'
import { t } from '@/i18n'
import { formatDateTime, formatQty, formatSum } from '@/lib/format'
import { SectionTitle } from '../ui'

const ta = t.tg.auto

export interface ReceiptView {
  receiptNo: string
  verified: boolean
  total: string | null
  sellerName: string | null
  /** Chek sana-vaqti (QR yoki sahifadan), ISO. */
  datetime: string | null
  items: ReceiptLine[]
  /** Ko'p qatorli chekda tanlangan qator; null — hali tanlanmagan. */
  lineIndex: number | null
}

export function ScanReceiptButton({ busy, onScan }: { busy: boolean; onScan: () => void }) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onScan}
      className="inline-flex min-h-13 w-full items-center justify-center gap-2 rounded-xl border border-brand/40 bg-paper px-4 text-base font-semibold text-brand active:bg-ice disabled:opacity-60"
    >
      {busy ? (
        <LoaderCircle aria-hidden className="size-5 animate-spin" strokeWidth={2} />
      ) : (
        <QrCode aria-hidden className="size-5" strokeWidth={1.75} />
      )}
      {busy ? ta.scanning : ta.scanReceipt}
    </button>
  )
}

export function ReceiptCard({
  receipt,
  usedError,
  onRemove,
  onPickLine,
}: {
  receipt: ReceiptView
  /** Saqlashda `receipt_already_used` — izoh ko'rsatiladi. */
  usedError: boolean
  onRemove: () => void
  onPickLine: (index: number) => void
}) {
  const multi = receipt.items.length > 1
  return (
    <section
      aria-label={ta.receiptNo(receipt.receiptNo)}
      data-testid="receipt-card"
      data-verified={receipt.verified ? 'true' : undefined}
      className={cx(
        'flex flex-col gap-3 rounded-xl border p-3',
        receipt.verified ? 'border-ok/30 bg-ok-bg/50' : 'border-line bg-paper',
      )}
    >
      <div className="flex items-start gap-3">
        <ReceiptText aria-hidden className="mt-0.5 size-5 shrink-0 text-navy" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{ta.receiptNo(receipt.receiptNo)}</p>
          {receipt.datetime && <p className="tabular text-xs text-muted">{formatDateTime(receipt.datetime)}</p>}
          {receipt.total !== null && (
            <p className="tabular text-sm text-ink">{ta.receiptSummary(formatSum(receipt.total), receipt.sellerName ?? '')}</p>
          )}
          {receipt.verified ? (
            <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-ok">
              <BadgeCheck aria-hidden className="size-4" strokeWidth={2} />
              {ta.receiptVerified}
            </p>
          ) : (
            // Odatiy holat (soliq.uz imzolangan so'rov talab qiladi) — xato emas, neytral izoh
            <p className="mt-1 text-sm text-muted">{ta.receiptUnverified}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={ta.receiptRemove}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-paper"
        >
          <X aria-hidden className="size-5" strokeWidth={2} />
        </button>
      </div>

      {multi && (
        <div className="flex flex-col gap-2">
          <SectionTitle className="text-sm">{ta.receiptChooseLine}</SectionTitle>
          {/* QR faqat bitta xaridga biriktiriladi (fiskal belgi unique) */}
          <p data-testid="receipt-other-lines" className="text-xs text-muted">{ta.receiptOtherLines}</p>
          <div role="group" aria-label={ta.receiptChooseLine} className="flex flex-col gap-2">
            {receipt.items.map((line, i) => (
              <button
                key={`${i}:${line.name}`}
                type="button"
                aria-pressed={receipt.lineIndex === i}
                onClick={() => onPickLine(i)}
                className={cx(choiceClass({ selected: receipt.lineIndex === i, shape: 'row', emphasis: false }), 'min-h-12 justify-between')}
              >
                <span className="min-w-0 flex-1 text-sm font-medium text-ink">{line.name}</span>
                <span className="tabular shrink-0 text-sm text-muted">{ta.receiptLine(formatQty(line.qty), line.unit, formatSum(line.sum))}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {usedError && <Notice tone="warn">{ta.receiptUsed}</Notice>}
    </section>
  )
}
