// Firma xodimlari ro'yxati (`public.profile_directory` view): id, ism, rol, faollik — telefon va
// Telegram ma'lumotlarisiz. Admin bo'lmagan rollar `profiles` dan faqat o'z qatorini ko'radi
// (docs/audit-fixes.md, "Profillar"), shuning uchun boshqalarning ismi shu view'dan olinadi.
// View orqali PostgREST embed (FK) kafolatlanmagan — ismlar ikkinchi so'rov bilan biriktiriladi.
import type { Role } from '@/domain/roles'
import { toRepoError } from './errors'
import { inChunks } from './fetchAll'
import { scopeCompany } from './companyScope'
import { getSupabase } from './supabaseClient'

export const DIRECTORY_COLUMNS = 'id, company_id, full_name, role, is_active, is_available'

/** `profile_directory` qatori. O'chirilgan profillar ham bor (tarixdagi ismlar uchun). */
export interface DirectoryProfile {
  id: string
  company_id: string
  full_name: string
  role: Role
  is_active: boolean
  /**
   * Tanlash mumkinmi (faol, o'chirilmagan, firma faol) — tanlash ro'yxatlari (xaridor, pul oluvchi) shunga
   * tayanadi. Eski javobda yo'q bo'lsa — is_active.
   */
  is_available?: boolean
}

/** Tanlash ro'yxatiga qo'yish mumkinmi (is_available, bo'lmasa is_active). */
export function isAvailable(p: Pick<DirectoryProfile, 'is_active' | 'is_available'>): boolean {
  return p.is_available ?? p.is_active
}

/** Firma xodimlari (o'chirilganlari ham — view filtrlamaydi), ism bo'yicha. */
export async function listDirectory(): Promise<DirectoryProfile[]> {
  const { data, error } = await scopeCompany(getSupabase().from('profile_directory').select(DIRECTORY_COLUMNS)).order('full_name')
  if (error) throw toRepoError(error)
  return (data ?? []) as DirectoryProfile[]
}

/** Tanlash mumkin bo'lgan xodimlar (is_available), ixtiyoriy rol filtri bilan. */
export async function listActiveDirectory(roles?: readonly Role[]): Promise<DirectoryProfile[]> {
  const all = await listDirectory()
  return all.filter((p) => isAvailable(p) && (!roles || roles.includes(p.role)))
}

/** Berilgan id'lar bo'yicha ismlar (id → ism). Bo'sh/null id'lar tashlanadi. */
export async function directoryNames(ids: readonly (string | null | undefined)[]): Promise<Map<string, DirectoryProfile>> {
  const wanted = ids.filter((id): id is string => typeof id === 'string' && id !== '')
  const result = new Map<string, DirectoryProfile>()
  if (wanted.length === 0) return result
  const rows = await inChunks(wanted, async (chunk) => {
    const { data, error } = await getSupabase().from('profile_directory').select(DIRECTORY_COLUMNS).in('id', chunk)
    if (error) throw toRepoError(error)
    return (data ?? []) as DirectoryProfile[]
  })
  for (const r of rows) result.set(r.id, r)
  return result
}

/**
 * Qatorlarga ism biriktiradi: `pairs` — [id ustuni, ism maydoni]. Masalan
 * `[['created_by', 'created_by_name']]`. Ism topilmasa — null. Bitta so'rov (bo'laklab).
 */
export async function attachNames<T extends object>(
  rows: T[],
  pairs: readonly (readonly [keyof T & string, keyof T & string])[],
): Promise<T[]> {
  if (rows.length === 0) return rows
  const ids: (string | null)[] = []
  for (const row of rows) {
    for (const [idKey] of pairs) {
      const v = (row as Record<string, unknown>)[idKey]
      ids.push(typeof v === 'string' ? v : null)
    }
  }
  const names = await directoryNames(ids)
  return rows.map((row) => {
    const next = { ...row } as Record<string, unknown>
    for (const [idKey, nameKey] of pairs) {
      const id = next[idKey]
      next[nameKey] = typeof id === 'string' ? (names.get(id)?.full_name ?? null) : null
    }
    return next as T
  })
}

/** `attachNames` + rol (xatolik xabarlari muallifi uchun). */
export async function attachNameAndRole<T extends object>(
  rows: T[],
  idKey: keyof T & string,
  nameKey: keyof T & string,
  roleKey: keyof T & string,
): Promise<T[]> {
  if (rows.length === 0) return rows
  const names = await directoryNames(rows.map((r) => (r as Record<string, unknown>)[idKey] as string | null))
  return rows.map((row) => {
    const next = { ...row } as Record<string, unknown>
    const id = next[idKey]
    const p = typeof id === 'string' ? names.get(id) : undefined
    next[nameKey] = p?.full_name ?? null
    next[roleKey] = p?.role ?? null
    return next as T
  })
}
