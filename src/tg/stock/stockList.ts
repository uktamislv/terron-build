// Telegram ilovasi "Qoldiq" — obyekt qoldig'i + prognoz (sof funksiya).
import type { StockForecastRow } from '@/data/forecastRepo'
import type { Material, StockBalance } from '@/data/types'
import { cmp, isNegative, isZero } from '@/domain/decimal'
import { isRunningOut } from '@/domain/forecast'
import { matchesQuery } from '@/web/materials/materialFilter'

export interface StockItem {
  materialId: string
  name: string
  baseUnit: string
  qtyBase: string
  /** Necha kunga yetadi; sarf yo'q — null. */
  daysLeft: string | null
  /** Tugayapti (`days_left ≤ forecast_days_warn`) yoki tugagan. */
  low: boolean
  negative: boolean
}

/**
 * Qoldiq qatorlari (0 bo'lmaganlar) prognoz bilan birlashtiriladi; qidiruv nom va muqobil nomlar bo'yicha.
 * Tartib: manfiy, keyin tugayotganlar (kam kun birinchi), keyin nom bo'yicha.
 */
export function buildStockList(
  stock: readonly StockBalance[],
  forecast: readonly StockForecastRow[],
  materials: readonly Material[],
  query: string,
  warnDays: number,
): StockItem[] {
  const byMaterial = new Map(materials.map((m) => [m.id, m]))
  const fc = new Map(forecast.map((f) => [f.materialId, f]))
  const items: StockItem[] = []
  for (const s of stock) {
    if (isZero(s.qty_base)) continue
    const m = byMaterial.get(s.material_id)
    if (!m || !matchesQuery(m, query)) continue
    const f = fc.get(s.material_id)
    const daysLeft = f?.daysLeft ?? null
    const negative = isNegative(s.qty_base)
    items.push({
      materialId: s.material_id,
      name: m.name,
      baseUnit: m.base_unit,
      qtyBase: s.qty_base,
      daysLeft,
      low: negative || isRunningOut(daysLeft, warnDays),
      negative,
    })
  }
  const rank = (i: StockItem) => (i.negative ? 0 : i.low ? 1 : 2)
  return items.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.low && b.low && a.daysLeft !== null && b.daysLeft !== null ? cmp(a.daysLeft, b.daysLeft) : 0) ||
      a.name.localeCompare(b.name, 'uz'),
  )
}
