// C bo'lim — "Takroriy yozuv" (`takroriy_yozuv`, belgi). `private.evaluate_duplicate` bilan parity:
//   - harakatlar — faqat `kirim` / `chiqim` (boshqa turlar tekshirilmaydi), xaridlar — `purchase`;
//   - shu `created_by`, tur (kind), obyekt, material, `qty_base`; xaridda + `total_amount`;
//   - `0 ≤ next.created_at − prev.created_at ≤ duplicate_window_minutes` (standart 10; ≤ 0 — o'chiq);
//   - SQL `=` semantikasi: obyekt null bo'lsa yoki xarid summasi null bo'lsa — mos emas;
//   - eng erta mos yozuv (`order by created_at, id`) — `details.first_id`.
// O'chirilgan (`deleted_at`) yozuvlarni chaqiruvchi o'zi chiqarib tashlaydi.

import { cmp, type Dec } from '../decimal'

export interface EntryFingerprint {
  id: string
  createdBy: string
  /** Harakat turi (`kirim`, `chiqim`, …) yoki `purchase` — turli turlar takror hisoblanmaydi. */
  kind: string
  objectId: string | null
  materialId: string
  qtyBase: Dec
  /** Faqat xarid (`kind = 'purchase'`) uchun solishtiriladi; harakatlarda e'tiborsiz. */
  totalAmount?: Dec | null
  /** `created_at` (ISO 8601). */
  createdAt: string
}

export const DEFAULT_DUPLICATE_WINDOW_MINUTES = 10

/** SQL tekshiradigan turlar: harakatlardan faqat kirim/chiqim, va xaridlar. */
export const DUPLICATE_KINDS: readonly string[] = ['kirim', 'chiqim', 'purchase']

/** Xarid summasi: ikkalasi ham berilgan va teng (SQL `p.total_amount = v_total`, null — mos emas). */
function sameTotal(a: Dec | null | undefined, b: Dec | null | undefined): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false
  return cmp(a, b) === 0
}

/**
 * `next` ga mos keladigan eng ERTA oldingi yozuv (`details.first_id`) yoki null.
 * - `next.kind` `kinds` da bo'lmasa (standart `DUPLICATE_KINDS`) → null;
 * - mos: id boshqa; createdBy, kind, objectId (null — hech qachon mos emas), materialId aynan;
 *   qtyBase son sifatida teng ("5" = "5.000"); `kind = 'purchase'` da totalAmount ham teng (null — mos emas);
 *   `0 ≤ next.createdAt − prev.createdAt ≤ windowMinutes` (ikkala chegara kiradi);
 * - teng vaqtda — kichik id. `windowMinutes ≤ 0` yoki noto'g'ri vaqt → null.
 */
export function findDuplicateEntry(
  prev: readonly EntryFingerprint[],
  next: EntryFingerprint,
  windowMinutes: number,
  kinds: readonly string[] = DUPLICATE_KINDS,
): EntryFingerprint | null {
  if (!Number.isFinite(windowMinutes) || windowMinutes <= 0) return null
  if (!kinds.includes(next.kind) || next.objectId === null) return null
  const nextMs = Date.parse(next.createdAt)
  if (!Number.isFinite(nextMs)) return null
  const isPurchase = next.kind === 'purchase'
  const windowMs = windowMinutes * 60_000
  let best: { e: EntryFingerprint; ms: number } | null = null
  for (const p of prev) {
    if (p.id === next.id) continue
    if (p.createdBy !== next.createdBy || p.kind !== next.kind) continue
    if (p.objectId !== next.objectId || p.materialId !== next.materialId) continue
    if (cmp(p.qtyBase, next.qtyBase) !== 0) continue
    if (isPurchase && !sameTotal(p.totalAmount, next.totalAmount)) continue
    const ms = Date.parse(p.createdAt)
    if (!Number.isFinite(ms)) continue
    const age = nextMs - ms
    if (age < 0 || age > windowMs) continue
    if (best === null || ms < best.ms || (ms === best.ms && p.id < best.e.id)) best = { e: p, ms }
  }
  return best?.e ?? null
}

/** `findDuplicateEntry(...) !== null`. */
export function isDuplicateEntry(
  prev: readonly EntryFingerprint[],
  next: EntryFingerprint,
  windowMinutes: number,
  kinds: readonly string[] = DUPLICATE_KINDS,
): boolean {
  return findDuplicateEntry(prev, next, windowMinutes, kinds) !== null
}
