// Materiallar ro'yxatini filtrlash — sof funksiyalar (React'siz).
import type { Material, MaterialUnit } from '@/data/types'
import { normalizeAlias } from '@/domain/aliases'
import type { UnitDef } from '@/domain/units'

export type ActiveFilter = 'active' | 'inactive' | 'all'

export const ACTIVE_FILTERS: readonly ActiveFilter[] = ['active', 'inactive', 'all']

/** Kategoriya filtri: '' — hammasi, NO_CATEGORY — kategoriyasizlar, boshqasi — aniq kategoriya. */
export const NO_CATEGORY = '\u0000none'

export interface MaterialFilter {
  query: string
  category: string
  active: ActiveFilter
}

/** Qidiruv nom va muqobil nomlar bo'yicha (normalizeAlias: katta-kichik harf, bo'sh joy, ё/е). */
export function matchesQuery(material: Material, query: string): boolean {
  const q = normalizeAlias(query)
  if (!q) return true
  return [material.name, ...material.aliases.map((a) => a.alias)].some((n) => normalizeAlias(n).includes(q))
}

export function filterMaterials(materials: readonly Material[], filter: MaterialFilter): Material[] {
  return materials.filter((m) => {
    if (filter.active === 'active' && !m.is_active) return false
    if (filter.active === 'inactive' && m.is_active) return false
    if (filter.category === NO_CATEGORY && m.category) return false
    if (filter.category && filter.category !== NO_CATEGORY && m.category !== filter.category) return false
    return matchesQuery(m, filter.query)
  })
}

/** Firmadagi kategoriyalar — alifbo bo'yicha, takrorsiz. */
export function categoriesOf(materials: readonly Material[]): string[] {
  const set = new Set<string>()
  for (const m of materials) if (m.category) set.add(m.category)
  return [...set].sort((a, b) => a.localeCompare(b))
}

/**
 * Nom firmada band-mi: boshqa materialning nomi yoki muqobil nomi (`normalizeAlias` bo'yicha —
 * bazadagi unique'dan qat'iyroq). `exceptMaterialId` (tahrirlanayotgan material) hisobga olinmaydi.
 */
export function isNameTaken(materials: readonly Material[], name: string, exceptMaterialId?: string): boolean {
  const n = normalizeAlias(name)
  if (!n) return false
  return materials.some(
    (m) =>
      m.id !== exceptMaterialId &&
      (normalizeAlias(m.name) === n || m.aliases.some((a) => normalizeAlias(a.alias) === n)),
  )
}

/** Muqobil nom band-mi: istalgan material nomi (o'zi ham) yoki istalgan muqobil nom. */
export function isAliasTaken(materials: readonly Material[], alias: string): boolean {
  const n = normalizeAlias(alias)
  if (!n) return false
  return materials.some(
    (m) => normalizeAlias(m.name) === n || m.aliases.some((a) => normalizeAlias(a.alias) === n),
  )
}

/** Birlik (nom + variant) materialda allaqachon bormi — `exceptUnitId` (tahrirlanayotgan) hisobga olinmaydi. */
export function isUnitTaken(
  units: readonly MaterialUnit[],
  unit: string,
  variant: string | null,
  exceptUnitId?: string,
): boolean {
  const n = normalizeAlias(unit)
  const v = normalizeAlias(variant ?? '')
  return units.some(
    (u) => u.id !== exceptUnitId && normalizeAlias(u.unit) === n && normalizeAlias(u.variant ?? '') === v,
  )
}

/** Baza qatori → domen birligi (konvertatsiya funksiyalari uchun). */
export function toUnitDef(u: MaterialUnit): UnitDef {
  return { id: u.id, materialId: u.material_id, unit: u.unit, factor: u.factor, variant: u.variant }
}
