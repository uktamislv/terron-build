import { cx } from '@/components/ui'
import type { MaterialUnit } from '@/data/types'
import { unitLabel } from '@/domain/units'
import { t } from '@/i18n'

/** Birlik tanlash chiplari (asosiy birlik birinchi — katalog tartibi). */
export function UnitChips({
  units,
  selectedId,
  onPick,
}: {
  units: MaterialUnit[]
  selectedId: string | null
  onPick: (id: string) => void
}) {
  return (
    <div role="group" aria-label={t.tg.movement.unit} className="flex flex-wrap gap-2">
      {units.map((u) => {
        const selected = u.id === selectedId
        return (
          <button
            key={u.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onPick(u.id)}
            className={cx(
              'min-h-11 rounded-full border px-4 text-base font-medium transition-colors',
              selected ? 'border-brand bg-ice font-semibold text-brand' : 'border-line bg-paper text-ink active:bg-ice',
            )}
          >
            {unitLabel(u)}
          </button>
        )
      })}
    </div>
  )
}
