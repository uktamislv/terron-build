// I bo'lim — podotchet muddati (`podotchet_muddati`, ogohlantirish) va manfiy balans
// (`podotchet_manfiy`, belgi). FIFO: sarflar va qaytarishlar eng eski berilgan puldan yopadi.
// Sanalar — Toshkent kuni, `yyyy-mm-dd` (SQL: `(created_at at time zone 'Asia/Tashkent')::date`).

import { add, cmp, isNegative, isZero, sub, type Dec } from '../decimal'
import { daysBetween } from '../reports/period'

export type CashEntryKind = 'berildi' | 'qaytarildi' | 'sarf'

export interface CashEntry {
  kind: CashEntryKind
  /** Musbat summa (so'm). */
  amount: Dec
  /** Toshkent kuni, `yyyy-mm-dd`. */
  date: string
}

export interface CashAgingResult {
  /** berildi − qaytarildi − sarf. */
  balance: Dec
  /** Eng eski yopilmagan berilgan pul sanasi; balans ≤ 0 → null. */
  oldestOpenDate: string | null
  /** Shu berilgan puldan yopilmay qolgan qism; balans ≤ 0 → null. */
  oldestOpenRemaining: Dec | null
  /** `today − oldestOpenDate` kunlarda; oldestOpenDate null bo'lsa — null. */
  ageDays: number | null
  /** balans > 0 va `ageDays > maxDays` (aynan maxDays — muddati o'tmagan). */
  overdue: boolean
  /** balans < 0 → `podotchet_manfiy`. */
  negative: boolean
}

export const DEFAULT_CASH_MAX_DAYS = 14

/**
 * FIFO hisobi. Berilganlar sana bo'yicha (teng sanada — kirish tartibida) saralanadi; jami
 * sarf + qaytarish ularni eskisidan boshlab yopadi (sarf sanasi muhim emas). Birinchi qisman yoki
 * to'liq ochiq berilgan pul — `oldestOpenDate`. Noto'g'ri sana — xato.
 */
export function cashAging(
  entries: readonly CashEntry[],
  today: string,
  maxDays: number = DEFAULT_CASH_MAX_DAYS,
): CashAgingResult {
  const issues: { amount: Dec; date: string; i: number }[] = []
  let consumed: Dec = '0'
  let issued: Dec = '0'
  entries.forEach((e, i) => {
    if (e.kind === 'berildi') {
      issues.push({ amount: e.amount, date: e.date, i })
      issued = add(issued, e.amount)
    } else {
      consumed = add(consumed, e.amount)
    }
  })
  const balance = sub(issued, consumed)
  const negative = isNegative(balance)
  const closed: CashAgingResult = {
    balance,
    oldestOpenDate: null,
    oldestOpenRemaining: null,
    ageDays: null,
    overdue: false,
    negative,
  }
  if (negative || isZero(balance)) return closed
  issues.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.i - b.i))
  let left = consumed
  for (const iss of issues) {
    if (cmp(left, iss.amount) >= 0) {
      left = sub(left, iss.amount)
      continue
    }
    const ageDays = daysBetween(iss.date, today)
    return {
      balance,
      oldestOpenDate: iss.date,
      oldestOpenRemaining: sub(iss.amount, left),
      ageDays,
      overdue: ageDays > maxDays,
      negative: false,
    }
  }
  return closed // balance > 0 bo'lsa bu yerga yetib kelmaydi
}
