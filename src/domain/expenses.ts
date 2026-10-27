// Xarajatlar (ombordan tashqari) — sof funksiyalar: summa tekshiruvi, tur tugmalari tartibi, rasm
// majburiyligi, takroriy yozuv, oylik limit va tuzatish. Baza qoidalari bilan bir xil (docs/expenses-design.md).
// Veb dialogi va Telegram ilovasi shu yerdan foydalanadi — komponentlarda takrorlanmaydi.
import { parseSumInput } from './cash'
import { cmp, sub, type Dec } from './decimal'
import { photoRequired } from './rules/photoRequired'

export type ExpenseAmountError = 'required' | 'invalid'

/** Summa maydoni ("41 000") → Dec (> 0). Bo'sh — `required`, noto'g'ri yoki 0 — `invalid`. */
export function validateExpenseAmount(input: string): { ok: true; value: Dec } | { ok: false; error: ExpenseAmountError } {
  if (input.trim() === '') return { ok: false, error: 'required' }
  const v = parseSumInput(input)
  if (v === null || cmp(v, '0') <= 0) return { ok: false, error: 'invalid' }
  return { ok: true, value: v }
}

export interface CategoryLike {
  id: string
  name: string
  sort_order: number
  is_active: boolean
  deleted_at?: string | null
}

export interface CategoryUsage {
  categoryId: string
  useCount: number
  lastUsedAt: string
}

/**
 * Tur tugmalari tartibi: faol va o'chirilmaganlar; ko'p ishlatilgani oldinda (soni, keyin oxirgi vaqt),
 * qolganlari firma tartibi (`sort_order`), keyin nom bo'yicha.
 */
export function rankExpenseCategories<C extends CategoryLike>(categories: readonly C[], usage: readonly CategoryUsage[]): C[] {
  const use = new Map(usage.map((u) => [u.categoryId, u]))
  return categories
    .filter((c) => c.is_active && !c.deleted_at)
    .sort((a, b) => {
      const ua = use.get(a.id)
      const ub = use.get(b.id)
      const ca = ua?.useCount ?? 0
      const cb = ub?.useCount ?? 0
      if (ca !== cb) return cb - ca
      const la = ua ? Date.parse(ua.lastUsedAt) : 0
      const lb = ub ? Date.parse(ub.lastUsedAt) : 0
      if (la !== lb) return (Number.isFinite(lb) ? lb : 0) - (Number.isFinite(la) ? la : 0)
      return a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'uz')
    })
}

/** Rasm nima uchun majburiy: tur belgisi, summa chegarasi; null — ixtiyoriy. */
export type ExpensePhotoRequirement = 'category' | 'amount' | null

/**
 * Xarid qoidasi bilan bir xil (`photoRequired`): QR orqali tasdiqlangan chek — ozod; tur "rasm majburiy" —
 * `category`; `amount ≥ companies.photo_required_amount` — `amount`.
 */
export function expensePhotoRequired(p: {
  amount: Dec | null
  thresholdAmount: Dec | null
  categoryPhotoRequired: boolean
  qrVerified: boolean
}): ExpensePhotoRequirement {
  const r = photoRequired({
    totalAmount: p.amount,
    thresholdAmount: p.thresholdAmount,
    materialPhotoRequired: p.categoryPhotoRequired,
    qrVerified: p.qrVerified,
  })
  return r === 'material' ? 'category' : r
}

export interface ExpenseFingerprint {
  id: string
  createdBy: string
  categoryId: string
  /** null — "Umumiy"; SQL qoidasida null ham teng hisoblanadi (`is not distinct from`). */
  objectId: string | null
  amount: Dec
  createdAt: string
}

/**
 * Takroriy xarajat (`takroriy_yozuv`, belgi): shu muallif, tur, obyekt (null ham teng) va summa
 * `0 ≤ next − prev ≤ windowMinutes` ichida. Eng erta mos yozuv yoki null. `windowMinutes ≤ 0` — o'chiq.
 */
