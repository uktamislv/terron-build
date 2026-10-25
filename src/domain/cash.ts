// Podotchet (qo'limdagi pul) — sof funksiyalar (docs/purchase-design.md, "Sof funksiyalar").
// Pul — so'm, `numeric(18,2)`: 2 kasr xonagacha, butun qism 16 xonagacha.

import { add, intDigitsOf, isNegative, parseDec, sub, type Dec } from './decimal'

/** `numeric(18,2)` — butun qismdagi eng ko'p raqamlar. */
const SUM_MAX_INT_DIGITS = 16
const SUM_MAX_SCALE = 2
/** Kiritish satrining eng katta uzunligi (bo'sh joylar bilan birga). */
const SUM_MAX_INPUT_LENGTH = 64

function sum(values: Dec[]): Dec {
  return values.reduce<Dec>((acc, v) => add(acc, v), '0')
}

/** Qo'limdagi pul = Σ berilgan − Σ sarflangan (manfiy bo'lishi mumkin). */
export function cashBalance(issued: Dec[], spent: Dec[]): Dec {
  return sub(sum(issued), sum(spent))
}

/**
 * Summa kiritishini o'qiydi: "1 250 000", "1 250 000,50", "99.5".
 * Bo'sh joy (oddiy, NBSP, tor NBSP) — minglik ajratuvchi; vergul yoki nuqta — kasr.
 * null: bo'sh, manfiy yoki ishorali, 2 dan ortiq kasr xona ("1.500" ham — minglik nuqta
 * bo'lishi mumkin, noaniq), `numeric(18,2)` dan katta, 64 belgidan uzun, noto'g'ri belgi.
 */
export function parseSumInput(input: string): Dec | null {
  if (input.length > SUM_MAX_INPUT_LENGTH) return null
  const compact = input.replace(/\s/g, '')
  if (!/^\d*(?:[.,]\d*)?$/.test(compact)) return null
  const fracLen = compact.split(/[.,]/)[1]?.length ?? 0
  if (fracLen > SUM_MAX_SCALE) return null
  const value = parseDec(compact)
  if (value === null || isNegative(value)) return null
  if (intDigitsOf(value) > SUM_MAX_INT_DIGITS) return null
  return value
}

/**
 * Yozish paytida formatlash: butun qism raqamlari minglik bo'sh joy bilan guruhlanadi,
 * birinchi kasr ajratuvchi (vergul yoki nuqta, yozilganidek) va kasr raqamlari saqlanadi.
 * Raqam bo'lmagan belgilar va ortiqcha ajratuvchilar tashlanadi; boshidagi nollar bittaga
 * qisqaradi ("007" → "7", "000" → "0").
 * Idempotent: `formatSumInput(formatSumInput(x)) === formatSumInput(x)` — kursorni
 * "kursordan oldingi raqamlar soni" bo'yicha tiklash mumkin.
 */
export function formatSumInput(input: string): string {
  const m = /[.,]/.exec(input)
  const intRaw = (m ? input.slice(0, m.index) : input).replace(/\D/g, '')
  const intDigits = intRaw === '' ? '' : intRaw.replace(/^0+(?=\d)/, '')
  const grouped = intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  if (!m) return grouped
  const fracDigits = input.slice(m.index + 1).replace(/\D/g, '')
  return `${grouped}${m[0]}${fracDigits}`
}
