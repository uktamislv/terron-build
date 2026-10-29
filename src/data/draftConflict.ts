// Idempotent saqlash (qoralama id'si): 23505 kelganda mavjud qator o'qiladi. U yuborilgan yozuvdan
// farq qilsa (boshqa material, miqdor, obyekt…) — bu avvalgi, BOSHQA yozuv: "saqlandi" deb qaytarilmaydi,
// `draft_conflict` xatosi beriladi (UI yangi id bilan qayta saqlaydi).
import { cmp } from '@/domain/decimal'
import { RepoError } from './errors'

/** Ikki son (Dec satr) teng — "3" va "3.000000" bir xil; null faqat null bilan. */
export function decEq(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return (a ?? null) === (b ?? null)
  try {
    return cmp(a, b) === 0
  } catch {
    return false
  }
}

/** Mavjud qator yuborilgan yozuv emas — `draft_conflict`. */
export function ensureSameDraft<T>(existing: T, same: boolean): T {
  if (!same) throw new RepoError('draft_conflict')
  return existing
}
