import { useMemo, useState } from 'react'
import type { Material } from '@/data/types'
import { normalizeAlias } from '@/domain/aliases'
import { t } from '@/i18n'

const tm = t.tg.movement

function matches(material: Material, q: string): boolean {
  if (!q) return true
  return [material.name, ...material.aliases.map((a) => a.alias)].some((n) => normalizeAlias(n).includes(q))
}

/** Material tugmalari to'ri: tartib tayyor holda keladi (`rankMaterials`), tepada qidiruv. */
export function MaterialGrid({ materials, onPick }: { materials: Material[]; onPick: (m: Material) => void }) {
  const [query, setQuery] = useState('')
  const visible = useMemo(() => {
    const q = normalizeAlias(query)
    return materials.filter((m) => matches(m, q))
  }, [materials, query])

  return (
    <section className="flex flex-col gap-3" aria-label={tm.chooseMaterial}>
      <h2 className="text-sm font-semibold text-slate-700">{tm.chooseMaterial}</h2>
      <input
        type="search"
        aria-label={tm.search}
        placeholder={tm.search}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="min-h-12 rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
      {materials.length === 0 && <p className="text-sm text-slate-600">{tm.noMaterials}</p>}
      {materials.length > 0 && visible.length === 0 && <p className="text-sm text-slate-600">{tm.notFound}</p>}
      <div className="grid grid-cols-2 gap-2">
        {visible.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onPick(m)}
            className="flex min-h-16 flex-col items-start justify-center rounded-2xl border border-slate-200 bg-white px-3 py-2 text-left active:bg-brand-light"
          >
            <span className="text-base font-semibold leading-tight text-slate-900">{m.name}</span>
            <span className="text-xs text-slate-500">{m.base_unit}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
