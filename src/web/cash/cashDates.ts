// Podotchet sanasi: forma `yyyy-mm-dd` (Asia/Tashkent) → `issued_at`.
// Qoida kirim/chiqim va xarid bilan bir xil (`src/domain/entryDate.ts`): admin bo'lmaganlarga oxirgi 3 kun
// (server `ops_occurred_at_range` beradi), admin — istalgan o'tgan sana.
import { entryDateBounds, entryDateToIso, tashkentDateOf } from '@/domain/entryDate'

/** Bugungi sana Toshkent bo'yicha, `yyyy-mm-dd`. */
export function todayTashkent(now: Date = new Date()): string {
  return tashkentDateOf(now.getTime())
}

/** Sana maydoni chegaralari (`min` — admin bo'lmaganlarga oxirgi 3 kun, `max` — bugun). */
export function issuedAtBounds(nowIso: string, isAdmin: boolean): { min: string | undefined; max: string } {
  return entryDateBounds(nowIso, isAdmin)
}

/**
 * Bugun — `null` (server `now()` qo'yadi); boshqa kun — shu kunning hozirgi soati (Toshkent), oynaning
 * eski chetiga yaqin bo'lsa — chegara ichida. Noto'g'ri, kelajak yoki ruxsat etilmagan sana — `undefined`.
 */
export function issuedAtIso(date: string, nowIso: string, isAdmin: boolean): string | null | undefined {
  return entryDateToIso(date, nowIso, isAdmin)
}
