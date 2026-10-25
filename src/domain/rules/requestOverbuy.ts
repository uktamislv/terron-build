// H bo'lim — "So'rovdan ortiq xarid" (`sorovdan_ortiq_xarid`, belgi).
// Firma sozlamasi `request_overbuy_pct` (standart 20).

import { add, cmp, isNegative, isZero, mul, type Dec } from '../decimal'

export const DEFAULT_REQUEST_OVERBUY_PCT: Dec = '20'

/**
 * `purchase × 100 > request × (100 + pct)` — ya'ni xarid so'rovdan `pct` foizdan KO'P
 * (aynan +20 % — ortiq emas). Aniq hisob, bo'lish yo'q. So'rov miqdori ≤ 0 yoki
 * pct manfiy → false (baholab bo'lmaydi).
 */
export function requestOverbuy(requestQtyBase: Dec, purchaseQtyBase: Dec, pct: Dec): boolean {
  if (isZero(requestQtyBase) || isNegative(requestQtyBase) || isNegative(pct)) return false
  return cmp(mul(purchaseQtyBase, '100'), mul(requestQtyBase, add('100', pct))) > 0
}
