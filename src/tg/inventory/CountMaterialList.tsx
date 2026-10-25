import { useMemo, useState } from 'react'
import type { Material } from '@/data/types'
import { normalizeAlias } from '@/domain/aliases'
import { t } from '@/i18n'

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
      <input
        type="search"
        aria-label={tm.search}
        placeholder={tm.search}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="min-h-12 rounded-xl border border-slate-300 px-3 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
      {visible.length === 0 && <p className="text-sm text-slate-600">{tm.notFound}</p>}
      <div className="grid grid-cols-2 gap-2">
        {visible.map((m) => {
          const counted = countedIds.has(m.id)
          return (
            <button
              key={m.id}
              type="button"
              data-counted={counted ? 'true' : undefined}
              onClick={() => onPick(m)}
              className={`flex min-h-16 flex-col items-start justify-center rounded-2xl border px-3 py-2 text-left active:bg-brand-light ${
                counted ? 'border-ok/40 bg-ok/5' : 'border-slate-200 bg-white'
              }`}
            >
              <span className="text-base font-semibold leading-tight text-slate-900">{m.name}</span>
              <span className={`text-xs ${counted ? 'font-medium text-ok' : 'text-slate-500'}`}>
                {counted ? ti.countedMark : m.base_unit}
              </span>
            </button>
          )
        })}
      </div>
      {hasRelevant && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="min-h-11 self-start px-1 text-sm font-medium text-brand"
        >
          {showAll ? ti.showRelevant : ti.showAll}
        </button>
      )}
    </section>
  )
}
