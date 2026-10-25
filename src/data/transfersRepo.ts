import { isUuid } from '@/lib/uuid'
import { RepoError, toRepoError } from './errors'
import { inChunks } from './fetchAll'
import { getSupabase } from './supabaseClient'
import type { Transfer, TransferStatus } from './types'

// numeric ustunlar `::text`. Boshqa obyekt nomi RLS tufayli null bo'lishi mumkin (prorab — faqat a'zo obyektlar).
const TRANSFER_COLUMNS =
  'id, company_id, from_object_id, to_object_id, material_id, unit_id, qty_input::text, unit_input, unit_variant, ' +
  'qty_base::text, status, received_qty_base::text, received_at, received_by, cancel_reason, note, created_by, ' +
  'created_at, deleted_at'
const TRANSFER_SELECT =
  `${TRANSFER_COLUMNS}, ` +
  'from_object:objects!transfers_from_object_fkey(name), ' +
  'to_object:objects!transfers_to_object_fkey(name), ' +
  'material:materials!transfers_material_fkey(name, base_unit), ' +
  'creator:profiles!transfers_created_by_fkey(full_name)'

export const TRANSFERS_PAGE_SIZE = 50
export const CANCEL_REASON_MAX = 500

export interface NewTransfer {
  /** Klientda yaratilgan id — RPC idempotent (qayta urinishda ikkinchi o'tkazma yaratilmaydi). */
  id: string
  fromObjectId: string
  toObjectId: string
  materialId: string
  unitId: string
  /** Dec satr. */
  qtyInput: string
  note?: string | null
}

export interface TransferFilters {
  status?: TransferStatus
  /** Shu obyekt qaysidir tomonda (yuboruvchi yoki qabul qiluvchi). */
  objectId?: string
}

type RawTransfer = Omit<Transfer, 'from_object_name' | 'to_object_name' | 'material_name' | 'base_unit' | 'created_by_name'> & {
  from_object: { name: string } | null
  to_object: { name: string } | null
  material: { name: string; base_unit: string } | null
  creator: { full_name: string } | null
}

function normalize(raw: RawTransfer): Transfer {
  const { from_object, to_object, material, creator, ...rest } = raw
  return {
    ...rest,
    from_object_name: from_object?.name ?? null,
    to_object_name: to_object?.name ?? null,
    material_name: material?.name ?? null,
    base_unit: material?.base_unit ?? null,
    created_by_name: creator?.full_name ?? null,
  }
}

function clean(value: string | null | undefined, max = 1000): string | null {
  const v = value?.trim().slice(0, max)
  return v ? v : null
}

/** O'tkazma yuborish (RPC `create_transfer`): o'tkazma + `transfer_out` harakati bitta tranzaksiyada. */
export async function createTransfer(input: NewTransfer): Promise<string> {
  const { data, error } = await getSupabase().rpc('create_transfer', {
    p_id: input.id,
    p_from_object_id: input.fromObjectId,
    p_to_object_id: input.toObjectId,
    p_material_id: input.materialId,
    p_unit_id: input.unitId,
    p_qty_input: input.qtyInput,
    p_note: clean(input.note),
  })
  if (error) throw toRepoError(error)
  return typeof data === 'string' ? data : input.id
}

/**
 * Qabul qilish (RPC `receive_transfer`). `qtyReceivedInput` — o'tkazma birligida; null — yuborilgan miqdor.
 * Farq bo'lsa baza `otkazma_farqi` alertini yaratadi.
 */
export async function receiveTransfer(id: string, qtyReceivedInput: string | null, note?: string | null): Promise<void> {
  const { error } = await getSupabase().rpc('receive_transfer', {
    p_transfer_id: id,
    p_qty_received_input: qtyReceivedInput,
    p_note: clean(note),
  })
  if (error) throw toRepoError(error)
}

/** Bekor qilish (RPC `cancel_transfer`) — faqat `yuborildi` holatida; `transfer_out` soft delete. */
export async function cancelTransfer(id: string, reason: string): Promise<void> {
  const { error } = await getSupabase().rpc('cancel_transfer', {
    p_transfer_id: id,
    p_reason: clean(reason, CANCEL_REASON_MAX),
  })
  if (error) throw toRepoError(error)
}

export async function getTransferById(id: string): Promise<Transfer> {
  const { data, error } = await getSupabase().from('transfers').select(TRANSFER_SELECT).eq('id', id).single()
  if (error) throw toRepoError(error)
  return normalize(data as unknown as RawTransfer)
}

/** O'tkazmalar (veb): filtrlar, yangisi birinchi, 50 tadan sahifa. */
export async function listTransfers(
  filters: TransferFilters = {},
  page = 0,
): Promise<{ rows: Transfer[]; total: number }> {
  let q = getSupabase().from('transfers').select(TRANSFER_SELECT, { count: 'exact' }).is('deleted_at', null)
  if (filters.status) q = q.eq('status', filters.status)
  if (filters.objectId) {
    // .or() satri filtr sintaksisi — faqat UUID qo'yiladi
    if (!isUuid(filters.objectId)) throw new RepoError('invalid_value', 'objectId is not a uuid')
    q = q.or(`from_object_id.eq.${filters.objectId},to_object_id.eq.${filters.objectId}`)
  }
  const start = page * TRANSFERS_PAGE_SIZE
  const { data, error, count } = await q
    .order('created_at', { ascending: false })
    .order('id')
    .range(start, start + TRANSFERS_PAGE_SIZE - 1)
  if (error) throw toRepoError(error)
  return { rows: ((data ?? []) as unknown as RawTransfer[]).map(normalize), total: count ?? 0 }
}

/** Shu obyektlarga kelayotgan (hali qabul qilinmagan) o'tkazmalar, eskisi birinchi. */
export async function listIncomingTransfers(objectIds: string[]): Promise<Transfer[]> {
  if (objectIds.length === 0) return []
  const data = await inChunks(objectIds, async (chunk) => {
    const { data: part, error } = await getSupabase()
      .from('transfers')
      .select(TRANSFER_SELECT)
      .eq('status', 'yuborildi')
      .in('to_object_id', chunk)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
    if (error) throw toRepoError(error)
    return (part ?? []) as unknown as RawTransfer[]
  })
  // Bo'laklar birlashtirilgach — eskisi birinchi
  return data.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).map(normalize)
}

/** Men yuborgan o'tkazmalar (Mini App "Mening yozuvlarim"). */
export async function listMyTransfers(profileId: string, limit = 50): Promise<Transfer[]> {
  const { data, error } = await getSupabase()
    .from('transfers')
    .select(TRANSFER_SELECT)
    .eq('created_by', profileId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw toRepoError(error)
  return ((data ?? []) as unknown as RawTransfer[]).map(normalize)
}

/** "Qayerga" ro'yxati (RPC `transfer_target_objects`): firmaning faol obyektlari (id, nom). */
export async function listTransferTargets(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await getSupabase().rpc('transfer_target_objects')
  if (error) throw toRepoError(error)
  return ((data ?? []) as { id: string; name: string }[]).map((r) => ({ id: r.id, name: r.name }))
}
