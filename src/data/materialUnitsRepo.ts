import { toRepoError } from './errors'
import { UNIT_COLUMNS } from './materialsRepo'
import { softDeleteById } from './rowUpdate'
import { getSupabase } from './supabaseClient'
import type { MaterialUnit } from './types'

const UNIT_ERRORS = { '23505': 'unit_taken' } as const

export interface NewMaterialUnit {
  companyId: string
  materialId: string
  unit: string
  /** Dec satr, masalan "50" yoki "0.6667" — float'ga aylantirilmaydi. */
  factor: string
  variant?: string | null
}

export interface MaterialUnitPatch {
  unit?: string
  factor?: string
  variant?: string | null
}

function cleanVariant(variant: string | null | undefined): string | null {
  const value = variant?.trim()
  return value ? value : null
}

export async function addMaterialUnit(input: NewMaterialUnit): Promise<MaterialUnit> {
  const row = {
    company_id: input.companyId,
    material_id: input.materialId,
    unit: input.unit.trim(),
    factor: input.factor,
    variant: cleanVariant(input.variant),
  }
  const { data, error } = await getSupabase().from('material_units').insert(row).select(UNIT_COLUMNS).single()
  if (error) throw toRepoError(error, UNIT_ERRORS)
  return data as unknown as MaterialUnit
}

/** Asosiy birlikni va ishlatilgan birlik koeffitsientini baza o'zgartirtirmaydi (o'zbekcha xabar). */
export async function updateMaterialUnit(id: string, patch: MaterialUnitPatch): Promise<MaterialUnit> {
  const row: Record<string, unknown> = {}
  if (patch.unit !== undefined) row.unit = patch.unit.trim()
  if (patch.factor !== undefined) row.factor = patch.factor
  if (patch.variant !== undefined) row.variant = cleanVariant(patch.variant)
  const { data, error } = await getSupabase()
    .from('material_units')
    .update(row)
    .eq('id', id)
    .select(UNIT_COLUMNS)
    .single()
  if (error) throw toRepoError(error, UNIT_ERRORS)
  return data as unknown as MaterialUnit
}

export function softDeleteMaterialUnit(id: string): Promise<void> {
  return softDeleteById('material_units', id, UNIT_ERRORS)
}
