// E bo'lim — rasm majburiy. Bazadagi guard (`23514 photo_required`) bilan bir xil.

import { cmp, type Dec } from '../decimal'

/** Nima uchun majburiy: material belgisi yoki summa chegarasi; null — majburiy emas. */
export type PhotoRequirement = 'material' | 'amount' | null

export interface PhotoRequiredInput {
  /** Xarid summasi; kirimda null. */
  totalAmount: Dec | null
  /** `companies.photo_required_amount`; null — o'chiq. */
  thresholdAmount: Dec | null
  /** `materials.photo_required`. */
  materialPhotoRequired: boolean
  /** Chek QR orqali tasdiqlangan xarid — rasmsiz ham qabul (QR o'zi isbot). Kirimda false. */
  qrVerified: boolean
}

/**
 * - qrVerified → null;
 * - materialPhotoRequired → 'material' (ustun);
 * - threshold va total berilgan va `total ≥ threshold` (chegara kiradi) → 'amount';
 * - aks holda null.
 */
export function photoRequired(p: PhotoRequiredInput): PhotoRequirement {
  if (p.qrVerified) return null
  if (p.materialPhotoRequired) return 'material'
  if (p.thresholdAmount !== null && p.totalAmount !== null && cmp(p.totalAmount, p.thresholdAmount) >= 0) {
    return 'amount'
  }
  return null
}

/**
 * Chek QR rasmdan ozod qiladimi — bazadagi guard (`(4) rasm`) bilan aynan bir xil:
 * tasdiqlangan (`receiptVerified`) VA chek jami ma'lum VA chek bir qatorli (≤ 1). Ko'p qatorli chekda
 * server rasm talab qiladi — klient ham `qrVerified: false` beradi (MainButton va xato bir xil bo'lsin).
 */
export function receiptPhotoExempt(p: { verified: boolean; total: Dec | null; itemCount: number }): boolean {
  return p.verified && p.total !== null && p.itemCount <= 1
}
