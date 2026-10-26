import { choiceClass } from '@/components/ui'
import type { MaterialUnit } from '@/data/types'
import { unitLabel } from '@/domain/units'
import { t } from '@/i18n'

/** Birlik tanlash chiplari (asosiy birlik birinchi — katalog tartibi). */
export function UnitChips({
  units,
  selectedId,
  onPick,
  errorId,
}: {
  units: MaterialUnit[]
  selectedId: string | null
  onPick: (id: string) => void
  /** Xato matni elementi (aria-describedby). */
  errorId?: string
}) {
  return (
    <div role="group" aria-label={t.tg.movement.unit} aria-describedby={errorId} className="flex flex-wrap gap-2">
      {units.map((u) => {
        const selected = u.id === selectedId
        return (
          <button
            key={u.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onPick(u.id)}
            className={choiceClass({ selected, size: 'md' })}
          >
            {unitLabel(u)}
          </button>
        )
      })}
    </div>
  )
}
