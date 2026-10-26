// Telegram ilovasi "Qoldiq" — obyekt qoldig'i + prognoz (sof funksiya).
import type { StockForecastRow } from '@/data/forecastRepo'
import type { Material, StockBalance } from '@/data/types'
import { cmp, isNegative, isZero } from '@/domain/decimal'
import { isRunningOut } from '@/domain/forecast'
import { inputUnitView } from '@/domain/units'
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
  /** Qoldiq 0, lekin yaqinda sarflangan yoki prognozi bor — "Tugagan". */
  empty: boolean
  /** Foydalanuvchi odatda kiritadigan birlikdagi ko'rinish ("12 qop") yoki null. */
  inputView: { qty: string; unit: string } | null
}

/**
 * Qoldiq qatorlari prognoz bilan birlashtiriladi; qidiruv nom va muqobil nomlar bo'yicha.
 * Qoldig'i 0 bo'lgan material faqat yaqinda sarflangan (o'rtacha kunlik chiqim > 0) yoki prognoz qatori
 * bo'lsa ko'rsatiladi — "Tugagan" (yo'qolib qolmasin, aynan shu material kerak bo'ladi).
 * Tartib: manfiy, keyin tugagan/tugayotganlar (kam kun birinchi), keyin nom bo'yicha.
 * `lastUnitOf` — material bo'yicha foydalanuvchining oxirgi birligi (entryPrefs).
 */
export function buildStockList(
  stock: readonly StockBalance[],
  forecast: readonly StockForecastRow[],
  materials: readonly Material[],
  query: string,
  warnDays: number,
  lastUnitOf: (materialId: string) => string | null = () => null,
): StockItem[] {
  const byMaterial = new Map(materials.map((m) => [m.id, m]))
  const fc = new Map(forecast.map((f) => [f.materialId, f]))
  const qtyOf = new Map<string, string>()
  for (const s of stock) qtyOf.set(s.material_id, s.qty_base)
  // Qoldiq ko'rinishida yo'q (0), lekin prognozda bor materiallar
  for (const f of forecast) if (!qtyOf.has(f.materialId)) qtyOf.set(f.materialId, f.stockQtyBase)

  const items: StockItem[] = []
  for (const [materialId, qtyBase] of qtyOf) {
    const f = fc.get(materialId)
    const zero = isZero(qtyBase)
    if (zero && !f) continue
    const m = byMaterial.get(materialId)
    if (!m || !matchesQuery(m, query)) continue
    const daysLeft = f?.daysLeft ?? null
    const negative = isNegative(qtyBase)
    items.push({
      materialId,
      name: m.name,
      baseUnit: m.base_unit,
      qtyBase,
      daysLeft,
      low: negative || zero || isRunningOut(daysLeft, warnDays),
      negative,
      empty: zero,
      inputView: zero ? null : inputUnitView(qtyBase, m.units, lastUnitOf(materialId)),
    })
  }
  const rank = (i: StockItem) => (i.negative ? 0 : i.empty ? 1 : i.low ? 2 : 3)
  return items.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.low && b.low && a.daysLeft !== null && b.daysLeft !== null ? cmp(a.daysLeft, b.daysLeft) : 0) ||
      a.name.localeCompare(b.name, 'uz'),
  )
}
