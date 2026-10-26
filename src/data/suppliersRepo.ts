import { isPkeyConflict, RepoError, toRepoError } from './errors'
import { softDeleteById, updateById } from './rowUpdate'
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

/** Admin (Sotuvchilar bo'limi): o'chirilganlari ham — tiklash uchun. */
export async function listAllSuppliers(includeDeleted = false): Promise<Supplier[]> {
  let q = getSupabase().from('suppliers').select(SUPPLIER_COLUMNS)
  if (!includeDeleted) q = q.is('deleted_at', null)
  const { data, error } = await q.order('name')
  if (error) throw toRepoError(error)
  return (data ?? []) as Supplier[]
}

export interface SupplierPatch {
  name?: string
  phone?: string | null
  /** STIR: 9–14 raqam; bo'sh — o'chiriladi. */
  tin?: string | null
  note?: string | null
}

function blankToNull(v: string | null | undefined, max: number): string | null {
  const s = (v ?? '').trim().slice(0, max)
  return s ? s : null
}

/** Admin: sotuvchi nomi, telefoni, STIR va izohini o'zgartirish. Faqat berilgan maydonlar yoziladi. */
export function supplierPatchToRow(patch: SupplierPatch): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) {
    const name = patch.name.trim().replace(/\s+/g, ' ')
    if (!name) throw new RepoError('invalid_value')
    row.name = name
  }
  if (patch.phone !== undefined) row.phone = blankToNull(patch.phone, 50)
  if (patch.tin !== undefined) {
    const raw = (patch.tin ?? '').trim()
    const tin = cleanTin(raw)
    if (raw && !tin) throw new RepoError('invalid_value')
    row.tin = tin
  }
  if (patch.note !== undefined) row.note = blankToNull(patch.note, 1000)
  return row
}

export function updateSupplier(id: string, patch: SupplierPatch): Promise<void> {
  return updateById('suppliers', id, supplierPatchToRow(patch))
}

/**
 * Ikki sotuvchini birlashtirish (RPC `merge_suppliers`): `mergeId` ning xaridlari `keepId` ga o'tadi,
 * `mergeId` o'chiriladi. Natija — ko'chirilgan xaridlar soni.
 */
export async function mergeSuppliers(keepId: string, mergeId: string): Promise<number> {
  const { data, error } = await getSupabase().rpc('merge_suppliers', { p_keep: keepId, p_merge: mergeId })
  if (error) throw toRepoError(error)
  return Number(data ?? 0) || 0
}

export function softDeleteSupplier(id: string): Promise<void> {
  return softDeleteById('suppliers', id)
}

/** Tiklash — faqat admin (`restore_admin_only`). */
export function restoreSupplier(id: string): Promise<void> {
  return updateById('suppliers', id, { deleted_at: null })
}

async function findSupplier(id: string, name: string): Promise<Supplier | null> {
  const byId = await getSupabase().from('suppliers').select(SUPPLIER_COLUMNS).eq('id', id).maybeSingle()
  if (byId.data) return byId.data as Supplier
  const key = supplierKey(name)
  return (await listSuppliers()).find((s) => supplierKey(s.name) === key) ?? null
}

/** Sotuvchilar bo'yicha (o'chirilmagan) xaridlar soni — birlashtirish oynasi uchun. RLS — o'z firmasi. */
export async function countPurchasesBySupplier(): Promise<Map<string, number>> {
  const { data, error } = await getSupabase()
    .from('purchases')
    .select('supplier_id')
    .is('deleted_at', null)
    .not('supplier_id', 'is', null)
    .limit(50000)
  if (error) throw toRepoError(error)
  const counts = new Map<string, number>()
  for (const row of (data ?? []) as { supplier_id: string | null }[]) {
    if (row.supplier_id) counts.set(row.supplier_id, (counts.get(row.supplier_id) ?? 0) + 1)
  }
  return counts
}
