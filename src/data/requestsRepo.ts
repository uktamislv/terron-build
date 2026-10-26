import { isPkeyConflict, toRepoError } from './errors'
import { chunkOpts, fetchAll, type ChunkOpts } from './fetchAll'
import { updateById } from './rowUpdate'
import { attachNames } from './profileDirectory'
import { getSupabase } from './supabaseClient'
import type { MaterialRequest, RequestStatus } from './types'

// numeric ustunlar `::text` — aniqlik yo'qolmasin. Embed'lar FK nomi bilan (kompozit FK'lar).
const REQUEST_COLUMNS =
  'id, company_id, object_id, material_id, unit_id, qty_input::text, unit_input, unit_variant, qty_base::text, ' +
  'status, needed_by, decided_by, decided_at, decision_note, purchase_id, note, created_by, created_at, deleted_at'
const REQUEST_SELECT =
  `${REQUEST_COLUMNS}, ` +
  'object:objects!material_requests_object_fkey(name), ' +
  'material:materials!material_requests_material_fkey(name, base_unit)'

export const REQUESTS_PAGE_SIZE = 50
export const DECISION_NOTE_MAX = 500

export interface NewRequest {
  /** Klientda yaratilgan id (qoralama) — qayta urinishda ikki marta yozilmaslik uchun. */
  id: string
  companyId: string
  objectId: string
  materialId: string
  unitId: string
  /** Dec satr. `qty_base` — baza hisoblaydi. */
  qtyInput: string
  /** `yyyy-mm-dd` yoki null. */
  neededBy?: string | null
  note?: string | null
}

export interface RequestFilters {
  statuses?: RequestStatus[]
  objectId?: string
  materialId?: string
}

type RawRequest = Omit<MaterialRequest, 'object_name' | 'material_name' | 'base_unit' | 'created_by_name' | 'decided_by_name'> & {
  object: { name: string } | null
  material: { name: string; base_unit: string } | null
}

function normalize(raw: RawRequest): MaterialRequest {
  const { object, material, ...rest } = raw
  return {
    ...rest,
    object_name: object?.name ?? null,
    material_name: material?.name ?? null,
    base_unit: material?.base_unit ?? null,
    created_by_name: null,
    decided_by_name: null,
  }
}

/** Kiritgan va hal qilgan ismlari — `profile_directory` dan. */
function withNames(rows: MaterialRequest[]): Promise<MaterialRequest[]> {
  return attachNames(rows, [
    ['created_by', 'created_by_name'],
    ['decided_by', 'decided_by_name'],
  ])
}

async function one(raw: unknown): Promise<MaterialRequest> {
  const [row] = await withNames([normalize(raw as RawRequest)])
  return row as MaterialRequest
}

function clean(value: string | null | undefined, max = 1000): string | null {
  const v = value?.trim().slice(0, max)
  return v ? v : null
}

/**
 * So'rov yaratadi (holat — `kutilmoqda`). Idempotent: oldingi urinish saqlangan bo'lsa (javob yo'qolgan),
 * shu `id` bilan `material_requests_pkey` 23505 keladi — saqlangan qator o'qib qaytariladi.
 */
export async function createRequest(input: NewRequest): Promise<MaterialRequest> {
  const row: Record<string, unknown> = {
    id: input.id,
    company_id: input.companyId,
    object_id: input.objectId,
    material_id: input.materialId,
    unit_id: input.unitId,
    qty_input: input.qtyInput,
    needed_by: input.neededBy || null,
    note: clean(input.note),
  }
  const { data, error } = await getSupabase().from('material_requests').insert(row).select(REQUEST_SELECT).single()
  if (error) {
    if (isPkeyConflict(error, 'material_requests_pkey')) {
      const existing = await getRequestById(input.id).catch(() => null)
      if (existing) return existing
    }
    throw toRepoError(error)
  }
  return one(data)
}

export async function getRequestById(id: string): Promise<MaterialRequest> {
  const { data, error } = await getSupabase().from('material_requests').select(REQUEST_SELECT).eq('id', id).single()
  if (error) throw toRepoError(error)
  return one(data)
}

