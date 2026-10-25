// Sarlavha qatorini topish va shablon imzosi (smeta importi, Batch 7).
import { normalizeAlias } from '../aliases'
import { autoMapColumns } from './mapping'
import type { Cell } from './types'

/**
 * Birinchi `maxScan` qator ichida eng ko'p maydon mos keladigan qator (0 dan indeks).
 * Nomzod bo'lishi uchun kamida `name` va (`qty` yoki `unit`) topilishi kerak.
 * Teng bo'lsa — yuqoridagisi. Topilmasa — null.
 */
export function detectHeaderRow(rows: Cell[][], maxScan = 30): number | null {
  let best: number | null = null
  let bestScore = 0
  const limit = Math.min(rows.length, Math.max(0, maxScan))
  for (let i = 0; i < limit; i++) {
    const m = autoMapColumns(rows[i] ?? [])
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
