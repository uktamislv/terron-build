import { toRepoError } from './errors'
import { getSupabase } from './supabaseClient'

export interface MaterialUsageRow {
  materialId: string
  useCount: number
  lastUsedAt: string
}

/** Joriy foydalanuvchi oxirgi `days` kunda qaysi materiallarni qancha ishlatgan (RPC). */
export async function getMyMaterialUsage(days = 30): Promise<MaterialUsageRow[]> {
  const { data, error } = await getSupabase().rpc('my_material_usage', { p_days: days })
  if (error) throw toRepoError(error)
  return ((data ?? []) as { material_id: string; use_count: number | string; last_used_at: string }[]).map((r) => ({
    materialId: r.material_id,
    useCount: Number(r.use_count),
    lastUsedAt: r.last_used_at,
  }))
}
