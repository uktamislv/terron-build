// "Qabul kutilmoqda (N)": xarid qilingan, lekin hali kirim qilinmagan materiallar (obyektlarim bo'yicha).
// Bosilsa — ro'yxat varag'i; qatorni tanlash kirim formasini oldindan to'ldiradi (obyekt, material,
// qolgan miqdor, bog'langan xarid). Ma'lumot — RPC `open_purchases_for_my_objects`.
import { useState } from 'react'
import { ChevronRight, PackageOpen } from 'lucide-react'
import { BottomSheet, EntryRow } from '@/components/ui'
import type { MyOpenPurchase } from '@/data/types'
import { t } from '@/i18n'
import { formatDate } from '@/lib/format'
import { haptic } from '../telegram'

const tp = t.tg.pending

export function PendingReceipts({
  rows,
  onPick,
  showObject = true,
}: {
  rows: MyOpenPurchase[]
  onPick: (row: MyOpenPurchase) => void
  /** Bir nechta obyekt bo'lsa — qatorda obyekt nomi. */
  showObject?: boolean
}) {
  const [open, setOpen] = useState(false)
  if (rows.length === 0) return null
  return (
    <>
      <button
        type="button"
        data-testid="pending-receipts"
        onClick={() => {
          haptic.tap()
          setOpen(true)
        }}
        className="flex min-h-13 w-full items-center gap-3 rounded-xl border border-warn/25 bg-warn-bg px-4 py-2.5 text-left text-warn transition-colors active:brightness-95"
      >
        <PackageOpen aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-semibold">{tp.banner(rows.length)}</span>
          <span className="text-sm">{tp.hint}</span>
        </span>
        <ChevronRight aria-hidden className="size-5 shrink-0" strokeWidth={2} />
      </button>
      {open && (
        <BottomSheet title={tp.title} onClose={() => setOpen(false)}>
          <ul className="flex flex-col gap-2 pb-1">
            {rows.map((r) => (
              <EntryRow
                key={r.purchase_id}
                as="li"
                kind="kirim"
                testId="pending-receipt"
                title={r.material_name ?? ''}
                meta={
                  <>
                    {showObject && r.object_name && <span>{r.object_name}</span>}
                    <span className="tabular">{tp.bought(formatDate(r.purchased_at), r.buyer_name ?? '')}</span>
                  </>
                }
                trailingMeta={tp.remainingLabel}
                qty={{ value: r.remaining_qty_base, unit: r.base_unit ?? '' }}
                onClick={() => {
                  setOpen(false)
                  onPick(r)
                }}
              />
            ))}
          </ul>
        </BottomSheet>
      )}
    </>
  )
}
