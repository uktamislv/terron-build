import { toRepoError } from './errors'
import { ALIAS_COLUMNS } from './materialsRepo'
import { softDeleteById } from './rowUpdate'
import { getSupabase } from './supabaseClient'
import type { AliasLang, MaterialAlias } from './types'

const ALIAS_ERRORS = { '23505': 'alias_taken' } as const

export interface NewMaterialAlias {
  companyId: string
  materialId: string
  alias: string
  lang: AliasLang
}

export async function addMaterialAlias(input: NewMaterialAlias): Promise<MaterialAlias> {
  const row = {
    company_id: input.companyId,
    material_id: input.materialId,
    alias: input.alias.trim(),
    lang: input.lang,
  }
  const { data, error } = await getSupabase().from('material_aliases').insert(row).select(ALIAS_COLUMNS).single()
  if (error) throw toRepoError(error, ALIAS_ERRORS)
  return data as MaterialAlias
}

export function softDeleteMaterialAlias(id: string): Promise<void> {
  return softDeleteById('material_aliases', id, ALIAS_ERRORS)
}
