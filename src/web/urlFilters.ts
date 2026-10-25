// Sahifa filtrlari uchun URL query o'qish (bosh sahifa kartochkalaridagi havolalar). Sof funksiyalar.
import { validateRange } from '@/domain/reports'
import { isUuid } from '@/lib/uuid'

/** `yyyy-mm-dd` bo'lsa — o'zi, aks holda bo'sh satr. */
export function paramDate(params: URLSearchParams, key: string): string {
  const v = params.get(key) ?? ''
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && validateRange(v, v) === 'ok' ? v : ''
}

/** Ro'yxatdagi qiymatlardan biri bo'lsa — o'zi, aks holda `fallback`. */
export function paramOneOf<T extends string>(params: URLSearchParams, key: string, list: readonly T[], fallback: T | ''): T | '' {
  const v = params.get(key)
  return v !== null && (list as readonly string[]).includes(v) ? (v as T) : fallback
}

/** Id (obyekt, material) — faqat UUID; aks holda bo'sh. */
export function paramId(params: URLSearchParams, key: string): string {
  const v = params.get(key) ?? ''
  return isUuid(v) ? v : ''
}
