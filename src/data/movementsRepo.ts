import { decEq, ensureSameDraft } from './draftConflict'
import { isPkeyConflict, toRepoError } from './errors'
import { chunkOpts, fetchAll, type ChunkOpts } from './fetchAll'
import { softDeleteById, updateById } from './rowUpdate'
import { geoColumns, GEO_SELECT } from './geo'
import { attachNames } from './profileDirectory'
import { scopeCompany } from './companyScope'
import { getSupabase } from './supabaseClient'
import type { GeoFix, Movement, MovementKind } from './types'

// numeric ustunlar `::text` — aniqlik yo'qolmasin. Embed'lar FK nomi bilan (kompozit FK'lar).
const MOVEMENT_COLUMNS =
  'id, company_id, type, object_id, material_id, unit_id, qty_input::text, unit_input, unit_variant, qty_base::text, ' +
  'purchase_id, transfer_id, inventory_count_id, photo_path, photo_sha256, occurred_at, note, created_by, created_at, deleted_at, ' +
  GEO_SELECT
const MOVEMENT_SELECT =
  `${MOVEMENT_COLUMNS}, ` +
  'object:objects!movements_object_fkey(name), ' +
  'material:materials!movements_material_fkey(name, base_unit)'

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
  /** Faqat kirim: bog'langan xarid (`open_purchases` dan tanlangan). */
  purchaseId?: string | null
  /** Batch 12 (D): Mini App joylashuvi; veb — berilmaydi. */
  geo?: GeoFix | null
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
  /** Shu xaridga bog'langan harakatlar (xarid tafsiloti). */
  purchaseId?: string
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
}

function normalize(raw: RawMovement): Movement {
  const { object, material, ...rest } = raw
  return {
    ...rest,
    object_name: object?.name ?? null,
    material_name: material?.name ?? null,
    base_unit: material?.base_unit ?? null,
    created_by_name: null,
  }
}

/** Kiritgan ismi — `profile_directory` dan (admin bo'lmaganlar `profiles` dan faqat o'zini ko'radi). */
function withNames(rows: Movement[]): Promise<Movement[]> {
  return attachNames(rows, [['created_by', 'created_by_name']])
}

async function one(raw: unknown): Promise<Movement> {
  const [row] = await withNames([normalize(raw as RawMovement)])
  return row as Movement
}

function clean(value: string | null | undefined): string | null {
  const v = value?.trim()
  return v ? v : null
}

/**
 * Kirim/chiqim yaratadi. Javob — saqlangan qator (bazada hisoblangan `qty_base` bilan).
 * Idempotent: oldingi urinish aslida saqlangan bo'lsa (javob yo'qolgan), shu `id` bilan 23505 keladi —
 * unda saqlangan qator o'qib qaytariladi. U boshqa yozuv bo'lsa (tur, obyekt, material, birlik yoki miqdor
 * farq qiladi) — `draft_conflict`.
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
    ...geoColumns(input.geo),
  }
  // Rasm xeshi klientdan yuborilmaydi (server e'tiborsiz qoldiradi) — saqlangandan keyin
  // `photo-hash` Edge Function hisoblaydi (functions.ts → requestPhotoHash)
  if (input.occurredAt) row.occurred_at = input.occurredAt
  // Xarid bilan bog'lash faqat kirimda (bazadagi trigger material va obyekt mosligini tekshiradi)
  if (input.purchaseId && input.type === 'kirim') row.purchase_id = input.purchaseId
  const { data, error } = await getSupabase().from('movements').insert(row).select(MOVEMENT_SELECT).single()
  if (error) {
    if (isPkeyConflict(error, 'movements_pkey')) {
      const existing = await getMovementById(input.id).catch(() => null)
      if (existing) {
        return ensureSameDraft(
          existing,
          existing.type === input.type &&
            existing.object_id === input.objectId &&
            existing.material_id === input.materialId &&
            existing.unit_id === input.unitId &&
            decEq(existing.qty_input, input.qtyInput),
        )
      }
    }
    throw toRepoError(error)
  }
  return one(data)
}

export async function getMovementById(id: string): Promise<Movement> {
  const { data, error } = await getSupabase().from('movements').select(MOVEMENT_SELECT).eq('id', id).single()
  if (error) throw toRepoError(error)
  return one(data)
}

/** Harakatlar jadvali: filtrlar, `occurred_at` bo'yicha yangisi birinchi, 50 tadan sahifa (0 dan). */
export async function listMovements(filters: MovementFilters = {}, page = 0): Promise<MovementPage> {
  const start = page * MOVEMENTS_PAGE_SIZE
  const r = await loadMovements(filters, start, start + MOVEMENTS_PAGE_SIZE - 1)
  return { rows: r.rows, total: r.total ?? 0 }
}

/** Eksport: joriy filtr bo'yicha barcha qatorlar (1000 tadan, ≤ 50 000). */
export function listAllMovements(filters: MovementFilters = {}, signal?: AbortSignal): Promise<Movement[]> {
  return fetchAll((req) => loadMovements(filters, req.from, req.to, chunkOpts(req)), { signal })
}

async function loadMovements(
  filters: MovementFilters,
  from: number,
  to: number,
  opts: ChunkOpts = { count: true },
): Promise<{ rows: Movement[]; total: number | null }> {
  let q = scopeCompany(getSupabase().from('movements').select(MOVEMENT_SELECT, opts.count ? { count: 'exact' } : undefined))
  if (!filters.includeDeleted) q = q.is('deleted_at', null)
  if (filters.objectId) q = q.eq('object_id', filters.objectId)
  if (filters.materialId) q = q.eq('material_id', filters.materialId)
  if (filters.type) q = q.eq('type', filters.type)
  if (filters.createdBy) q = q.eq('created_by', filters.createdBy)
  if (filters.purchaseId) q = q.eq('purchase_id', filters.purchaseId)
  if (filters.from) q = q.gte('occurred_at', filters.from)
  if (filters.to) q = q.lt('occurred_at', filters.to)
  if (opts.before) q = q.lte('created_at', opts.before)
  let ranged = q
    .order('occurred_at', { ascending: false })
    .order('created_at', { ascending: false })
    .order('id')
    .range(from, to)
  if (opts.signal) ranged = ranged.abortSignal(opts.signal)
  const { data, error, count } = await ranged
  if (error) throw toRepoError(error)
  return { rows: await withNames(((data ?? []) as unknown as RawMovement[]).map(normalize)), total: count ?? null }
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
  return withNames(((data ?? []) as unknown as RawMovement[]).map(normalize))
}

export function softDeleteMovement(id: string): Promise<void> {
  return softDeleteById('movements', id)
}

/** Tiklash — faqat admin (baza `restore_admin_only`). */
export function restoreMovement(id: string): Promise<void> {
  return updateById('movements', id, { deleted_at: null })
}
