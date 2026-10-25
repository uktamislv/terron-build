// Material formasi yordamchilari — sof funksiyalar.
import { cmp, parseDec, scaleOf, type Dec } from '@/domain/decimal'

/** Asosiy birlik uchun tez tanlash tugmalari. */
export const QUICK_BASE_UNITS: readonly string[] = ['dona', 'kg', 't', 'm', 'm²', 'm³', 'l', 'qop']

/** Isrof foizi: bo'sh — 0; aks holda 0 ≤ x < 100, ko'pi bilan 2 kasr xona (numeric(6,2)). */
export function parseWastePct(input: string): Dec | null {
  if (!input.trim()) return '0'
  const value = parseDec(input)
  if (value === null || cmp(value, '0') < 0 || cmp(value, '100') >= 0 || scaleOf(value) > 2) return null
  return value
}
