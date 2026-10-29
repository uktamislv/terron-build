import { toRepoError } from './errors'
import { fetchAll } from './fetchAll'
import { scopeCompany } from './companyScope'
import { getSupabase } from './supabaseClient'
import type { StockBalance } from './types'

const STOCK_COLUMNS = 'company_id, object_id, material_id, qty_base::text, last_movement_at'

/** Qoldiq (`stock_balances` view, RLS chaqiruvchi huquqida). Nomlar sahifada katalogdan qo'shiladi. */
export async function listStock(filters: { objectId?: string } = {}): Promise<StockBalance[]> {
  let q = scopeCompany(getSupabase().from('stock_balances').select(STOCK_COLUMNS))
  if (filters.objectId) q = q.eq('object_id', filters.objectId)
  const { data, error } = await q.order('object_id').order('material_id')
  if (error) throw toRepoError(error)
  return (data ?? []) as unknown as StockBalance[]
}

/** Eksport: barcha qoldiq qatorlari (1000 tadan, ≤ 50 000). */
export function listAllStock(filters: { objectId?: string } = {}, signal?: AbortSignal): Promise<StockBalance[]> {
  // View'da `created_at` yo'q — vaqt chegarasi qo'llanmaydi; kalit — obyekt × material
  return fetchAll(
    async (req) => {
      let q = scopeCompany(getSupabase().from('stock_balances').select(STOCK_COLUMNS, req.first ? { count: 'exact' } : undefined))
      if (filters.objectId) q = q.eq('object_id', filters.objectId)
      let ranged = q.order('object_id').order('material_id').range(req.from, req.to)
      if (req.signal) ranged = ranged.abortSignal(req.signal)
      const { data, error, count } = await ranged
      if (error) throw toRepoError(error)
      return { rows: (data ?? []) as unknown as StockBalance[], total: count ?? null }
    },
    { signal, keyOf: (r) => `${r.object_id}:${r.material_id}` },
  )
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
