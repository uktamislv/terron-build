import { toRepoError } from './errors'
import { getSupabase } from './supabaseClient'
import type { MyOpenPurchase, OpenPurchase } from './types'

interface RawOpenPurchase {
  id: string
  purchased_at: string
  buyer_id?: string | null
  buyer_name: string | null
  qty_base: string | number
  received_qty_base: string | number
  remaining_qty_base: string | number
  unit_input: string
  unit_variant?: string | null
  qty_input: string | number
}

/**
 * Kirimga bog'lash uchun: shu obyekt va materialdagi oxirgi 14 kunlik, to'liq qabul qilinmagan
 * xaridlar (RPC `open_purchases`). Raqamlar satrga keltiriladi (float'ga aylantirilmaydi).
 */
export async function listOpenPurchases(objectId: string, materialId: string): Promise<OpenPurchase[]> {
  const { data, error } = await getSupabase().rpc('open_purchases', {
    p_object_id: objectId,
    p_material_id: materialId,
  })
  if (error) throw toRepoError(error)
  return ((data ?? []) as RawOpenPurchase[]).map((r) => ({
    id: r.id,
    purchased_at: r.purchased_at,
    buyer_id: r.buyer_id ?? null,
    buyer_name: r.buyer_name,
    qty_base: String(r.qty_base),
    received_qty_base: String(r.received_qty_base),
    remaining_qty_base: String(r.remaining_qty_base),
    unit_input: r.unit_input,
    unit_variant: r.unit_variant ?? null,
    qty_input: String(r.qty_input),
  }))
}

interface RawMyOpenPurchase {
  purchase_id: string
  object_id: string
  object_name: string | null
  material_id: string
  material_name: string | null
  base_unit: string | null
  qty_base: string | number
  received_qty_base: string | number
  remaining_qty_base: string | number
  purchased_at: string
  buyer_id: string | null
  buyer_name: string | null
}

/**
 * "Qabul kutilmoqda": chaqiruvchining obyektlaridagi to'liq qabul qilinmagan xaridlar (RPC
 * `open_purchases_for_my_objects`; prorab/omborchi — a'zo obyektlar, admin — firma, boshqalar — bo'sh).
 * Raqamlar satrga keltiriladi.
 */
export async function listMyOpenPurchases(): Promise<MyOpenPurchase[]> {
  const { data, error } = await getSupabase().rpc('open_purchases_for_my_objects')
  if (error) throw toRepoError(error)
  return ((data ?? []) as RawMyOpenPurchase[]).map((r) => ({
    purchase_id: r.purchase_id,
    object_id: r.object_id,
    object_name: r.object_name,
    material_id: r.material_id,
    material_name: r.material_name,
    base_unit: r.base_unit,
    qty_base: String(r.qty_base),
    received_qty_base: String(r.received_qty_base),
    remaining_qty_base: String(r.remaining_qty_base),
    purchased_at: r.purchased_at,
    buyer_id: r.buyer_id ?? null,
    buyer_name: r.buyer_name ?? null,
  }))
}