export function findDuplicateExpense(
  prev: readonly ExpenseFingerprint[],
  next: ExpenseFingerprint,
  windowMinutes: number,
): ExpenseFingerprint | null {
  if (!Number.isFinite(windowMinutes) || windowMinutes <= 0) return null
  const nextMs = Date.parse(next.createdAt)
  if (!Number.isFinite(nextMs)) return null
  let best: { e: ExpenseFingerprint; ms: number } | null = null
  for (const p of prev) {
    if (p.id === next.id || p.createdBy !== next.createdBy || p.categoryId !== next.categoryId) continue
    if ((p.objectId ?? null) !== (next.objectId ?? null)) continue
    if (cmp(p.amount, next.amount) !== 0) continue
    const ms = Date.parse(p.createdAt)
    if (!Number.isFinite(ms)) continue
    const age = nextMs - ms
    if (age < 0 || age > windowMinutes * 60_000) continue
    if (best === null || ms < best.ms || (ms === best.ms && p.id < best.e.id)) best = { e: p, ms }
  }
  return best?.e ?? null
}

/** Oylik limit holati: null — limitsiz. `over` — limitdan oshgan qism (≤ 0 — oshmagan). */
export function limitStatus(spent: Dec, limit: Dec | null): { over: boolean; overBy: Dec; remaining: Dec } | null {
  if (limit === null) return null
  const diff = sub(spent, limit)
  const over = cmp(diff, '0') > 0
  return { over, overBy: over ? diff : '0', remaining: over ? '0' : sub(limit, spent) }
}

/** Toshkent oyining boshi va oxiri (`yyyy-mm-dd`) — "shu oy" uchun. */
export function tashkentMonthRange(nowIso: string): { from: string; to: string; month: string } {
  const d = new Date(Date.parse(nowIso) + 5 * 60 * 60 * 1000)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  const mm = String(m + 1).padStart(2, '0')
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}`, month: `${y}-${mm}` }
}

/** Oylik limit maydoni: bo'sh — limitsiz (null); aks holda musbat summa. */
export function parseMonthlyLimit(input: string): { ok: true; value: Dec | null } | { ok: false } {
  if (input.trim() === '') return { ok: true, value: null }
  const v = parseSumInput(input)
  if (v === null || cmp(v, '0') <= 0) return { ok: false }
  return { ok: true, value: v }
}

export interface ExpenseCorrectionDraft {
  original: { amount: Dec; note: string | null; objectId: string | null }
  amountInput: string
  /** Faqat muallif: boshqa obyekt (null — o'zgarmaydi; "Umumiy" ga qaytarib bo'lmaydi — server qoidasi). */
  objectId: string | null
  note: string
  reason: string
}

export interface ExpenseCorrectionValue {
  /** null — o'zgarmaydi. */
  totalAmount: Dec | null
  objectId: string | null
  /** null — o'zgarmaydi; '' — izoh o'chiriladi. */
  note: string | null
  reason: string
}

/** Tuzatish: summa (> 0), majburiy sabab; o'zgarmagan maydon `null` (RPC — "o'zgarmaydi"). */
export function validateExpenseCorrection(
  d: ExpenseCorrectionDraft,
): { ok: true; value: ExpenseCorrectionValue } | { ok: false; errors: { amount?: ExpenseAmountError; reason?: 'required' } } {
  const errors: { amount?: ExpenseAmountError; reason?: 'required' } = {}
  const amount = validateExpenseAmount(d.amountInput)
  if (!amount.ok) errors.amount = amount.error
  const reason = d.reason.trim()
  if (!reason) errors.reason = 'required'
  if (!amount.ok || errors.reason) return { ok: false, errors }
  const note = d.note.trim()
  return {
    ok: true,
    value: {
      totalAmount: cmp(amount.value, d.original.amount) === 0 ? null : amount.value,
      objectId: d.objectId && d.objectId !== d.original.objectId ? d.objectId : null,
      note: note === (d.original.note ?? '').trim() ? null : note,
      reason,
    },
  }
}

/**
 * Xarajat obyekti (standart): bitta obyekt — o'sha; aks holda oxirgi tanlangani (hali ro'yxatda bo'lsa);
 * `general` — "Umumiy" saqlangan; topilmasa — null ("Umumiy"). 3–4 bosish: obyekt odatda tanlanmaydi.
 */
export function defaultExpenseObject(objectIds: readonly string[], last: string | null, general = 'none'): string | null {
  if (objectIds.length === 1) return objectIds[0] ?? null
  if (!last || last === general) return null
  return objectIds.includes(last) ? last : null
}
