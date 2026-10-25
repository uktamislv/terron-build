import { formatQty } from '@/lib/format'

export interface QtyPart {
  value: string | bigint
  unit?: string | null
}

function normUnit(unit: string | null | undefined): string {
  return (unit ?? '').trim().toLowerCase()
}

/**
 * Ikki miqdor ko'rinishda bir xilmi ("12 000 dona" va "= 12 000 dona"). Kiritilgan birlik asosiy birlik
 * bilan bir xil bo'lsa ikkinchi (asosiy birlikdagi) qator ko'rsatilmaydi — umumiy qoida.
 */
export function sameQty(a: QtyPart, b: QtyPart): boolean {
  return normUnit(a.unit) === normUnit(b.unit) && formatQty(a.value) === formatQty(b.value)
}
