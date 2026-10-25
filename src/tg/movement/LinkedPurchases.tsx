import type { OpenPurchase } from '@/data/types'
import { unitLabel } from '@/domain/units'
import { t } from '@/i18n'
import { formatDate, formatQty } from '@/lib/format'

const tl = t.tg.movement.linked

/**
 * Kirim ekranidagi "Bog'langan xarid": shu obyekt va materialdagi to'liq qabul qilinmagan xaridlar.
 * Hech qachon avtomatik belgilanmaydi: bitta bo'lsa — "Taklif: … — Bog'lash", bir nechta bo'lsa — har
 * birida "Bog'lash". Bir bosishda bog'lanadi, "Bog'lamaslik" — bekor qilish.
 */
export function LinkedPurchases({
  rows,
  selectedId,
  baseUnit,
  onSelect,
}: {
  rows: OpenPurchase[]
  selectedId: string | null
  baseUnit: string
  onSelect: (id: string | null) => void
}) {
  if (rows.length === 0) return null
  return (
    <section className="flex flex-col gap-2" aria-label={tl.title}>
      <div className="flex min-h-11 items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-700">{tl.title}</h2>
        {selectedId && (
          <button type="button" onClick={() => onSelect(null)} className="min-h-11 px-2 text-sm font-medium text-brand">
            {tl.remove}
          </button>
        )}
      </div>
      <p className="text-xs text-slate-500">{rows.length > 1 ? tl.choose : tl.hint}</p>
      {rows.map((p) => {
        const selected = p.id === selectedId
        return (
          <div
            key={p.id}
            data-testid="open-purchase"
            data-linked={selected ? 'true' : undefined}
            className={`flex min-h-14 items-center gap-3 rounded-2xl border px-3 py-2 ${
              selected ? 'border-ok bg-ok/5' : 'border-slate-200 bg-white'
            }`}
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">
                {rows.length === 1 && !selected && <span className="text-brand">{tl.suggestion} </span>}
                {formatDate(p.purchased_at)} · {p.buyer_name ?? ''}
              </p>
              <p className="text-sm text-slate-700">
                {tl.bought(formatQty(p.qty_input), unitLabel({ unit: p.unit_input, variant: p.unit_variant }))} ·{' '}
                <strong>{tl.remaining(formatQty(p.remaining_qty_base), baseUnit)}</strong>
              </p>
            </div>
            {selected ? (
              <span className="shrink-0 text-sm font-semibold text-ok">{tl.linkedMark}</span>
            ) : (
              <button
                type="button"
                onClick={() => onSelect(p.id)}
                className="min-h-11 shrink-0 rounded-xl border border-brand px-3 text-sm font-semibold text-brand"
              >
                {tl.link}
              </button>
            )}
          </div>
        )
      })}
    </section>
  )
}
