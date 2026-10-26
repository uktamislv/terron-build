import { Check, Link2, ShoppingCart } from 'lucide-react'
import { cx } from '@/components/ui'
import type { OpenPurchase } from '@/data/types'
import { unitLabel } from '@/domain/units'
import { t } from '@/i18n'
import { formatDate, formatQty } from '@/lib/format'
import { SectionTitle } from '../ui'

const tl = t.tg.movement.linked

/**
 * Kirim ekranidagi "Bog'langan xarid": shu obyekt va materialdagi to'liq qabul qilinmagan xaridlar.
 * Batch 12 (A): bittagina bo'lsa — oldindan tanlangan ("Bog'lamaslik" — bir bosishda olib tashlanadi);
 * bir nechta bo'lsa — eng eskisi birinchi, hech biri tanlanmagan, har birida "Bog'lash".
 */
export function LinkedPurchases({
  rows,
  selectedId,
  autoLinked = false,
  baseUnit,
  onSelect,
}: {
  rows: OpenPurchase[]
  selectedId: string | null
  /** Batch 12 (A): yagona ochiq xarid avtomatik tanlangan — izoh boshqacha. */
  autoLinked?: boolean
  baseUnit: string
  onSelect: (id: string | null) => void
}) {
  if (rows.length === 0) return null
  return (
    <section className="flex flex-col gap-2" aria-label={tl.title}>
      <div className="flex min-h-11 items-center justify-between gap-2">
        <SectionTitle>{tl.title}</SectionTitle>
        {selectedId && (
          <button type="button" onClick={() => onSelect(null)} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-brand hover:bg-ice">
            {tl.remove}
          </button>
        )}
      </div>
      <p className="text-sm text-muted">{rows.length > 1 ? tl.choose : autoLinked && selectedId ? tl.autoLinked : tl.hint}</p>
      {rows.map((p) => {
        const selected = p.id === selectedId
        return (
          <div
            key={p.id}
            data-testid="open-purchase"
            data-linked={selected ? 'true' : undefined}
            className={cx(
              'relative flex min-h-14 items-center gap-3 overflow-hidden rounded-xl border py-2.5 pr-2 pl-4',
              selected ? 'border-brand bg-ice' : 'border-line bg-paper',
            )}
          >
            <span aria-hidden className={cx('absolute inset-y-2 left-0 w-1 rounded-r-full', selected ? 'bg-brand' : 'bg-navy')} />
            <ShoppingCart aria-hidden className="size-5 shrink-0 text-navy" strokeWidth={1.75} />
            <div className="min-w-0 flex-1">
              {rows.length === 1 && !selected && <p className="text-xs font-semibold text-brand">{tl.suggestion}</p>}
              <p className="truncate text-sm font-semibold text-ink">{p.buyer_name ?? ''}</p>
              <p className="text-xs text-muted">{formatDate(p.purchased_at)}</p>
              <p className="text-xs text-muted">{tl.bought(formatQty(p.qty_input), unitLabel({ unit: p.unit_input, variant: p.unit_variant }))}</p>
              <p className="tabular mt-0.5 text-sm font-semibold text-ink">{tl.remaining(formatQty(p.remaining_qty_base), baseUnit)}</p>
            </div>
            <div className="shrink-0">
              {selected ? (
                <span className="inline-flex min-h-11 items-center gap-1 px-1 text-sm font-semibold text-brand">
                  <Check aria-hidden className="size-4" strokeWidth={2.5} />
                  {tl.linkedMark}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onSelect(p.id)}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-brand/40 bg-paper px-3 text-sm font-semibold text-brand hover:bg-ice"
                >
                  <Link2 aria-hidden className="size-4" strokeWidth={2} />
                  {tl.link}
                </button>
              )}
            </div>
          </div>
        )
      })}
    </section>
  )
}
