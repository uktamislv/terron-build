// Ombor harakatlari — sof funksiyalar (docs/ops-design.md, "Sof funksiyalar" bo'limi).
// Veb panel va Mini App ikkalasi shu yerdan foydalanadi. `Date.now()` ishlatilmaydi —
// joriy vaqt har doim argument (`nowIso`) sifatida beriladi.

import { add, cmp, isNegative, sub, type Dec } from './decimal'
import { validateQtyInput } from './units'

export type MovementType = 'kirim' | 'chiqim' | 'transfer_out' | 'transfer_in' | 'inventory_adjust'

/** Mini App kirim/chiqim formasi turlari. */
export type EntryType = 'kirim' | 'chiqim'

export type MovementWarning = 'exceeds_stock' | 'negative_stock'

/** Qoldiqni kamaytiradigan turlar (`qtyBase` musbat, ayiriladi). */
function isOutgoing(type: MovementType): boolean {
  return type === 'chiqim' || type === 'transfer_out'
}

/**
 * Harakatdan keyingi qoldiq.
 * kirim / transfer_in: +qtyBase; chiqim / transfer_out: −qtyBase;
 * inventory_adjust: qtyBase ishorasi bilan qo'shiladi (manfiy — kamomad).
 */
export function stockAfter(current: Dec, type: MovementType, qtyBase: Dec): Dec {
  return isOutgoing(type) ? sub(current, qtyBase) : add(current, qtyBase)
}

/**
 * Saqlashni bloklamaydigan ogohlantirishlar (barqaror tartib: exceeds_stock, negative_stock).
 * - `exceeds_stock` — chiqim/transfer_out miqdori joriy qoldiqdan katta (teng bo'lsa — yo'q);
 * - `negative_stock` — harakatdan keyingi qoldiq manfiy (har qanday tur uchun).
 */
export function movementWarnings(p: { type: MovementType; qtyBase: Dec; currentStock: Dec }): MovementWarning[] {
  const out: MovementWarning[] = []
  if (isOutgoing(p.type) && cmp(p.qtyBase, p.currentStock) > 0) out.push('exceeds_stock')
  if (isNegative(stockAfter(p.currentStock, p.type, p.qtyBase))) out.push('negative_stock')
  return out
}

// ---------------------------------------------------------------------------
// Material tugmalari tartibi
// ---------------------------------------------------------------------------

