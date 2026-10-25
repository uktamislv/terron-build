// Diagramma qatorlari uchun sof yordamchilar.
import { add, cmp, type Dec } from '../decimal'
import { dayNumberToIso, isoToDayNumber } from './period'

/**
 * `from..to` (ikkalasi ham kiradi) oralig'idagi har kun uchun bitta qator qaytaradi, tartiblangan.
 * Yo'q kunlar `empty(day)` bilan to'ldiriladi. Bir kun bir necha marta kelsa — birinchisi olinadi.
 * Oraliqdan tashqaridagi qatorlar tashlanadi. Noto'g'ri yoki teskari oraliq → bo'sh ro'yxat.
 */
export function fillDays<T extends { day: string }>(rows: T[], from: string, to: string, empty: (day: string) => T): T[] {
  const a = isoToDayNumber(from)
  const b = isoToDayNumber(to)
  if (a === null || b === null || a > b) return []
  const byDay = new Map<string, T>()
  for (const r of rows) if (!byDay.has(r.day)) byDay.set(r.day, r)
  const out: T[] = []
  for (let d = a; d <= b; d++) {
    const iso = dayNumberToIso(d)
    out.push(byDay.get(iso) ?? empty(iso))
  }
  return out
}

/**
 * Qiymat bo'yicha kamayish tartibida birinchi `n` ta qator; qolganlari bitta "Boshqa" qatoriga
 * (`makeOther(yig'indi, soni)`) yig'iladi. Teng qiymatlar asl tartibini saqlaydi (barqaror).
 * Qolgan qator bo'lmasa — "Boshqa" qo'shilmaydi. `n` ≤ 0 → hammasi "Boshqa"ga.
 */
export function topN<T>(rows: T[], n: number, value: (r: T) => Dec, makeOther: (sum: Dec, count: number) => T): T[] {
  const k = Math.max(0, Math.floor(n))
  const sorted = rows.map((r, i) => ({ r, i, v: value(r) })).sort((x, y) => cmp(y.v, x.v) || x.i - y.i)
  const head = sorted.slice(0, k).map((x) => x.r)
  const rest = sorted.slice(k)
  if (rest.length === 0) return head
  const sum = rest.reduce<Dec>((s, x) => add(s, x.v), '0')
  return [...head, makeOther(sum, rest.length)]
}
