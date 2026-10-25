// Batch 12 avtomatik qoidalari (docs/automation-design.md) — har qoida alohida sof funksiya.
// Bazadagi trigger/cron mantiqi bilan bir xil chegaralar (parity testlari uchun).
export { DEFAULT_DUPLICATE_WINDOW_MINUTES, DUPLICATE_KINDS, findDuplicateEntry, isDuplicateEntry } from './duplicateEntry'
export type { EntryFingerprint } from './duplicateEntry'
export { negativeStockAfter } from './negativeStock'
export {
  CANDIDATE_WINDOW_HOURS,
  OPEN_PURCHASE_AFTER_DAYS,
  OPEN_PURCHASE_BEFORE_DAYS,
  UNSOURCED_LOOKBACK_DAYS,
  candidatesCoverGap,
  isPurchaseCandidate,
  isUnsourcedKirim,
  kirimSourceReason,
} from './unsourcedKirim'
export type { CandidateKirim, KirimSourceReason, UnsourcedKirimInput } from './unsourcedKirim'
export { RECEIPT_TOTAL_TOLERANCE, receiptTotalMismatch } from './receiptTotal'
export { DEFAULT_REQUEST_OVERBUY_PCT, requestOverbuy } from './requestOverbuy'
export { DEFAULT_CASH_MAX_DAYS, cashAging } from './cashAging'
export type { CashAgingResult, CashEntry, CashEntryKind } from './cashAging'
export { photoRequired } from './photoRequired'
export type { PhotoRequiredInput, PhotoRequirement } from './photoRequired'
export { DEFAULT_SITE_RADIUS_M, EARTH_RADIUS_M, distanceMeters, distanceMetersRounded, isOutsideSite } from './geo'
export type { SiteCheckInput } from './geo'
