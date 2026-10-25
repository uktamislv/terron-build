import { isPkeyConflict, toRepoError } from './errors'
import { chunkOpts, fetchAll, inChunks, type ChunkOpts } from './fetchAll'
import { softDeleteById, updateById } from './rowUpdate'
import { getSupabase } from './supabaseClient'
import type { AlertType, Purchase, PurchaseReceipt } from './types'

// numeric ustunlar `::text` — aniqlik yo'qolmasin. Embed'lar FK nomi bilan (kompozit FK'lar).
const PURCHASE_COLUMNS =
  'id, company_id, buyer_id, object_id, material_id, supplier_id, unit_id, qty_input::text, unit_input, unit_variant, ' +
  'qty_base::text, total_amount::text, unit_price::text, price_per_base::text, receipt_photo_path, purchased_at, note, ' +
  'created_by, created_at, deleted_at'
const PURCHASE_SELECT =
  `${PURCHASE_COLUMNS}, ` +
  'object:objects!purchases_object_fkey(name), ' +
  'material:materials!purchases_material_fkey(name, base_unit), ' +
  'buyer:profiles!purchases_buyer_fkey(full_name), ' +
  'supplier:suppliers!purchases_supplier_fkey(name)'

/** `purchase_receipts` view: kalit ustuni va qiymatlar. */
const RECEIPT_KEY = 'purchase_id'
const RECEIPT_COLUMNS = `${RECEIPT_KEY}, received_qty_base::text, remaining_qty_base::text, receipt_count, last_received_at`

export const PURCHASES_PAGE_SIZE = 50

export interface NewPurchase {
  /** Klientda yaratilgan id (qoralama) — qayta urinishda ikki marta yozilmaslik uchun. */
  id: string
  companyId: string
  objectId: string
  materialId: string
  unitId: string
  /** Dec satr. `qty_base`, `unit_price`, `price_per_base` yuborilmaydi — baza hisoblaydi. */
  qtyInput: string
  /** Jami summa (chekdagi), Dec satr, so'm. */
  totalAmount: string
  supplierId?: string | null
  receiptPhotoPath?: string | null
  note?: string | null
  /** Xaridor; berilmasa — joriy foydalanuvchi (sahifa doim o'z profilini yuboradi). Admin boshqa nomidan. */
  buyerId?: string | null
}

export interface PurchaseFilters {
  objectId?: string
  materialId?: string
  buyerId?: string
  /** ISO, shu vaqtdan (kiritilgan) */
  from?: string
  /** ISO, shu vaqtgacha (kiritilmagan) */
  to?: string
  includeDeleted?: boolean
}

export interface PurchasePage {
  rows: Purchase[]
  total: number
}

type RawPurchase = Omit<
  Purchase,
  'object_name' | 'material_name' | 'base_unit' | 'buyer_name' | 'supplier_name' | 'receipt' | 'alert_types'
> & {
  object: { name: string } | null
  material: { name: string; base_unit: string } | null
  buyer: { full_name: string } | null
  supplier: { name: string } | null
}

function normalize(raw: RawPurchase): Purchase {
  const { object, material, buyer, supplier, ...rest } = raw
  return {
    ...rest,
    object_name: object?.name ?? null,
    material_name: material?.name ?? null,
    base_unit: material?.base_unit ?? null,
    buyer_name: buyer?.full_name ?? null,
    supplier_name: supplier?.name ?? null,
    receipt: null,
    alert_types: [],
  }
}

function clean(value: string | null | undefined): string | null {
  const v = value?.trim()
  return v ? v : null
}

/**
 * Xarid yaratadi. Javob — saqlangan qator (bazada hisoblangan narxlar bilan).
 * Idempotent: oldingi urinish aslida saqlangan bo'lsa, shu `id` bilan `purchases_pkey` 23505 keladi —
 * unda saqlangan qator o'qib qaytariladi.
 */
export async function createPurchase(input: NewPurchase): Promise<Purchase> {
  const row: Record<string, unknown> = {
    id: input.id,
    company_id: input.companyId,
    object_id: input.objectId,
    material_id: input.materialId,
    unit_id: input.unitId,
    qty_input: input.qtyInput,
    total_amount: input.totalAmount,
    supplier_id: input.supplierId || null,
    receipt_photo_path: clean(input.receiptPhotoPath),
    note: clean(input.note),
  }
  if (input.buyerId) row.buyer_id = input.buyerId
  const { data, error } = await getSupabase().from('purchases').insert(row).select(PURCHASE_SELECT).single()
  if (error) {
    if (isPkeyConflict(error, 'purchases_pkey')) {
      const existing = await getPurchaseById(input.id).catch(() => null)
      if (existing) return existing
    }
    throw toRepoError(error)
  }
  return normalize(data as unknown as RawPurchase)
}

export async function getPurchaseById(id: string): Promise<Purchase> {
  const { data, error } = await getSupabase().from('purchases').select(PURCHASE_SELECT).eq('id', id).single()
  if (error) throw toRepoError(error)
  const [withStatus] = await attachStatus([normalize(data as unknown as RawPurchase)])
  return withStatus as Purchase
}