/** So'rovlar ro'yxati (veb): filtrlar, yangisi birinchi, 50 tadan sahifa (0 dan). */
export async function listRequests(
  filters: RequestFilters = {},
  page = 0,
): Promise<{ rows: MaterialRequest[]; total: number }> {
  const start = page * REQUESTS_PAGE_SIZE
  const r = await loadRequests(filters, start, start + REQUESTS_PAGE_SIZE - 1)
  return { rows: r.rows, total: r.total ?? 0 }
}

/** Eksport: joriy filtr bo'yicha barcha so'rovlar (1000 tadan, ≤ 50 000). */
export function listAllRequests(filters: RequestFilters = {}, signal?: AbortSignal): Promise<MaterialRequest[]> {
  return fetchAll((req) => loadRequests(filters, req.from, req.to, chunkOpts(req)), { signal })
}

async function loadRequests(
  filters: RequestFilters,
  from: number,
  to: number,
  opts: ChunkOpts = { count: true },
): Promise<{ rows: MaterialRequest[]; total: number | null }> {
  let q = getSupabase().from('material_requests').select(REQUEST_SELECT, opts.count ? { count: 'exact' } : undefined).is('deleted_at', null)
  if (filters.statuses && filters.statuses.length > 0) q = q.in('status', filters.statuses)
  if (filters.objectId) q = q.eq('object_id', filters.objectId)
  if (filters.materialId) q = q.eq('material_id', filters.materialId)
  if (opts.before) q = q.lte('created_at', opts.before)
  let ranged = q.order('created_at', { ascending: false }).order('id').range(from, to)
  if (opts.signal) ranged = ranged.abortSignal(opts.signal)
  const { data, error, count } = await ranged
  if (error) throw toRepoError(error)
  return { rows: await withNames(((data ?? []) as unknown as RawRequest[]).map(normalize)), total: count ?? null }
}

/** Mening so'rovlarim (Mini App), yangisi birinchi. */
export async function listMyRequests(profileId: string, limit = 50): Promise<MaterialRequest[]> {
  const { data, error } = await getSupabase()
    .from('material_requests')
    .select(REQUEST_SELECT)
    .eq('created_by', profileId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw toRepoError(error)
  return withNames(((data ?? []) as unknown as RawRequest[]).map(normalize))
}

/** Admin: tasdiqlash (ixtiyoriy izoh). `decided_by` / `decided_at` ni baza trigger'i yozadi. */
export function approveRequest(id: string, note?: string | null): Promise<void> {
  const decision = clean(note, DECISION_NOTE_MAX)
  return updateById('material_requests', id, decision ? { status: 'tasdiqlandi', decision_note: decision } : { status: 'tasdiqlandi' })
}

/** Admin: rad etish, sabab bilan (`decision_note`). */
export function rejectRequest(id: string, reason: string): Promise<void> {
  return updateById('material_requests', id, { status: 'rad', decision_note: clean(reason, DECISION_NOTE_MAX) })
}

/** Ta'minotchi (yoki admin): "Xarid qilindi", ixtiyoriy xarid bilan bog'lab. */
export function markRequestPurchased(id: string, purchaseId: string | null): Promise<void> {
  return updateById('material_requests', id, purchaseId ? { status: 'xarid_qilindi', purchase_id: purchaseId } : { status: 'xarid_qilindi' })
}

/**
 * Batch 12 (H): obyektning tasdiqlangan (hali xarid qilinmagan) so'rovlari — xarid ekranidagi chiplar.
 * Eskisi birinchi (kutayotgan vaqti uzoqroq).
 */
export async function listApprovedRequests(objectId: string, limit = 20): Promise<MaterialRequest[]> {
  const { data, error } = await getSupabase()
    .from('material_requests')
    .select(REQUEST_SELECT)
    .eq('object_id', objectId)
    .eq('status', 'tasdiqlandi')
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw toRepoError(error)
  return withNames(((data ?? []) as unknown as RawRequest[]).map(normalize))
}
