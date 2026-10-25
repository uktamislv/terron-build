// Sarlavha qatorini topish va shablon imzosi (smeta importi, Batch 7).
import { normalizeAlias } from '../aliases'
import { cellText } from './cells'
import { autoMapColumns } from './mapping'
import type { Cell } from './types'

/** Ustun raqamlari qatoridagi qisqa birlik belgisi ("ЧЕЛ-Ч", "МАШ-Ч"): bo'sh joysiz, ≤ 8 belgi. */
const SHORT_TOKEN = /^[\p{L}][\p{L}.\-/]{0,7}$/u

/**
 * Ustun raqamlari qatori ("1 | 2 | 3 | … | 8 | ЧЕЛ-Ч | ЧЕЛ-Ч"): kamida 3 ta butun son, ular
 * birinchidan boshlab ketma-ket +1 qadam bilan o'sadi; qolgan kataklar faqat qisqa belgilar
 * (birliklar). Bunday qator sarlavha bo'la olmaydi.
 */
export function isColumnNumberingRow(row: Cell[]): boolean {
  const nums: number[] = []
  for (const c of Array.from(row)) {
    const t = cellText(c)
    if (t === '') continue
    if (/^\d+$/.test(t)) nums.push(Number(t))
    else if (!SHORT_TOKEN.test(t)) return false
  }
  if (nums.length < 3) return false
  return nums.every((v, i) => i === 0 || v === (nums[i - 1] ?? NaN) + 1)
}

/**
 * Birinchi `maxScan` qator ichida eng ko'p maydon mos keladigan qator (0 dan indeks).
 * Nomzod bo'lishi uchun kamida `name` va (`qty` yoki `unit`) topilishi kerak; ustun
 * raqamlari qatori (`isColumnNumberingRow`) nomzod emas.
 * Teng bo'lsa — yuqoridagisi. Topilmasa — null.
 */
export function detectHeaderRow(rows: Cell[][], maxScan = 30): number | null {
  let best: number | null = null
  let bestScore = 0
  const limit = Math.min(rows.length, Math.max(0, maxScan))
  for (let i = 0; i < limit; i++) {
    const row = rows[i] ?? []
    if (isColumnNumberingRow(row)) continue
    const m = autoMapColumns(row)
    if (m.name === undefined || (m.qty === undefined && m.unit === undefined)) continue
    const score = Object.keys(m).length
    if (score > bestScore) {
      best = i
      bestScore = score
    }
  }
  return best
}

/**
 * Firma shablonini tanish uchun imzo: har katak `normalizeAlias(String(cell ?? ''))`,
 * oxiridagi bo'sh kataklar olib tashlanadi, `|` bilan birlashtiriladi.
 */
export function headerSignature(header: Cell[]): string {
  // Array.from — SheetJS siyrak massivlaridagi "teshiklar" ham bo'sh katak sifatida
  const parts = Array.from(header,(cell) => normalizeAlias(String(cell ?? '')))
  while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop()
  return parts.join('|')
}
