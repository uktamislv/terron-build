import { toRepoError } from './errors'
import { getSupabase } from './supabaseClient'

/**
 * `stock_forecast(p_object_id)` qatori (Batch 12, K). RPC ustunlari: material_id, material_name,
 * base_unit, stock_qty_base, avg_daily_qty_base, days_left, other_objects_qty_base,
 * estimate_remaining_qty_base (docs/db-design.md): material qoldig'i, o'rtacha kunlik chiqim,
 * necha kunga yetishi, boshqa obyektlardagi qoldiq va smetada qolgan miqdor. Hammasi asosiy birlikda,
 * `numeric` → satr (float'ga aylantirilmaydi).
 */
export interface StockForecastRow {
  objectId: string
  materialId: string
  stockQtyBase: string
  /** Oxirgi 14 kun o'rtacha kunlik chiqim. */
  avgDailyOut: string
  /** Qoldiq / o'rtacha; o'rtacha 0 bo'lsa — null. */
  daysLeft: string | null
  /** Foydalanuvchi ko'ra oladigan boshqa obyektlardagi qoldiq jami. */
  otherStockQtyBase: string
  /** Smetada qolgan miqdor; joriy smeta yo'q yoki materialda yo'q — null. */
  estimateRemainingQtyBase: string | null
}

type RawForecast = Record<string, unknown>

function dec(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  return String(v)
}

export function normalizeForecast(objectId: string, r: RawForecast): StockForecastRow {
  return {
    objectId,
    materialId: String(r.material_id),
    stockQtyBase: dec(r.stock_qty_base) ?? '0',
    avgDailyOut: dec(r.avg_daily_qty_base) ?? '0',
    daysLeft: dec(r.days_left),
    otherStockQtyBase: dec(r.other_objects_qty_base) ?? '0',
    estimateRemainingQtyBase: dec(r.estimate_remaining_qty_base),
  }
}

/** Obyekt bo'yicha prognoz (RPC, security invoker — RLS chaqiruvchi huquqida). */
export async function getStockForecast(objectId: string): Promise<StockForecastRow[]> {
  const { data, error } = await getSupabase().rpc('stock_forecast', { p_object_id: objectId })
  if (error) throw toRepoError(error)
  return ((data ?? []) as RawForecast[]).map((r) => normalizeForecast(objectId, r))
}
