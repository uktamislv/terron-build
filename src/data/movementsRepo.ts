import { toRepoError } from './errors'
import { softDeleteById, updateById } from './rowUpdate'
import { getSupabase } from './supabaseClient'
import type { Movement, MovementKind } from './types'

// numeric ustunlar `::text` — aniqlik yo'qolmasin. Embed'lar FK nomi bilan (kompozit FK'lar).
const MOVEMENT_COLUMNS =
  'id, company_id, type, object_id, material_id, unit_id, qty_input::text, unit_input, unit_variant, qty_base::text, ' +
  'purchase_id, photo_path, occurred_at, note, created_by, created_at, deleted_at'
const MOVEMENT_SELECT =
  `${MOVEMENT_COLUMNS}, ` +
  'object:objects!movements_object_fkey(name), ' +
  'material:materials!movements_material_fkey(name, base_unit), ' +
  'creator:profiles!movements_created_by_fkey(full_name)'

export const MOVEMENTS_PAGE_SIZE = 50

export interface NewMovement {
  /** Klientda yaratilgan id (qoralama) — qayta urinishda ikki marta yozilmaslik uchun. */
  id: string
  companyId: string
  type: Extract<MovementKind, 'kirim' | 'chiqim'>
  objectId: string
  materialId: string
  unitId: string
  /** Dec satr ("3", "1.5"). `qty_base` yuborilmaydi — bazadagi trigger hisoblaydi. */
  qtyInput: string
  note?: string | null
  photoPath?: string | null
  /** ISO; berilmasa — server `now()`. */
  occurredAt?: string | null
}

export interface MovementFilters {
  objectId?: string
  materialId?: string
  type?: MovementKind
  /** ISO, shu vaqtdan (kiritilgan) */
  from?: string
  /** ISO, shu vaqtgacha (kiritilmagan) */
  to?: string
  createdBy?: string
  /** Admin: o'chirilganlarni ham ko'rsatish (RLS boshqalarga baribir ko'rsatmaydi). */
  includeDeleted?: boolean
}

export interface MovementPage {
  rows: Movement[]
  total: number
}

type RawMovement = Omit<Movement, 'object_name' | 'material_name' | 'base_unit' | 'created_by_name'> & {
  object: { name: string } | null
  material: { name: string; base_unit: string } | null
  creator: { full_name: string } | null
}

function normalize(raw: RawMovement): Movement {
  const { object, material, creator, ...rest } = raw
  return {
    ...rest,
    object_name: object?.name ?? null,
    material_name: material?.name ?? null,
    base_unit: material?.base_unit ?? null,
    created_by_name: creator?.full_name ?? null,
  }
}

function clean(value: string | null | undefined): string | null {
  const v = value?.trim()
  return v ? v : null
}

/**
 * Kirim/chiqim yaratadi. Javob — saqlangan qator (bazada hisoblangan `qty_base` bilan).
 * Idempotent: oldingi urinish aslida saqlangan bo'lsa (javob yo'qolgan), shu `id` bilan 23505 keladi —
 * unda saqlangan qator o'qib qaytariladi.
 */
export async function createMovement(input: NewMovement): Promise<Movement> {
  const row: Record<string, unknown> = {
    id: input.id,
    company_id: input.companyId,
    type: input.type,
    object_id: input.objectId,
    material_id: input.materialId,
    unit_id: input.unitId,
    qty_input: input.qtyInput,
    note: clean(input.note),
    photo_path: clean(input.photoPath),
  }
  if (input.occurredAt) row.occurred_at = input.occurredAt
  const { data, error } = await getSupabase().from('movements').insert(row).select(MOVEMENT_SELECT).single()
  if (error) {
    if (isOwnPkeyConflict(error)) {
      const existing = await getMovementById(input.id).catch(() => null)
      if (existing) return existing
    }
    throw toRepoError(error)
  }
  return normalize(data as unknown as RawMovement)
}

/**
 * Shu `id` bilan qator allaqachon bor (oldingi urinish saqlangan): 23505, hint'siz va aynan
 * birlamchi kalit (`movements_pkey`). Hint'li 23505 (masalan `ops_photo_reused`) — oddiy xato.
 */
function isOwnPkeyConflict(error: unknown): boolean {
  const e = error as { code?: string; hint?: string | null; message?: string; details?: string | null }
  if (e.code !== '23505' || e.hint) return false
  return `${e.message ?? ''} ${e.details ?? ''}`.includes('movements_pkey')
}

export async function getMovementById(id: string): Promise<Movement> {
  const { data, error } = await getSupabase().from('movements').select(MOVEMENT_SELECT).eq('id', id).single()
  if (error) throw toRepoError(error)
  return normalize(data as unknown as RawMovement)
}

/** Harakatlar jadvali: filtrlar, `occurred_at` bo'yicha yangisi birinchi, 50 tadan sahifa (0 dan). */
export async function listMovements(filters: MovementFilters = {}, page = 0): Promise<MovementPage> {
  let q = getSupabase().from('movements').select(MOVEMENT_SELECT, { count: 'exact' })
  if (!filters.includeDeleted) q = q.is('deleted_at', null)
  if (filters.objectId) q = q.eq('object_id', filters.objectId)
  if (filters.materialId) q = q.eq('material_id', filters.materialId)
  if (filters.type) q = q.eq('type', filters.type)
  if (filters.createdBy) q = q.eq('created_by', filters.createdBy)
  if (filters.from) q = q.gte('occurred_at', filters.from)
  if (filters.to) q = q.lt('occurred_at', filters.to)
  const start = page * MOVEMENTS_PAGE_SIZE
  const { data, error, count } = await q
    .order('occurred_at', { ascending: false })
    .order('created_at', { ascending: false })
    .range(start, start + MOVEMENTS_PAGE_SIZE - 1)
  if (error) throw toRepoError(error)
  return { rows: ((data ?? []) as unknown as RawMovement[]).map(normalize), total: count ?? 0 }
}

/**
 * Foydalanuvchining o'zi kiritgan oxirgi yozuvlari (Mini App "Mening yozuvlarim").
 * O'chirilganlari ham (RLS ko'rsatgan bo'lsa) — "o'chirilgan" belgisi bilan.
 */
export async function listMyMovements(profileId: string, limit = 50): Promise<Movement[]> {
  const { data, error } = await getSupabase()
    .from('movements')
    .select(MOVEMENT_SELECT)
    .eq('created_by', profileId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw toRepoError(error)
  return ((data ?? []) as unknown as RawMovement[]).map(normalize)
}

export function softDeleteMovement(id: string): Promise<void> {
  return softDeleteById('movements', id)
}

/** Tiklash — faqat admin (baza `restore_admin_only`). */
export function restoreMovement(id: string): Promise<void> {
  return updateById('movements', id, { deleted_at: null })
}
