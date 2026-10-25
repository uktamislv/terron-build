// Farq qoidasi 3 — "Narx og'ishi". Bazadagi `private.*` / `check_purchase_price` bilan bir xil:
//   avg  = round(sum(total_amount) / sum(qty_base), 4)   -- miqdor bo'yicha og'irlikli o'rtacha
//   diff = round((price - avg) * 100 / avg, 2)
// Ikki oyna: oxirgi N ta xarid (`lastN`) va oxirgi 90 kun (`last90`) — asta-sekin surishni ushlaydi.
// total_amount — numeric(18,2), qty_base — numeric(20,6), price_per_base / avg — numeric(*,4).

import { add, cmp, isZero, mul, neg, pgNumericDiv, round, sub, type Dec } from '../decimal'

export interface PricePoint {
  totalAmount: Dec
  qtyBase: Dec
}

export type PriceDirection = 'ok' | 'high' | 'low'

export interface PriceInput {
  /** Joriy xaridning `price_per_base`. */
  pricePerBase: Dec
  /** Shu materialning oxirgi N ta (shu xariddan oldingi, o'chirilmagan) xaridi. */
  lastN: PricePoint[]
  /** Shu materialning oxirgi 90 kundagi (shu xariddan oldingi, o'chirilmagan) xaridlari. */
  last90: PricePoint[]
  /** Firma sozlamasi `price_deviation_pct` — yuqoriga og'ish chegarasi. */
  thresholdPct: Dec
  /** Pastga og'ish chegarasi (%, musbat): diff ≤ −lowPct → low. Standart 50. */
  lowPct?: Dec
}

export interface PriceResult {
  direction: PriceDirection
  avgN: Dec | null
  diffN: Dec | null
  avg90: Dec | null
  diff90: Dec | null
}

const TOTAL_DSCALE = 2
const QTY_DSCALE = 6
const PRICE_DSCALE = 4
const MIN_POINTS = 2

/**
 * round(sum(total) / sum(qty), 4) — PostgreSQL bilan bit-bit.
 * < 2 nuqta → null; sum(qty) = 0 → null (bazada qty_base > 0, bo'lmaydi).
 */
export function weightedAverage(points: PricePoint[]): Dec | null {
  if (points.length < MIN_POINTS) return null
  let total: Dec = '0'
  let qty: Dec = '0'
  for (const p of points) {
    total = add(total, p.totalAmount)
    qty = add(qty, p.qtyBase)
  }
  if (isZero(qty)) return null
  return round(pgNumericDiv(total, qty, TOTAL_DSCALE, QTY_DSCALE), 4)
}

/** round((price - avg) * 100 / avg, 2); avg null yoki 0 → null. */
function diffPct(price: Dec, avg: Dec | null): Dec | null {
  if (avg === null || isZero(avg)) return null
  const numerator = mul(sub(price, avg), '100')
  return round(pgNumericDiv(numerator, avg, PRICE_DSCALE, PRICE_DSCALE), 2)
}

/**
 * high: diffN > threshold yoki diff90 > threshold (teng — yo'q).
 * low (high bo'lmasa): diffN ≤ −lowPct yoki diff90 ≤ −lowPct.
 */
export function evaluatePrice(p: PriceInput): PriceResult {
  const avgN = weightedAverage(p.lastN)
  const avg90 = weightedAverage(p.last90)
  const diffN = diffPct(p.pricePerBase, avgN)
  const diff90 = diffPct(p.pricePerBase, avg90)
  const diffs = [diffN, diff90].filter((d): d is Dec => d !== null)
  const lowLimit = neg(p.lowPct ?? '50')
  let direction: PriceDirection = 'ok'
  if (diffs.some((d) => cmp(d, p.thresholdPct) > 0)) direction = 'high'
  else if (diffs.some((d) => cmp(d, lowLimit) <= 0)) direction = 'low'
  return { direction, avgN, diffN, avg90, diff90 }
}
