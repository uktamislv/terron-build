import { History } from 'lucide-react'
import type { MaterialUnit } from '@/data/types'
import { unitLabel } from '@/domain/units'
import { t } from '@/i18n'
import { formatQty } from '@/lib/format'
import type { LastEntry } from './lastEntry'

const ta = t.tg.auto

/** "Oxirgi: 3 qop" — bir bosishda miqdor va birlikni qo'yadi (taklif, avtomatik yozilmaydi). */
export function LastQtyChip({
  last,
  units,
  onUse,
}: {
  last: LastEntry | null
  units: readonly MaterialUnit[]
  onUse: (qty: string, unitId: string) => void
}) {
  const unit = last ? units.find((u) => u.id === last.unitId) : undefined
  if (!last || !unit) return null
  const qty = formatQty(last.qty)
  const label = unitLabel(unit)
  return (
    <button
      type="button"
      data-testid="last-qty"
      aria-label={ta.lastUsedLabel(qty, label)}
      onClick={() => onUse(last.qty, unit.id)}
      className="inline-flex min-h-11 items-center gap-2 self-start rounded-full border border-brand/30 bg-ice px-4 text-base font-medium text-brand active:bg-brand/10"
    >
      <History aria-hidden className="size-4" strokeWidth={2} />
      <span className="text-sm text-muted">{ta.lastUsed}</span>
      <span className="tabular font-semibold">
        {qty} {label}
      </span>
    </button>
  )
}
