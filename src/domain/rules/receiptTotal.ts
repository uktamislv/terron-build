// G bo'lim — "Chek farqi" (`chek_farqi`, ogohlantirish): chekdagi jami ≠ xarid summasi (> 1 so'm).

import { abs, cmp, sub, type Dec } from '../decimal'

/** Ruxsat etilgan farq, so'm (chegara kiradi: aynan 1 so'm — farq emas). */
export const RECEIPT_TOTAL_TOLERANCE: Dec = '1'

/** `abs(receiptTotal − totalAmount) > 1`. Chek summasi noma'lum (null) → false. */
export function receiptTotalMismatch(receiptTotal: Dec | null, totalAmount: Dec): boolean {
  if (receiptTotal === null) return false
  return cmp(abs(sub(receiptTotal, totalAmount)), RECEIPT_TOTAL_TOLERANCE) > 0
}