/** Qabul holati (`purchase_receipts`) va ochiq alert turlari. Alertlarni ko'ra olmaydiganlarga — bo'sh. */
async function attachStatus(rows: Purchase[]): Promise<Purchase[]> {
  if (rows.length === 0) return rows
  const ids = rows.map((r) => r.id)
  // .in() — 100 talik bo'laklar, ketma-ket (URL uzunligi)
  const receipts = await inChunks(ids, async (chunk) => {
    const { data, error } = await getSupabase().from('purchase_receipts').select(RECEIPT_COLUMNS).in(RECEIPT_KEY, chunk)
    if (error) throw toRepoError(error)
    return (data ?? []) as unknown as Record<string, unknown>[]
  })
  const byId = new Map<string, PurchaseReceipt>()
  for (const r of receipts) {
    byId.set(String(r[RECEIPT_KEY]), {
      received_qty_base: String(r.received_qty_base ?? '0'),
      remaining_qty_base: String(r.remaining_qty_base ?? '0'),
      receipt_count: Number(r.receipt_count ?? 0),
      last_received_at: (r.last_received_at as string | null) ?? null,
    })
  }
  // Alertlar — qo'shimcha belgi: xato bo'lsa jadval baribir ko'rsatiladi
  const alertsBy = new Map<string, AlertType[]>()
  const alerts = await inChunks(ids, async (chunk) => {
    const { data, error } = await getSupabase()
      .from('alerts')
      .select('purchase_id, type')
      .in('purchase_id', chunk)
      .in('status', ['yangi', 'korildi'])
      .is('deleted_at', null)
    if (error) throw error
    return (data ?? []) as { purchase_id: string; type: AlertType }[]
  }).catch(() => [] as { purchase_id: string; type: AlertType }[])
  for (const al of alerts) {
    const list = alertsBy.get(al.purchase_id) ?? []
    if (!list.includes(al.type)) list.push(al.type)
    alertsBy.set(al.purchase_id, list)
  }
  return rows.map((r) => ({ ...r, receipt: byId.get(r.id) ?? null, alert_types: alertsBy.get(r.id) ?? [] }))
}

/** Xaridlar jadvali: filtrlar, `purchased_at` bo'yicha yangisi birinchi, 50 tadan sahifa (0 dan), qabul holati bilan. */
export async function listPurchases(filters: PurchaseFilters = {}, page = 0): Promise<PurchasePage> {
  const start = page * PURCHASES_PAGE_SIZE
  const r = await loadPurchases(filters, start, start + PURCHASES_PAGE_SIZE - 1)
  return { rows: r.rows, total: r.total ?? 0 }
}

/** Eksport: joriy filtr bo'yicha barcha xaridlar qabul holati bilan (1000 tadan, ≤ 50 000). */
export function listAllPurchases(filters: PurchaseFilters = {}, signal?: AbortSignal): Promise<Purchase[]> {
  return fetchAll((req) => loadPurchases(filters, req.from, req.to, chunkOpts(req)), { signal })
}

async function loadPurchases(
  filters: PurchaseFilters,
  from: number,
  to: number,
  opts: ChunkOpts = { count: true },
): Promise<{ rows: Purchase[]; total: number | null }> {
  let q = getSupabase().from('purchases').select(PURCHASE_SELECT, opts.count ? { count: 'exact' } : undefined)
  if (!filters.includeDeleted) q = q.is('deleted_at', null)
  if (filters.objectId) q = q.eq('object_id', filters.objectId)
  if (filters.materialId) q = q.eq('material_id', filters.materialId)
  if (filters.buyerId) q = q.eq('buyer_id', filters.buyerId)
  if (filters.from) q = q.gte('purchased_at', filters.from)
  if (filters.to) q = q.lt('purchased_at', filters.to)
  if (opts.before) q = q.lte('created_at', opts.before)
  let ranged = q
    .order('purchased_at', { ascending: false })
    .order('created_at', { ascending: false })
    .order('id')
    .range(from, to)
  if (opts.signal) ranged = ranged.abortSignal(opts.signal)
  const { data, error, count } = await ranged
  if (error) throw toRepoError(error)
  const rows = await attachStatus(((data ?? []) as unknown as RawPurchase[]).map(normalize))
  return { rows, total: count ?? null }
}

/**
 * Mening xaridlarim (Mini App "Mening yozuvlarim"): xaridor yoki kirituvchi — men
 * (admin mening nomimdan kiritgan bo'lsa ham). O'chirilganlari ham (RLS ko'rsatsa).
 */
export async function listMyPurchases(profileId: string, limit = 50): Promise<Purchase[]> {
  const { data, error } = await getSupabase()
    .from('purchases')
    .select(PURCHASE_SELECT)
    .or(`buyer_id.eq.${profileId},created_by.eq.${profileId}`)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw toRepoError(error)
  return ((data ?? []) as unknown as RawPurchase[]).map(normalize)
}

export type PriceCheck = 'ok' | 'high' | 'low'

/**
 * Narx odatdagidan og'ganmi (RPC `check_purchase_price`) — faqat UI ogohlantirishi uchun; raqam
 * (o'rtacha, foiz) qaytarilmaydi — kalibrlashning oldini olish. `pricePerBase` — Dec satr
 * (`purchasePrices` bilan hisoblangan).
 */
export async function checkPurchasePrice(materialId: string, pricePerBase: string): Promise<PriceCheck> {
  const { data, error } = await getSupabase().rpc('check_purchase_price', {
    p_material_id: materialId,
    p_price_per_base: pricePerBase,
  })
  if (error) throw toRepoError(error)
  return data === 'high' || data === 'low' ? data : 'ok'
}

export function softDeletePurchase(id: string): Promise<void> {
  return softDeleteById('purchases', id)
}

/** Tiklash — faqat admin (baza `restore_admin_only`). */
export function restorePurchase(id: string): Promise<void> {
  return updateById('purchases', id, { deleted_at: null })
}
