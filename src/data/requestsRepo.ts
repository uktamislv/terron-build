import { isPkeyConflict, toRepoError } from './errors'
import { updateById } from './rowUpdate'
import { getSupabase } from './supabaseClient'
import type { MaterialRequest, RequestStatus } from './types'

// numeric ustunlar `::text` — aniqlik yo'qolmasin. Embed'lar FK nomi bilan (kompozit FK'lar).
const REQUEST_COLUMNS =
  'id, company_id, object_id, material_id, unit_id, qty_input::text, unit_input, unit_variant, qty_base::text, ' +
  'status, needed_by, decided_by, decided_at, decision_note, purchase_id, note, created_by, created_at, deleted_at'
const REQUEST_SELECT =
  `${REQUEST_COLUMNS}, ` +
  'object:objects!material_requests_object_fkey(name), ' +
  'material:materials!material_requests_material_fkey(name, base_unit), ' +
  'creator:profiles!material_requests_created_by_fkey(full_name), ' +
  'decider:profiles!material_requests_decided_by_fkey(full_name)'

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
  creator: { full_name: string } | null
  decider: { full_name: string } | null
}

function normalize(raw: RawRequest): MaterialRequest {
  const { object, material, creator, decider, ...rest } = raw
  return {
    ...rest,
    object_name: object?.name ?? null,
    material_name: material?.name ?? null,
    base_unit: material?.base_unit ?? null,
    created_by_name: creator?.full_name ?? null,
    decided_by_name: decider?.full_name ?? null,
  }
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
  return normalize(data as unknown as RawRequest)
}

export async function getRequestById(id: string): Promise<MaterialRequest> {
  const { data, error } = await getSupabase().from('material_requests').select(REQUEST_SELECT).eq('id', id).single()
  if (error) throw toRepoError(error)
  return normalize(data as unknown as RawRequest)
}

/** So'rovlar ro'yxati (veb): filtrlar, yangisi birinchi, 50 tadan sahifa (0 dan). */
export async function listRequests(
  filters: RequestFilters = {},
  page = 0,
): Promise<{ rows: MaterialRequest[]; total: number }> {
  let q = getSupabase().from('material_requests').select(REQUEST_SELECT, { count: 'exact' }).is('deleted_at', null)
  if (filters.statuses && filters.statuses.length > 0) q = q.in('status', filters.statuses)
  if (filters.objectId) q = q.eq('object_id', filters.objectId)
  if (filters.materialId) q = q.eq('material_id', filters.materialId)
  const start = page * REQUESTS_PAGE_SIZE
  const { data, error, count } = await q
    .order('created_at', { ascending: false })
    .range(start, start + REQUESTS_PAGE_SIZE - 1)
  if (error) throw toRepoError(error)
  return { rows: ((data ?? []) as unknown as RawRequest[]).map(normalize), total: count ?? 0 }
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
  return ((data ?? []) as unknown as RawRequest[]).map(normalize)
}

/** Admin: tasdiqlash. `decided_by` / `decided_at` ni baza trigger'i yozadi. */
export function approveRequest(id: string): Promise<void> {
  return updateById('material_requests', id, { status: 'tasdiqlandi' })
}

/** Admin: rad etish, sabab bilan (`decision_note`). */
export function rejectRequest(id: string, reason: string): Promise<void> {
  return updateById('material_requests', id, { status: 'rad', decision_note: clean(reason, DECISION_NOTE_MAX) })
}

/** Ta'minotchi (yoki admin): "Xarid qilindi", ixtiyoriy xarid bilan bog'lab. */
export function markRequestPurchased(id: string, purchaseId: string | null): Promise<void> {
  return updateById('material_requests', id, purchaseId ? { status: 'xarid_qilindi', purchase_id: purchaseId } : { status: 'xarid_qilindi' })
}
