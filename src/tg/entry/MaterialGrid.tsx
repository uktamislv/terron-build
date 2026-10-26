import { useMemo, useState } from 'react'
import { SearchBox } from '@/components/ui'
import type { Material } from '@/data/types'
import { normalizeAlias } from '@/domain/aliases'
import { t } from '@/i18n'
import { MaterialTile, SectionTitle } from '../ui'

const tm = t.tg.movement

function matches(material: Material, q: string): boolean {
  if (!q) return true
  return [material.name, ...material.aliases.map((a) => a.alias)].some((n) => normalizeAlias(n).includes(q))
}

/**
 * Material plitkalari to'ri: tartib tayyor holda keladi (`rankMaterials`), tepada qidiruv.
 * `pinnedIds` — ko'p ishlatiladiganlar: qidiruv bo'sh bo'lsa alohida guruhda, ajratilgan plitka bilan.
 */
export function MaterialGrid({
  materials,
  onPick,
  pinnedIds,
}: {
  materials: Material[]
  onPick: (m: Material) => void
  pinnedIds?: ReadonlySet<string>
}) {
  const [query, setQuery] = useState('')
  const q = normalizeAlias(query)
  const visible = useMemo(() => materials.filter((m) => matches(m, q)), [materials, q])
  const pinned = !q && pinnedIds && pinnedIds.size > 0 ? visible.filter((m) => pinnedIds.has(m.id)) : []
  const rest = pinned.length > 0 ? visible.filter((m) => !pinnedIds?.has(m.id)) : visible

  return (
    <section className="flex flex-col gap-3" aria-label={tm.chooseMaterial}>
      <SectionTitle>{tm.chooseMaterial}</SectionTitle>
      <SearchBox label={tm.search} value={query} onChange={setQuery} />
      {materials.length === 0 && <p className="text-sm text-muted">{tm.noMaterials}</p>}
      {materials.length > 0 && visible.length === 0 && <p className="text-sm text-muted">{tm.notFound}</p>}
      {pinned.length > 0 && (
        <div role="group" aria-label={tm.frequent} className="flex flex-col gap-2">
          <p className="text-sm font-medium text-muted">{tm.frequent}</p>
          <div className="grid grid-cols-2 gap-2">
            {pinned.map((m) => (
              <MaterialTile key={m.id} name={m.name} sub={m.base_unit} pinned onClick={() => onPick(m)} />
            ))}
          </div>
          {rest.length > 0 && <p className="mt-1 text-sm font-medium text-muted">{tm.allMaterials}</p>}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {rest.map((m) => (
          <MaterialTile key={m.id} name={m.name} sub={m.base_unit} onClick={() => onPick(m)} />
        ))}
      </div>
    </section>
  )
}
