import { toRepoError } from './errors'
import { getSupabase } from './supabaseClient'
import type { StockBalance } from './types'

const STOCK_COLUMNS = 'company_id, object_id, material_id, qty_base::text, last_movement_at'

/** Qoldiq (`stock_balances` view, RLS chaqiruvchi huquqida). Nomlar sahifada katalogdan qo'shiladi. */
export async function listStock(filters: { objectId?: string } = {}): Promise<StockBalance[]> {
  let q = getSupabase().from('stock_balances').select(STOCK_COLUMNS)
  if (filters.objectId) q = q.eq('object_id', filters.objectId)
  const { data, error } = await q.order('object_id').order('material_id')
  if (error) throw toRepoError(error)
  return (data ?? []) as unknown as StockBalance[]
}

/** Bitta obyekt × material qoldig'i (asosiy birlikda). Harakat bo'lmasa — "0". */
export async function getStock(objectId: string, materialId: string): Promise<string> {
  const { data, error } = await getSupabase()
    .from('stock_balances')
    .select('qty_base::text')
    .eq('object_id', objectId)
    .eq('material_id', materialId)
    .maybeSingle()
  if (error) throw toRepoError(error)
  return (data as { qty_base: string } | null)?.qty_base ?? '0'
}
