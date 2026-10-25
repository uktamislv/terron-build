// B bo'lim — "Manfiy qoldiq" (`manfiy_qoldiq`, ogohlantirish). Chiqim/transfer_out dan keyingi
// qoldiq < 0 bo'lsa alert. Chiqim bloklanmaydi.

import { isNegative, sub, type Dec } from '../decimal'

/** Chiqimdan keyingi qoldiq (`details.stock_after`), agar u manfiy bo'lsa; aks holda (0 ham) null. */
export function negativeStockAfter(stockBefore: Dec, qtyOut: Dec): Dec | null {
  const after = sub(stockBefore, qtyOut)
  return isNegative(after) ? after : null
}