export interface UsageStat {
  materialId: string
  useCount: number
  lastUsedAt: string
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Yaqinlik koeffitsienti, butun sonda ×4 (float xatosiz solishtirish uchun):
 * oxirgi 7 kun (chegara kiradi) — 4 (=1), 30 kun — 2 (=0.5), eskiroq — 1 (=0.25).
 * Kelajakdagi sana — 7 kun ichida deb olinadi; noto'g'ri sana — eng eski.
 */
function recencyWeight4(lastUsedMs: number, nowMs: number): number {
  if (!Number.isFinite(lastUsedMs) || !Number.isFinite(nowMs)) return 1
  const age = nowMs - lastUsedMs
  if (age <= 7 * DAY_MS) return 4
  if (age <= 30 * DAY_MS) return 2
  return 1
}

/**
 * Materiallarni foydalanish bo'yicha tartiblaydi (kirish massivi o'zgarmaydi).
 * 1) Ishlatilganlar (`useCount > 0`) — ball = useCount × yaqinlik koeffitsienti, kamayish tartibida;
 *    teng ballda `lastUsedAt` yangisi oldin; keyin nom, keyin id.
 * 2) Ishlatilmaganlar — oxirida, nom bo'yicha (`localeCompare('uz')`), keyin id.
 * `usage` da materiallar ro'yxatida yo'q `materialId` e'tiborsiz qoldiriladi; bir material uchun
 * bir nechta yozuv bo'lsa — `useCount` qo'shiladi, `lastUsedAt` eng yangisi olinadi.
 */
export function rankMaterials<T extends { id: string; name: string }>(
  materials: T[],
  usage: UsageStat[],
  nowIso: string,
): T[] {
  const nowMs = Date.parse(nowIso)
  const agg = new Map<string, { count: number; lastMs: number }>()
  for (const u of usage) {
    if (!Number.isFinite(u.useCount) || u.useCount <= 0) continue
    const ms = Date.parse(u.lastUsedAt)
    const lastMs = Number.isFinite(ms) ? ms : -Infinity
    const prev = agg.get(u.materialId)
    if (prev) {
      prev.count += u.useCount
      prev.lastMs = Math.max(prev.lastMs, lastMs)
    } else {
      agg.set(u.materialId, { count: u.useCount, lastMs })
    }
  }

  const byName = (a: T, b: T): number => {
    const n = a.name.localeCompare(b.name, 'uz')
    if (n !== 0) return n
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  }

  const used: { m: T; score: number; lastMs: number }[] = []
  const unused: T[] = []
  for (const m of materials) {
    const a = agg.get(m.id)
    if (a) used.push({ m, score: a.count * recencyWeight4(a.lastMs, nowMs), lastMs: a.lastMs })
    else unused.push(m)
  }

  used.sort((x, y) => {
    if (x.score !== y.score) return y.score - x.score
    if (x.lastMs !== y.lastMs) return y.lastMs > x.lastMs ? 1 : -1
    return byName(x.m, y.m)
  })
  unused.sort(byName)
  return [...used.map((x) => x.m), ...unused]
}

// ---------------------------------------------------------------------------
// Forma tekshiruvi
// ---------------------------------------------------------------------------

export interface MovementDraft {
  type: EntryType
  objectId: string | null
  materialId: string | null
  unitId: string | null
  qtyInput: string
  occurredAt?: string | null
}

export type DraftField = 'object' | 'material' | 'unit' | 'qty' | 'occurredAt'

export type DraftErrorCode =
  | 'required'
  | 'not_number'
  | 'zero'
  | 'negative'
  | 'too_precise'
  | 'too_large'
  | 'out_of_range'

/** Bazadagi qoida: admin bo'lmaganlar uchun `occurred_at` ∈ [now − 3 kun, now + 5 daqiqa]. */
export const OCCURRED_AT_PAST_MS = 3 * DAY_MS
export const OCCURRED_AT_FUTURE_MS = 5 * 60 * 1000

/**
 * `occurred_at` ruxsat etilganmi — bazadagi tekshiruv bilan aynan (chegaralar kiradi).
 * Admin/super_admin — har doim `true`. Noto'g'ri sana satri — `false`.
 */
export function occurredAtAllowed(occurredAtIso: string, nowIso: string, isAdmin: boolean): boolean {
  if (isAdmin) return true
  const t = Date.parse(occurredAtIso)
  const now = Date.parse(nowIso)
  if (!Number.isFinite(t) || !Number.isFinite(now)) return false
  return t >= now - OCCURRED_AT_PAST_MS && t <= now + OCCURRED_AT_FUTURE_MS
}

function blank(s: string | null | undefined): boolean {
  return s === null || s === undefined || s.trim() === ''
}

/**
 * Kirim/chiqim qoralamasini tekshiradi. Xatolar — kodlar (matn `src/i18n/uz.ts` da).
 * `occurredAt` bo'sh bo'lsa — baza `now()` qo'yadi, tekshirilmaydi. `nowIso` berilmasa sana
 * oralig'i tekshirilmaydi (faqat format); admin uchun oraliq cheklovsiz.
 */
export function validateMovementDraft(
  draft: MovementDraft,
  opts?: { nowIso?: string; isAdmin?: boolean },
): { ok: true; qtyInput: Dec } | { ok: false; errors: Partial<Record<DraftField, DraftErrorCode>> } {
  const errors: Partial<Record<DraftField, DraftErrorCode>> = {}
  if (blank(draft.objectId)) errors.object = 'required'
  if (blank(draft.materialId)) errors.material = 'required'
  if (blank(draft.unitId)) errors.unit = 'required'

  const qty = validateQtyInput(draft.qtyInput)
  if (!qty.ok) errors.qty = qty.reason === 'empty' ? 'required' : qty.reason

  if (!blank(draft.occurredAt)) {
    const iso = (draft.occurredAt as string).trim()
    if (!Number.isFinite(Date.parse(iso))) errors.occurredAt = 'out_of_range'
    else if (opts?.nowIso !== undefined && !occurredAtAllowed(iso, opts.nowIso, opts.isAdmin ?? false)) {
      errors.occurredAt = 'out_of_range'
    }
  }

  if (Object.keys(errors).length > 0 || !qty.ok) return { ok: false, errors }
  return { ok: true, qtyInput: qty.value }
}

/**
 * Formada standart obyekt: bitta bo'lsa — o'sha; bir nechta bo'lsa `lastUsed` ro'yxatda
 * bo'lsa — o'sha; aks holda `null` (foydalanuvchi tanlaydi).
 */
export function defaultObjectId(objectIds: string[], lastUsed?: string | null): string | null {
  if (objectIds.length === 1) return objectIds[0] ?? null
  if (lastUsed && objectIds.includes(lastUsed)) return lastUsed
  return null
}
