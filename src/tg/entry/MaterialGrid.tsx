import { useDeferredValue, useMemo, useState, type ReactNode } from 'react'
import { Button, SearchBox } from '@/components/ui'
import type { Material } from '@/data/types'
import { normalizeAlias } from '@/domain/aliases'
import { t } from '@/i18n'
import { MaterialTile, SectionTitle } from '../ui'

const tm = t.tg.movement
/** Birinchi ko'rsatiladigan plitkalar soni — katta katalogda (500+) har harfda hammasi chizilmasin. */
const MATERIAL_PAGE = 60

/** Qidiruv kalitlari (nom va muqobil nomlar, normallashtirilgan) — katalog o'zgarganda bir marta. */
function searchKeys(materials: Material[]): Map<string, string[]> {
  const keys = new Map<string, string[]>()
  for (const m of materials) keys.set(m.id, [m.name, ...m.aliases.map((a) => a.alias)].map(normalizeAlias))
  return keys
}

/**
 * Material plitkalari to'ri: tartib tayyor holda keladi (`rankMaterials`), tepada qidiruv.
 * `pinnedIds` — ko'p ishlatiladiganlar: qidiruv bo'sh bo'lsa alohida guruhda, ajratilgan plitka bilan.
 * `flags` — plitka ostidagi qo'shimcha belgi (masalan kirimda "Qabul kutilmoqda").
 * Katta katalog: qidiruv kalitlari oldindan hisoblanadi, qidiruv kechiktiriladi (`useDeferredValue`),
 * dastlab `MATERIAL_PAGE` ta plitka — qolgani "Yana ko'rsatish" bilan.
 */
export function MaterialGrid({
  materials,
  onPick,
  pinnedIds,
  flags,
}: {
  materials: Material[]
  onPick: (m: Material) => void
  pinnedIds?: ReadonlySet<string>
  flags?: ReadonlyMap<string, ReactNode>
}) {
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(MATERIAL_PAGE)
  const deferred = useDeferredValue(query)
  const q = normalizeAlias(deferred)
  const keys = useMemo(() => searchKeys(materials), [materials])
  const visible = useMemo(
    () => (q ? materials.filter((m) => (keys.get(m.id) ?? []).some((k) => k.includes(q))) : materials),
    [materials, keys, q],
  )
  const pinned = !q && pinnedIds && pinnedIds.size > 0 ? visible.filter((m) => pinnedIds.has(m.id)) : []
  const rest = pinned.length > 0 ? visible.filter((m) => !pinnedIds?.has(m.id)) : visible
  const shown = rest.slice(0, Math.max(0, limit - pinned.length))
  const hidden = rest.length - shown.length
  const tile = (m: Material, isPinned: boolean) => (
    <MaterialTile
      key={m.id}
      name={m.name}
      sub={m.base_unit}
      pinned={isPinned}
      flag={flags?.get(m.id)}
      onClick={() => onPick(m)}
    />
  )

  return (
    <section className="flex flex-col gap-3" aria-label={tm.chooseMaterial}>
      <SectionTitle>{tm.chooseMaterial}</SectionTitle>
      <SearchBox
        label={tm.search}
        value={query}
        onChange={(v) => {
          setQuery(v)
          setLimit(MATERIAL_PAGE)
        }}
      />
      {materials.length === 0 && <p className="text-sm text-muted">{tm.noMaterials}</p>}
      {materials.length > 0 && visible.length === 0 && <p className="text-sm text-muted">{tm.notFound}</p>}
      {pinned.length > 0 && (
        <div role="group" aria-label={tm.frequent} className="flex flex-col gap-2">
          <p className="text-sm font-medium text-muted">{tm.frequent}</p>
          <div className="grid grid-cols-2 gap-2">{pinned.map((m) => tile(m, true))}</div>
          {rest.length > 0 && <p className="mt-1 text-sm font-medium text-muted">{tm.allMaterials}</p>}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">{shown.map((m) => tile(m, false))}</div>
      {hidden > 0 && (
        <Button variant="secondary" size="lg" onClick={() => setLimit((n) => n + MATERIAL_PAGE * 2)}>
          {tm.showMore(hidden)}
        </Button>
      )}
    </section>
  )
}
