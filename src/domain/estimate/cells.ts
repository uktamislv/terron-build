// Kataklarni o'qish: matn va o'nlik son (float yo'q).
import { parseDec, round, type Dec } from '../decimal'
import type { Cell } from './types'

/** float artefaktlari (0.30000000000000004) shu xonagacha yaxlitlab tozalanadi. */
const CLEAN_SCALE = 10
const SIG_DIGITS = 15
const SPACE_RUN = /\s+/g // JS \s NBSP va tor NBSP ni ham qamraydi
const DASH_ONLY = /^[-–—]+$/

/**
 * JS number → aniq o'nlik satr. `Number.prototype.toString` emas: eksponentasiz,
 * ≤ 15 qiymatli raqam, keyin 10 kasr xonagacha yaxlitlanadi (half away from zero).
 * `numberToDec(0.1 + 0.2) = '0.3'`, `numberToDec(1e21) = '1000000000000000000000'`.
 * NaN / ±Infinity → null.
 */
export function numberToDec(n: number): Dec | null {
  if (!Number.isFinite(n)) return null
  if (n === 0) return '0'
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(n.toPrecision(SIG_DIGITS))
  if (!m) return null
  const sign = m[1] ?? ''
  const intPart = m[2] ?? ''
  const digits = intPart + (m[3] ?? '')
  const point = intPart.length + Number(m[4] ?? '0')
  let s: string
  if (point <= 0) s = `0.${'0'.repeat(-point)}${digits}`
  else if (point >= digits.length) s = digits + '0'.repeat(point - digits.length)
  else s = `${digits.slice(0, point)}.${digits.slice(point)}`
  return round(sign + s, CLEAN_SCALE)
}

/** Katak matni: chetlari kesilgan, ichki bo'sh joy ketma-ketligi → bitta probel. */
export function cellText(c: Cell | undefined): string {
  if (c === null || c === undefined) return ''
  if (typeof c === 'number') return numberToDec(c) ?? String(c)
  return String(c).replace(SPACE_RUN, ' ').trim()
}

export type DecCell = { state: 'empty' } | { state: 'ok'; value: Dec } | { state: 'invalid' }

/**
 * Katak → son. number — `numberToDec`; satr — `parseDec` (bo'sh joy, NBSP minglik, vergul kasr).
 * Bo'sh satr va faqat tire ("-", "—") — bo'sh. Boolean — noto'g'ri.
 */
export function cellToDec(c: Cell | undefined): DecCell {
  if (c === null || c === undefined) return { state: 'empty' }
  if (typeof c === 'number') {
    const v = numberToDec(c)
    return v === null ? { state: 'invalid' } : { state: 'ok', value: v }
  }
  if (typeof c === 'boolean') return { state: 'invalid' }
  const s = cellText(c)
  if (s === '' || DASH_ONLY.test(s)) return { state: 'empty' }
  const v = parseDec(s)
  return v === null ? { state: 'invalid' } : { state: 'ok', value: v }
}
