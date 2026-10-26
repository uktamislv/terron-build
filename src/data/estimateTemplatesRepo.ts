import { toRepoError } from './errors'
import { directoryNames } from './profileDirectory'
import { getSupabase } from './supabaseClient'
import type { EstimateImportTemplate } from './types'

const TEMPLATE_COLUMNS =
  'id, company_id, name, header_signature, mapping, sheet_name, header_row, last_used_at, updated_at, created_by'

export interface TemplateInput {
  companyId: string
  name: string
  headerSignature: string
  mapping: Record<string, number>
  sheetName: string | null
  headerRow: number | null
}

/** Firmaning shu sarlavha imzosiga mos (o'chirilmagan) shabloni yoki null. */
export async function findTemplateBySignature(
  companyId: string,
  signature: string,
): Promise<EstimateImportTemplate | null> {
  const { data, error } = await getSupabase()
    .from('estimate_import_templates')
    .select(TEMPLATE_COLUMNS)
    .eq('company_id', companyId)
    .eq('header_signature', signature)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  if (error) throw toRepoError(error)
  if (!data) return null
  const { created_by, ...rest } = data as unknown as Omit<EstimateImportTemplate, 'created_by_name'> & {
    created_by: string | null
  }
  // Ism — profile_directory dan (admin bo'lmaganlar profiles dan faqat o'zini ko'radi); xato — ismsiz
  const names = await directoryNames([created_by]).catch(() => new Map<string, { full_name: string }>())
  return { ...rest, created_by_name: created_by ? (names.get(created_by)?.full_name ?? null) : null }
}

/**
 * Shablonni saqlaydi: shu imzo bilan bor bo'lsa — yangilaydi (moslash, `last_used_at`), aks holda yaratadi.
 * Bir vaqtda ikkinchi yaratish (23505) — mavjudini yangilash bilan tugaydi.
 */
export async function saveTemplate(input: TemplateInput): Promise<void> {
  const patch = {
    mapping: input.mapping,
    sheet_name: input.sheetName,
    header_row: input.headerRow,
    last_used_at: new Date().toISOString(),
  }
  const update = async (id: string) => {
    const { error } = await getSupabase().from('estimate_import_templates').update(patch).eq('id', id)
    if (error) throw toRepoError(error)
  }
  const existing = await findTemplateBySignature(input.companyId, input.headerSignature)
  if (existing) return update(existing.id)
  const { error } = await getSupabase()
    .from('estimate_import_templates')
    .insert({ company_id: input.companyId, name: input.name.trim(), header_signature: input.headerSignature, ...patch })
  if (!error) return
  if ((error as { code?: string }).code === '23505') {
    const again = await findTemplateBySignature(input.companyId, input.headerSignature)
    if (again) return update(again.id)
  }
  throw toRepoError(error)
}
