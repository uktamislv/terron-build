// UPDATE ... WHERE id = ? — jim muvaffaqiyatsizlikdan himoya.
// PostgREST RLS yoki noto'g'ri id tufayli hech qanday qator yangilanmasa ham xato qaytarmaydi.
// Shuning uchun `select('id').single()`: qator qaytmasa — PGRST116 → `not_found`.
import { toRepoError, type RepoErrorCode } from './errors'
import { getSupabase } from './supabaseClient'

type Overrides = Partial<Record<string, RepoErrorCode>>

export async function updateById(
  table: string,
  id: string,
  row: Record<string, unknown>,
  overrides: Overrides = {},
): Promise<void> {
  const { error } = await getSupabase().from(table).update(row).eq('id', id).select('id').single()
  if (error) throw toRepoError(error, overrides)
}

/**
 * Soft delete. `deleted_at` ga klient vaqti yuboriladi — baza uni trigger orqali `now()` bilan
 * almashtiradi (klient soatiga ishonilmaydi), lekin qiymat null bo'lmasligi shart: aynan shu
 * "o'chirildi" belgisi.
 */
export function softDeleteById(table: string, id: string, overrides: Overrides = {}): Promise<void> {
  return updateById(table, id, { deleted_at: new Date().toISOString() }, overrides)
}
