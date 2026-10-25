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
