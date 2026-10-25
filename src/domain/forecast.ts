// K bo'lim — material tugash prognozi (docs/automation-design.md). SQL `public.stock_forecast` bilan parity:
//   avg_daily = round(Σ chiqim.qty_base (oxirgi 14 Toshkent kuni, bugun ham) / 14, 6)
//   days_left = null (avg ≤ 0) | 0 (qoldiq ≤ 0) | round(stock / avg_daily, 1)
// Bo'lish PostgreSQL `numeric` bilan bit-bit (`pgNumericDiv`, ikkala operand dscale 6 — qty_base kabi).

import { add, cmp, div, isNegative, isZero, mul, pgNumericDiv, round, type Dec } from './decimal'
import type { MovementType } from './movements'
import { daysBetween } from './reports/period'

export const FORECAST_WINDOW_DAYS = 14
export const SUGGEST_DAYS = 7
/** `companies.forecast_days_warn` standart qiymati — `days_left ≤ 3` "tugayotgan". */
export const DEFAULT_FORECAST_DAYS_WARN = 3

const QTY_DSCALE = 6

function positive(a: Dec): boolean {
  return !isZero(a) && !isNegative(a)
}

/**
 * Qoldiq necha kunga yetadi: avg ≤ 0 → null (sarf yo'q — prognoz yo'q); stock ≤ 0 → '0';
 * aks holda round(stock / avg, 1) (half away from zero).
 */
export function forecastDays(stockBase: Dec, avgDaily: Dec): Dec | null {
  if (!positive(avgDaily)) return null
  if (!positive(stockBase)) return '0'
  return round(pgNumericDiv(stockBase, avgDaily, QTY_DSCALE, QTY_DSCALE), 1)
}

/** `forecastDays` natijasi `warnDays` dan oshmasa (chegara kiradi) — "tugayotgan". null → false. */
export function isRunningOut(daysLeft: Dec | null, warnDays: number = DEFAULT_FORECAST_DAYS_WARN): boolean {
  return daysLeft !== null && cmp(daysLeft, String(warnDays)) <= 0
}

export interface ForecastMovement {
  type: MovementType
  /** Musbat, asosiy birlikda. */
  qtyBase: Dec
  /** Toshkent kuni, `yyyy-mm-dd` (SQL: `(occurred_at at time zone 'Asia/Tashkent')::date`). */
  date: string
}

/**
 * Oxirgi `days` kun (bugun va oldingi `days − 1` kun, ikkala chegara kiradi) dagi faqat `chiqim`
 * yig'indisi / days, 6 xonagacha yaxlitlangan (half away from zero). transfer_out, inventory_adjust —
 * sarf emas. Kelajakdagi sanalar hisobga olinmaydi. days musbat butun bo'lmasa yoki sana noto'g'ri — xato.
 */
export function avgDailyOut(
  movements: readonly ForecastMovement[],
  today: string,
  days: number = FORECAST_WINDOW_DAYS,
): Dec {
  if (!Number.isInteger(days) || days <= 0) throw new Error(`forecast: days musbat butun son bo'lishi kerak: ${days}`)
  let sum: Dec = '0'
  for (const m of movements) {
    if (m.type !== 'chiqim') continue
    const age = daysBetween(m.date, today)
    if (age < 0 || age >= days) continue
    sum = add(sum, m.qtyBase)
  }
  return div(sum, String(days), QTY_DSCALE)
}

/**
 * So'rov miqdori taklifi (asosiy birlikda): min(avgDaily × days, estimateRemaining). Smeta qoldig'i
 * null — cheklovsiz; manfiy yoki 0 — taklif yo'q. Natija ≤ 0 yoki days noto'g'ri → null.
 */
export function suggestRequestQty(
  avgDaily: Dec,
  days: number = SUGGEST_DAYS,
  estimateRemaining: Dec | null = null,
): Dec | null {
  if (!Number.isInteger(days) || days <= 0) return null
  let q = mul(avgDaily, String(days))
  if (estimateRemaining !== null && cmp(estimateRemaining, q) < 0) q = estimateRemaining
  return positive(q) ? q : null
}
