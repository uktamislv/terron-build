// Farq qoidasi 5 — inventarizatsiya kamomadi. Bazadagi `submit_inventory_count` bilan bir xil:
//   shortage       = expected - counted (faqat counted < expected)
//   shortage_value = round(shortage * price_per_base, 2)
//   total ≥ 1 000 000 so'm → jiddiy

import { cmp, mul, round, sub, type Dec } from './decimal'

export interface InventoryLine {
  materialId: string
  expected: Dec
  counted: Dec
}

export interface ShortageItem {
  materialId: string
  shortage: Dec
}

export interface SurplusItem {
  materialId: string
  surplus: Dec
}

export type ShortageSeverity = 'ogohlantirish' | 'jiddiy'

const SEVERE_TOTAL_VALUE = '1000000'

function byAmountDesc<T extends { materialId: string }>(get: (x: T) => Dec) {
  return (a: T, b: T): number => {
    const c = cmp(get(b), get(a))
    if (c !== 0) return c
    return a.materialId < b.materialId ? -1 : a.materialId > b.materialId ? 1 : 0
  }
}

/** counted < expected bo'lgan qatorlar; kattasidan kichigiga, teng bo'lsa materialId bo'yicha. */
export function shortageItems(items: InventoryLine[]): ShortageItem[] {
  return items
    .filter((i) => cmp(i.counted, i.expected) < 0)
    .map((i) => ({ materialId: i.materialId, shortage: sub(i.expected, i.counted) }))
    .sort(byAmountDesc((x) => x.shortage))
}

/** counted > expected bo'lgan qatorlar (ortiqcha); kattasidan kichigiga, teng bo'lsa materialId bo'yicha. */
export function surplusItems(items: InventoryLine[]): SurplusItem[] {
  return items
    .filter((i) => cmp(i.counted, i.expected) > 0)
    .map((i) => ({ materialId: i.materialId, surplus: sub(i.counted, i.expected) }))
    .sort(byAmountDesc((x) => x.surplus))
}

/** round(shortage * price, 2); narx yo'q → null. */
export function shortageValue(shortage: Dec, pricePerBase: Dec | null): Dec | null {
  if (pricePerBase === null) return null
  return round(mul(shortage, pricePerBase), 2)
}

/** total ≥ 1 000 000 → jiddiy; null yoki kam → ogohlantirish. */
export function shortageSeverity(totalValue: Dec | null): ShortageSeverity {
  if (totalValue !== null && cmp(totalValue, SEVERE_TOTAL_VALUE) >= 0) return 'jiddiy'
  return 'ogohlantirish'
}

/** inventory_adjust harakati miqdori: counted - expected (ishorali). */
export function adjustmentFor(expected: Dec, counted: Dec): Dec {
  return sub(counted, expected)
}
