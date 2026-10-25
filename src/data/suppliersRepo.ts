import { isPkeyConflict, RepoError, toRepoError } from './errors'
import { getSupabase } from './supabaseClient'
import type { Supplier } from './types'

const SUPPLIER_COLUMNS = 'id, company_id, name, phone, note, tin, created_at, deleted_at'

/** Sotuvchi nomini solishtirish uchun: bo'sh joylar qisqartiriladi, katta-kichik harf farqsiz. */
export function supplierKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('uz')
}

/** STIR: faqat raqamlar, 9–14 xona (baza tekshiruvi bilan bir xil); boshqasi — null. */
export function cleanTin(tin: string | null | undefined): string | null {
  const v = (tin ?? '').replace(/\D/g, '')
  return v.length >= 9 && v.length <= 14 ? v : null
}

/** STIR bo'yicha sotuvchi (ro'yxatdan). */
export function findByTin(list: Supplier[], tin: string | null | undefined): Supplier | null {
  const key = cleanTin(tin)
  return key ? (list.find((s) => cleanTin(s.tin) === key) ?? null) : null
}

/** Firma sotuvchilari (o'chirilmaganlar), nom bo'yicha. */
export async function listSuppliers(): Promise<Supplier[]> {
  const { data, error } = await getSupabase()
    .from('suppliers')
    .select(SUPPLIER_COLUMNS)
    .is('deleted_at', null)
    .order('name')
  if (error) throw toRepoError(error)
  return (data ?? []) as Supplier[]
}

export interface NewSupplier {
  /** Klient id'si — qayta urinishda ikki marta yaratilmasin. */
  id: string
  companyId: string
  name: string
  /** Batch 12 (G): STIR (chek QR'dan). */
  tin?: string | null
}

/**
 * Yangi sotuvchi. Idempotent (`suppliers_pkey` 23505 → saqlangan qator).
 * Shu nomli sotuvchi allaqachon bor bo'lsa (hint `supplier_duplicate`) — o'sha qator qaytariladi.
 */
export async function createSupplier(input: NewSupplier): Promise<Supplier> {
  const name = input.name.trim().replace(/\s+/g, ' ')
  if (!name) throw new RepoError('invalid_value')
  const { data, error } = await getSupabase()
    .from('suppliers')
    .insert({ id: input.id, company_id: input.companyId, name, ...(cleanTin(input.tin) ? { tin: cleanTin(input.tin) } : {}) })
    .select(SUPPLIER_COLUMNS)
    .single()
  if (!error) return data as Supplier
  const repoError = toRepoError(error)
  if (isPkeyConflict(error, 'suppliers_pkey') || repoError.code === 'supplier_duplicate') {
    const existing = await findSupplier(input.id, name).catch(() => null)
    if (existing) return existing
  }
  // Shu STIR li sotuvchi bor (Batch 12) — o'sha qator
  if (repoError.code === 'supplier_tin_duplicate') {
    const byTin = await listSuppliers()
      .then((list) => findByTin(list, input.tin))
      .catch(() => null)
    if (byTin) return byTin
  }
  throw repoError
}

async function findSupplier(id: string, name: string): Promise<Supplier | null> {
  const byId = await getSupabase().from('suppliers').select(SUPPLIER_COLUMNS).eq('id', id).maybeSingle()
  if (byId.data) return byId.data as Supplier
  const key = supplierKey(name)
  return (await listSuppliers()).find((s) => supplierKey(s.name) === key) ?? null
}
