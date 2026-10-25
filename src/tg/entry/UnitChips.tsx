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
      {units.map((u) => (
        <button
          key={u.id}
          type="button"
          aria-pressed={u.id === selectedId}
          onClick={() => onPick(u.id)}
          className={`min-h-11 rounded-full border px-4 text-base ${
            u.id === selectedId ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white text-slate-800'
          }`}
        >
          {unitLabel(u)}
        </button>
      ))}
    </div>
  )
}
