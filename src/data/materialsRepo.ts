import { toRepoError } from './errors'
import { softDeleteById, updateById } from './rowUpdate'
import { getSupabase } from './supabaseClient'
import type { Material, MaterialAlias, MaterialUnit } from './types'

// numeric ustunlar `::text` bilan olinadi — PostgREST JSON'da son qaytarsa aniqlik yo'qolardi.
export const UNIT_COLUMNS = 'id, company_id, material_id, unit, factor::text, variant, created_at, updated_at'
export const ALIAS_COLUMNS = 'id, company_id, material_id, alias, lang, created_at, updated_at'
// FK nomi aniq ko'rsatiladi — keyin boshqa bog'lanish qo'shilsa ham embed noaniq bo'lmaydi.
const MATERIAL_SELECT =
  'id, company_id, name, base_unit, category, waste_pct::text, is_active, photo_required, outside_estimate, created_by, created_at, updated_at, ' +
  `units:material_units!material_units_material_fkey(${UNIT_COLUMNS}, deleted_at), ` +
  `aliases:material_aliases!material_aliases_material_fkey(${ALIAS_COLUMNS}, deleted_at)`

const MATERIAL_ERRORS = { '23505': 'material_name_taken' } as const

export interface NewMaterial {
  companyId: string
  name: string
  baseUnit: string
  category?: string | null
  /** Dec satr, masalan "2.5". Bo'sh — 0. */
  wastePct?: string
  photoRequired?: boolean
  /** Smetaga kirmaydi (admin). */
  outsideEstimate?: boolean
}

export interface MaterialPatch {
  name?: string
  baseUnit?: string
  category?: string | null
  wastePct?: string
  isActive?: boolean
  /** Batch 12 (E). */
  photoRequired?: boolean
  /** Smetaga kirmaydi. */
  outsideEstimate?: boolean
}

type WithDeleted<T> = T & { deleted_at?: string | null }
type RawMaterial = Omit<Material, 'units' | 'aliases'> & {
  units: WithDeleted<MaterialUnit>[] | null
  aliases: WithDeleted<MaterialAlias>[] | null
}

function strip<T extends object>(row: WithDeleted<T>): T {
  const copy: Record<string, unknown> = { ...row }
  delete copy.deleted_at
  return copy as T
}

/** Asosiy birlik qatori: nomi `base_unit` ga teng va variantsiz. */
export function isBaseUnit(
  material: Pick<Material, 'base_unit'>,
  unit: Pick<MaterialUnit, 'unit' | 'variant'>,
): boolean {
  return unit.unit === material.base_unit && unit.variant === null
}

/** Asosiy birlik birinchi, qolganlari qo'shilgan tartibda; muqobil nomlar alifbo bo'yicha. */
function normalize(raw: RawMaterial): Material {
  const units = (raw.units ?? [])
    .filter((u) => !u.deleted_at)
    .map((u) => strip<MaterialUnit>(u))
    .sort((a, b) => {
      const baseDiff = Number(isBaseUnit(raw, b)) - Number(isBaseUnit(raw, a))
      return baseDiff || a.created_at.localeCompare(b.created_at)
    })
  const aliases = (raw.aliases ?? [])
    .filter((a) => !a.deleted_at)
    .map((a) => strip<MaterialAlias>(a))
    .sort((a, b) => a.alias.localeCompare(b.alias))
  return { ...raw, units, aliases }
}

function cleanCategory(category: string | null | undefined): string | null {
  const value = category?.trim()
  return value ? value : null
}

function cleanWaste(waste: string | undefined): string {
  const value = waste?.trim().replace(',', '.')
  return value ? value : '0'
}

/** O'chirilmagan materiallar — birliklari va muqobil nomlari bilan bitta so'rovda. */
export async function listMaterials(): Promise<Material[]> {
  const { data, error } = await getSupabase()
    .from('materials')
    .select(MATERIAL_SELECT)
    .is('deleted_at', null)
    .is('units.deleted_at', null)
    .is('aliases.deleted_at', null)
    .order('name')
  if (error) throw toRepoError(error, MATERIAL_ERRORS)
  return ((data ?? []) as unknown as RawMaterial[]).map(normalize)
}

export async function getMaterial(id: string): Promise<Material> {
  const { data, error } = await getSupabase()
    .from('materials')
    .select(MATERIAL_SELECT)
    .eq('id', id)
    .is('deleted_at', null)
    .is('units.deleted_at', null)
    .is('aliases.deleted_at', null)
    .single()
  if (error) throw toRepoError(error, MATERIAL_ERRORS)
  return normalize(data as unknown as RawMaterial)
}

/** Yaratadi; asosiy birlik qatorini (factor = 1) bazadagi trigger qo'shadi. */
export async function createMaterial(input: NewMaterial): Promise<Material> {
  const row = {
    company_id: input.companyId,
    name: input.name.trim(),
    base_unit: input.baseUnit.trim(),
    category: cleanCategory(input.category),
    waste_pct: cleanWaste(input.wastePct),
    photo_required: input.photoRequired ?? false,
    outside_estimate: input.outsideEstimate ?? false,
  }
  const { data, error } = await getSupabase().from('materials').insert(row).select('id').single()
  if (error) throw toRepoError(error, MATERIAL_ERRORS)
  return getMaterial((data as { id: string }).id)
}

export async function updateMaterial(id: string, patch: MaterialPatch): Promise<void> {
  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) row.name = patch.name.trim()
  if (patch.baseUnit !== undefined) row.base_unit = patch.baseUnit.trim()
  if (patch.category !== undefined) row.category = cleanCategory(patch.category)
  if (patch.wastePct !== undefined) row.waste_pct = cleanWaste(patch.wastePct)
  if (patch.isActive !== undefined) row.is_active = patch.isActive
  if (patch.photoRequired !== undefined) row.photo_required = patch.photoRequired
  if (patch.outsideEstimate !== undefined) row.outside_estimate = patch.outsideEstimate
  await updateById('materials', id, row, MATERIAL_ERRORS)
}

/** Soft delete. Qoldig'i bor materialni baza rad etadi (`catalog_material_has_stock`). */
export function softDeleteMaterial(id: string): Promise<void> {
  return softDeleteById('materials', id, MATERIAL_ERRORS)
}
