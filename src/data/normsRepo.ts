import { toRepoError } from './errors'
import { getSupabase } from './supabaseClient'
import type { NormUsage } from './types'

// `norm_usage` view (security_invoker — RLS chaqiruvchi huquqida). Raqamlar `::text`.
const NORM_COLUMNS =
  'company_id, object_id, material_id, estimate_id, norm_qty_base::text, allowed_qty_base::text, ' +
  'consumed_qty_base::text, delivered_qty_base::text, requested_open_qty_base::text, remaining_qty_base::text, usage_pct::text'

interface RawNorm extends Omit<NormUsage, 'usage_pct'> {
  usage_pct: string | null
}

function normalize(r: RawNorm): NormUsage {
  return {
    ...r,
    norm_qty_base: r.norm_qty_base ?? '0',
    allowed_qty_base: r.allowed_qty_base ?? '0',
    consumed_qty_base: r.consumed_qty_base ?? '0',
    delivered_qty_base: r.delivered_qty_base ?? '0',
    requested_open_qty_base: r.requested_open_qty_base ?? '0',
    remaining_qty_base: r.remaining_qty_base ?? '0',
    usage_pct: r.usage_pct ?? null,
  }
}

/** Obyekt(lar) bo'yicha norma va sarf. Joriy smetasi yo'q obyektlar qatorlari yo'q. */
export async function listNormUsage(filters: { objectId?: string; objectIds?: string[]; materialId?: string } = {}): Promise<NormUsage[]> {
  if (filters.objectIds && filters.objectIds.length === 0) return []
  let q = getSupabase().from('norm_usage').select(NORM_COLUMNS)
  if (filters.objectId) q = q.eq('object_id', filters.objectId)
  if (filters.objectIds) q = q.in('object_id', filters.objectIds)
  if (filters.materialId) q = q.eq('material_id', filters.materialId)
  const { data, error } = await q
  if (error) throw toRepoError(error)
  return ((data ?? []) as unknown as RawNorm[]).map(normalize)
}

/** Bitta obyekt × material; smetada yo'q yoki joriy smeta yo'q — null. */
export async function getNormUsage(objectId: string, materialId: string): Promise<NormUsage | null> {
  const rows = await listNormUsage({ objectId, materialId })
  return rows[0] ?? null
}
