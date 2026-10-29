import { isPkeyConflict, toRepoError } from './errors'
import { inChunks } from './fetchAll'
import { attachNames } from './profileDirectory'
import { scopeCompany } from './companyScope'
import { getSupabase } from './supabaseClient'
import type { InventoryCount, InventoryCountItem, InventoryDetailRow, InventoryStatus } from './types'

const COUNT_COLUMNS =
  'id, company_id, object_id, status, counted_at, note, applied_at, applied_by, created_by, created_at, updated_at'
const COUNT_SELECT =
  `${COUNT_COLUMNS}, ` +
  'object:objects!inventory_counts_object_fkey(name)'
// `qty_expected` SO'RALMAYDI: tekshiruvchiga ustun yopiq (42501) — ko'r-ko'rona sanash. Natija — RPC'lar orqali.
const ITEM_SELECT =
  'id, inventory_count_id, material_id, qty_counted::text, qty_input::text, unit_id, updated_at, ' +
  'material:materials!inventory_count_items_material_fkey(name, base_unit)'

export const COUNTS_PAGE_SIZE = 50

type RawCount = Omit<InventoryCount, 'object_name' | 'created_by_name' | 'item_count'> & {
  object: { name: string } | null
}

type RawItem = Omit<InventoryCountItem, 'material_name' | 'base_unit' | 'qty_expected'> & {
  material: { name: string; base_unit: string } | null
}

function normalizeCount(raw: RawCount, itemCount = 0): InventoryCount {
  const { object, ...rest } = raw
  return { ...rest, object_name: object?.name ?? null, created_by_name: null, item_count: itemCount }
}

/** Kiritgan ismi — `profile_directory` dan. */
function withNames(rows: InventoryCount[]): Promise<InventoryCount[]> {
  return attachNames(rows, [['created_by', 'created_by_name']])
}

function normalizeItem(raw: RawItem): InventoryCountItem {
  const { material, ...rest } = raw
  return { ...rest, qty_expected: null, material_name: material?.name ?? null, base_unit: material?.base_unit ?? null }
}

async function itemCounts(countIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  if (countIds.length === 0) return result
  const data = await inChunks(countIds, async (chunk) => {
    const { data: part, error } = await getSupabase()
      .from('inventory_count_items')
      .select('inventory_count_id')
      .in('inventory_count_id', chunk)
      .is('deleted_at', null)
    if (error) throw toRepoError(error)
    return (part ?? []) as { inventory_count_id: string }[]
  })
  for (const r of data) {
    result.set(r.inventory_count_id, (result.get(r.inventory_count_id) ?? 0) + 1)
  }
  return result
}

export interface CountFilters {
  objectId?: string
  status?: InventoryStatus
  createdBy?: string
}

/** Inventarizatsiya hisoblari, yangisi birinchi (qatorlar soni bilan). */
export async function listCounts(
  filters: CountFilters = {},
  page = 0,
): Promise<{ rows: InventoryCount[]; total: number }> {
  let q = scopeCompany(getSupabase().from('inventory_counts').select(COUNT_SELECT, { count: 'exact' }).is('deleted_at', null))
  if (filters.objectId) q = q.eq('object_id', filters.objectId)
  if (filters.status) q = q.eq('status', filters.status)
  if (filters.createdBy) q = q.eq('created_by', filters.createdBy)
  const start = page * COUNTS_PAGE_SIZE
  const { data, error, count } = await q
    .order('created_at', { ascending: false })
    .range(start, start + COUNTS_PAGE_SIZE - 1)
  if (error) throw toRepoError(error)
  const raws = (data ?? []) as unknown as RawCount[]
  const counts = await itemCounts(raws.map((r) => r.id))
  return { rows: await withNames(raws.map((r) => normalizeCount(r, counts.get(r.id) ?? 0))), total: count ?? 0 }
}

export async function getCount(id: string): Promise<InventoryCount> {
  const { data, error } = await getSupabase().from('inventory_counts').select(COUNT_SELECT).eq('id', id).single()
  if (error) throw toRepoError(error)
  const counts = await itemCounts([id])
  const [row] = await withNames([normalizeCount(data as unknown as RawCount, counts.get(id) ?? 0)])
  return row as InventoryCount
}

/** Hisob qatorlari (o'chirilmaganlar), material nomi bo'yicha. Kutilgan qoldiqsiz (`qty_expected` = null). */
export async function listCountItems(countId: string): Promise<InventoryCountItem[]> {
  const { data, error } = await getSupabase()
    .from('inventory_count_items')
    .select(ITEM_SELECT)
    .eq('inventory_count_id', countId)
    .is('deleted_at', null)
  if (error) throw toRepoError(error)
  return ((data ?? []) as unknown as RawItem[])
    .map(normalizeItem)
    .sort((a, b) => (a.material_name ?? '').localeCompare(b.material_name ?? ''))
}

