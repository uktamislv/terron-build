import { useMemo, useState } from 'react'
import type { Material } from '@/data/types'
import { normalizeAlias } from '@/domain/aliases'
import { t } from '@/i18n'
import { SearchBox } from '@/components/ui'
import { MaterialTile } from '../ui'

const tm = t.tg.movement
const ti = t.tg.inventory

function matches(material: Material, q: string): boolean {
  if (!q) return true
  return [material.name, ...material.aliases.map((a) => a.alias)].some((n) => normalizeAlias(n).includes(q))
}

/**
 * Sanash uchun materiallar: avval obyektdagilar (qoldig'i bor yoki smetadagi), istasa — hammasi.
 * Sanalganlar belgili. Kutilgan qoldiq bu yerda HECH QACHON ko'rsatilmaydi (ko'r-ko'rona sanash).
 */
export function CountMaterialList({
  materials,
  relevantIds,
  countedIds,
  onPick,
}: {
  materials: Material[]
  relevantIds: ReadonlySet<string>
  countedIds: ReadonlySet<string>
  onPick: (m: Material) => void
}) {
  const [query, setQuery] = useState('')
  const hasRelevant = materials.some((m) => relevantIds.has(m.id))
  const [showAll, setShowAll] = useState(!hasRelevant)
  const visible = useMemo(() => {
    const q = normalizeAlias(query)
    // Qidiruvda — barcha materiallar orasidan
    const base = showAll || q ? materials : materials.filter((m) => relevantIds.has(m.id) || countedIds.has(m.id))
    return base.filter((m) => matches(m, q))
  }, [materials, relevantIds, countedIds, showAll, query])

  return (
    <section className="flex flex-col gap-3" aria-label={tm.chooseMaterial}>
      <SearchBox label={tm.search} value={query} onChange={setQuery} />
      {visible.length === 0 && <p className="text-sm text-muted">{tm.notFound}</p>}
      <div className="grid grid-cols-2 gap-2">
        {visible.map((m) => {
          const counted = countedIds.has(m.id)
          return (
            <MaterialTile key={m.id} name={m.name} sub={counted ? ti.countedMark : m.base_unit} done={counted} onClick={() => onPick(m)} />
          )
        })}
      </div>
      {hasRelevant && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="min-h-11 self-start rounded-lg px-3 text-sm font-semibold text-brand hover:bg-ice"
        >
          {showAll ? ti.showRelevant : ti.showAll}
        </button>
      )}
    </section>
  )
}
