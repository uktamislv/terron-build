import { useMemo, useState } from 'react'
import type { Material } from '@/data/types'
import { normalizeAlias } from '@/domain/aliases'
import { t } from '@/i18n'
import { MaterialTile, SearchBox, SectionTitle } from '../ui'

const tm = t.tg.movement

function matches(material: Material, q: string): boolean {
  if (!q) return true
  return [material.name, ...material.aliases.map((a) => a.alias)].some((n) => normalizeAlias(n).includes(q))
}

/** Material plitkalari to'ri: tartib tayyor holda keladi (`rankMaterials`), tepada qidiruv. */
export function MaterialGrid({ materials, onPick }: { materials: Material[]; onPick: (m: Material) => void }) {
  const [query, setQuery] = useState('')
  const visible = useMemo(() => {
    const q = normalizeAlias(query)
    return materials.filter((m) => matches(m, q))
  }, [materials, query])

  return (
    <section className="flex flex-col gap-3" aria-label={tm.chooseMaterial}>
      <SectionTitle>{tm.chooseMaterial}</SectionTitle>
      <SearchBox label={tm.search} value={query} onChange={setQuery} />
      {materials.length === 0 && <p className="text-sm text-muted">{tm.noMaterials}</p>}
      {materials.length > 0 && visible.length === 0 && <p className="text-sm text-muted">{tm.notFound}</p>}
      <div className="grid grid-cols-2 gap-2">
        {visible.map((m) => (
          <MaterialTile key={m.id} name={m.name} sub={m.base_unit} onClick={() => onPick(m)} />
        ))}
      </div>
    </section>
  )
}