/** Yangi sanash (qoralama). Idempotent: shu `id` allaqachon bo'lsa — saqlangani qaytadi. */
export async function createCount(input: { id: string; companyId: string; objectId: string }): Promise<InventoryCount> {
  const { data, error } = await getSupabase()
    .from('inventory_counts')
    .insert({ id: input.id, company_id: input.companyId, object_id: input.objectId, status: 'draft' })
    .select(COUNT_SELECT)
    .single()
  if (error) {
    if (isPkeyConflict(error, 'inventory_counts_pkey')) {
      const existing = await getCount(input.id).catch(() => null)
      if (existing) return existing
    }
    throw toRepoError(error)
  }
  return normalizeCount(data as unknown as RawCount, 0)
}

export interface CountItemInput {
  /** Mavjud qator id'si (yangilash) yoki yangi qator uchun klient id'si. */
  id: string
  /** true — qator bazada bor (UPDATE), false — yangi (INSERT). */
  exists: boolean
  companyId: string
  countId: string
  materialId: string
  unitId: string
  /** Dec satr, kiritilgan birlikda. `qty_counted` (asosiy birlikda) — baza hisoblaydi. */
  qtyInput: string
}

/**
 * Sanalgan miqdorni qoralamaga yozadi (har kiritishda darhol). Yangi qator INSERT, mavjudi UPDATE.
 * Qayta urinishda shu `id` bilan 23505 kelsa — UPDATE qilinadi (javob yo'qolgan holat).
 */
export async function saveCountItem(input: CountItemInput): Promise<InventoryCountItem> {
  const sb = getSupabase()
  const patch = { unit_id: input.unitId, qty_input: input.qtyInput }
  const update = async (): Promise<InventoryCountItem> => {
    const { data, error } = await sb.from('inventory_count_items').update(patch).eq('id', input.id).select(ITEM_SELECT).single()
    if (error) throw toRepoError(error)
    return normalizeItem(data as unknown as RawItem)
  }
  if (input.exists) return update()
  const { data, error } = await sb
    .from('inventory_count_items')
    .insert({
      id: input.id,
      company_id: input.companyId,
      inventory_count_id: input.countId,
      material_id: input.materialId,
      ...patch,
    })
    .select(ITEM_SELECT)
    .single()
  if (error) {
    if (isPkeyConflict(error, 'inventory_count_items_pkey')) return update()
    throw toRepoError(error)
  }
  return normalizeItem(data as unknown as RawItem)
}

export interface SubmitResult {
  /**
   * Kamomad bormi — raqamlar tekshiruvchiga qaytarilmaydi. null — natija yashirin (admin bo'lmaganlarga
   * server faqat {ok:true} qaytaradi; ko'r-ko'rona sanash).
   */
  hasShortage: boolean | null
  notCountedCount: number
}

/** Yakunlash (RPC `submit_inventory_count`): `qty_expected` yoziladi, kamomad bo'lsa — alert. */
export async function submitCount(countId: string): Promise<SubmitResult> {
  const { data, error } = await getSupabase().rpc('submit_inventory_count', { p_count_id: countId })
  if (error) throw toRepoError(error)
  const raw = (Array.isArray(data) ? data[0] : data) as { has_shortage?: unknown; not_counted_count?: unknown } | null
  const hidden = !raw || typeof raw.has_shortage !== 'boolean'
  return { hasShortage: hidden ? null : raw.has_shortage === true, notCountedCount: Number(raw?.not_counted_count ?? 0) || 0 }
}

/** Sanash uchun materiallar (RPC `inventory_candidate_materials`): qoldig'i bor yoki smetadagi — faqat id'lar. */
export async function listCandidateMaterials(objectId: string): Promise<string[]> {
  const { data, error } = await getSupabase().rpc('inventory_candidate_materials', { p_object_id: objectId })
  if (error) throw toRepoError(error)
  return ((data ?? []) as ({ material_id: string } | string)[]).map((r) => (typeof r === 'string' ? r : r.material_id))
}

function decOrNull(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v)
}

/** Yakunlangan hisob tafsiloti (RPC `inventory_count_details`): kutilgan, sanalgan, farq, kamomad qiymati. */
export async function getCountDetails(countId: string): Promise<InventoryDetailRow[]> {
  const { data, error } = await getSupabase().rpc('inventory_count_details', { p_count_id: countId })
  if (error) throw toRepoError(error)
  return ((data ?? []) as Record<string, unknown>[])
    .map((r) => ({
      material_id: String(r.material_id),
      material_name: (r.material_name as string | null) ?? null,
      base_unit: (r.base_unit as string | null) ?? null,
      qty_input: decOrNull(r.qty_input),
      unit_id: (r.unit_id as string | null) ?? null,
      qty_counted: decOrNull(r.qty_counted),
      qty_expected: decOrNull(r.qty_expected),
      diff: decOrNull(r.diff),
      shortage_value: decOrNull(r.shortage_value),
    }))
    .sort((a, b) => (a.material_name ?? '').localeCompare(b.material_name ?? ''))
}

/** Admin: farqlar bo'yicha `inventory_adjust` harakatlari (RPC `apply_inventory_adjustments`). */
export async function applyAdjustments(countId: string): Promise<void> {
  const { error } = await getSupabase().rpc('apply_inventory_adjustments', { p_count_id: countId })
  if (error) throw toRepoError(error)
}
