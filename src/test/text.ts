// Test yordamchisi: matni bir nechta element bo'ylab bo'lingan qiymatlarni topish
// (masalan `Qty`: <span>150</span><span>kg</span> — ko'rinishda "150 kg").
import type { MatcherFunction } from '@testing-library/react'

function normalize(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * `getByText(textOf('150 kg'))` — elementning to'liq matni (bo'shliqlar normallashtirilgan) mos
 * kelsa va hech bir bola elementi o'zi to'liq mos kelmasa (eng ichki mos element).
 */
export function textOf(expected: string): MatcherFunction {
  const want = normalize(expected)
  return (_content, element) => {
    if (!element) return false
    const text = (el: Element) => normalize(Array.from(el.childNodes).map((n) => n.textContent).join(' '))
    if (text(element) !== want) return false
    return !Array.from(element.children).some((child) => text(child) === want)
  }
}

/**
 * Tipografik bo'shliqlarni (U+202F minglik, U+00A0 raqam–birlik) oddiy bo'shliqqa aylantiradi —
 * matnni solishtiruvchi testlar o'qilishi oson bo'lsin. Minus (U+2212) o'zgarmaydi: u ko'rinadigan belgi.
 * Aniq belgilar `src/lib/format.test.ts` da tekshiriladi.
 */
export function plain(s: string): string {
  return s.replace(/[\u202F\u00A0]/g, ' ')
}
