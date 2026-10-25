// BigInt asosidagi o'nlik arifmetika — float yo'q (CLAUDE.md, 7-qoida).
// Qiymatlar kanonik o'nlik satrlar: "-12.5", "0.000001", "50" (ortiqcha nollarsiz, "-0" yo'q).
// Natijalar PostgreSQL `numeric` bilan bir xil: yaxlitlash — half away from zero (`round(2.5) = 3`,
// `round(-2.5) = -3`).

export type Dec = string

/** Ichki ko'rinish: qiymat = int / 10^scale. */
interface Raw {
  int: bigint
  scale: number
}

const DEC_RE = /^([+-])?(\d*)(?:[.,](\d*))?$/
// Bo'sh joylar: oddiy, NBSP, tor NBSP, tab va h.k. ("1 250 000")
// JS `\s` NBSP (U+00A0) va tor NBSP (U+202F) ni ham qamraydi.
const SPACE_RE = /\s/g

/** parseDec qabul qiladigan eng uzun kirish (bo'sh joylar olib tashlangandan keyin). */
export const MAX_DEC_INPUT_LENGTH = 64

function pow10(n: number): bigint {
  return 10n ** BigInt(n)
}

/** `maxLength` — faqat foydalanuvchi kiritishi (parseDec) uchun; ichki hisoblar cheklanmaydi. */
function parseRaw(input: string, maxLength = Infinity): Raw | null {
  const s = input.replace(SPACE_RE, '')
  if (s.length > maxLength) return null
  const m = DEC_RE.exec(s)
  if (!m) return null
  const intDigits = m[2] ?? ''
  // Oxirgi nollar satr darajasida kesiladi (BigInt sikli emas — O(n²) yo'q)
  const fracDigits = (m[3] ?? '').replace(/0+$/, '')
  if (intDigits === '' && (m[3] ?? '') === '') return null
  const neg = m[1] === '-'
  const abs = BigInt((intDigits || '0') + fracDigits)
  return { int: neg ? -abs : abs, scale: fracDigits.length }
}

function raw(a: Dec): Raw {
  const r = parseRaw(a)
  if (r === null) throw new Error(`decimal: noto'g'ri qiymat: ${JSON.stringify(a)}`)
  return r
}

/** Raw → kanonik satr (ortiqcha nollarsiz). */
function fmt(r: Raw): Dec {
  if (r.int === 0n) return '0'
  const neg = r.int < 0n
  let digits = (neg ? -r.int : r.int).toString()
  if (r.scale > 0) {
    digits = digits.padStart(r.scale + 1, '0')
    const frac = digits.slice(digits.length - r.scale).replace(/0+$/, '')
    const int = digits.slice(0, digits.length - r.scale)
    digits = frac === '' ? int : `${int}.${frac}`
  }
  return neg ? `-${digits}` : digits
}

function align(a: Raw, b: Raw): [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale)
  return [a.int * pow10(scale - a.scale), b.int * pow10(scale - b.scale), scale]
}

function assertScale(scale: number): void {
  if (!Number.isInteger(scale) || scale < 0) throw new Error(`decimal: scale manfiy bo'lmagan butun son bo'lishi kerak: ${scale}`)
}

/** n / d, natija half away from zero bo'yicha butungacha yaxlitlanadi. */
function divRoundHalfAway(n: bigint, d: bigint): bigint {
  const q = n / d
  const r = n % d
  if (r === 0n) return q
  const absR = r < 0n ? -r : r
  const absD = d < 0n ? -d : d
  if (2n * absR >= absD) {
    const positive = n < 0n === d < 0n
    return positive ? q + 1n : q - 1n
  }
  return q
}

function roundRaw(a: Raw, scale: number): Raw {
  if (a.scale <= scale) return a
  return { int: divRoundHalfAway(a.int, pow10(a.scale - scale)), scale }
}

/**
 * Foydalanuvchi kiritgan matnni o'nlik songa aylantiradi.
 * Qabul qiladi: "1,5", "1.5", "1 250 000", "+3", "-0.25", ".5", "5.".
 * Rad etadi (null): bo'sh, eksponenta ("1e5"), bir nechta ajratuvchi, harflar.
 */
export function parseDec(input: string): Dec | null {
  const r = parseRaw(input, MAX_DEC_INPUT_LENGTH)
  return r === null ? null : fmt(r)
}

/** Kasr qismidagi raqamlar soni (kanonik ko'rinishda). */
export function scaleOf(a: Dec): number {
  return fmt(raw(a)).split('.')[1]?.length ?? 0
}

/** Butun qismidagi raqamlar soni (ishorasiz; "0.5" → 1, "0" → 1). */
export function intDigitsOf(a: Dec): number {
  return fmt(raw(a)).replace('-', '').split('.')[0]?.length ?? 1
}

export function add(a: Dec, b: Dec): Dec {
  const [x, y, scale] = align(raw(a), raw(b))
  return fmt({ int: x + y, scale })
}

export function sub(a: Dec, b: Dec): Dec {
  const [x, y, scale] = align(raw(a), raw(b))
  return fmt({ int: x - y, scale })
}

export function mul(a: Dec, b: Dec): Dec {
  const x = raw(a)
  const y = raw(b)
  return fmt({ int: x.int * y.int, scale: x.scale + y.scale })
}

/**
 * a / b — aniq bo'linma, `scale` xonagacha half away from zero bilan yaxlitlangan
 * (matematik jihatdan to'g'ri yaxlitlash, oraliq xatosiz). b = 0 → xato.
 */
export function div(a: Dec, b: Dec, scale: number): Dec {
  assertScale(scale)
  const x = raw(a)
  const y = raw(b)
  if (y.int === 0n) throw new Error('decimal: nolga bo\'lish')
  // (x.int / 10^xs) / (y.int / 10^ys) * 10^scale = x.int * 10^(ys + scale) / (y.int * 10^xs)
  const n = x.int * pow10(y.scale + scale)
  const d = y.int * pow10(x.scale)
  return fmt({ int: divRoundHalfAway(n, d), scale })
}

/** PostgreSQL `round(numeric, scale)` — half away from zero. */
export function round(a: Dec, scale: number): Dec {
  assertScale(scale)
  return fmt(roundRaw(raw(a), scale))
}

export function cmp(a: Dec, b: Dec): -1 | 0 | 1 {
  const [x, y] = align(raw(a), raw(b))
  return x < y ? -1 : x > y ? 1 : 0
}

export function isZero(a: Dec): boolean {
  return raw(a).int === 0n
}

export function isNegative(a: Dec): boolean {
  return raw(a).int < 0n
}

export function abs(a: Dec): Dec {
  const r = raw(a)
  return fmt({ int: r.int < 0n ? -r.int : r.int, scale: r.scale })
}

export function neg(a: Dec): Dec {
  const r = raw(a)
  return fmt({ int: -r.int, scale: r.scale })
}

/** Ko'rsatish uchun aniq `scale` xona: "50" → "50.00", "1.005" (2) → "1.01". */
export function toFixedScale(a: Dec, scale: number): string {
  assertScale(scale)
  const r = roundRaw(raw(a), scale)
  const int = r.int * pow10(scale - r.scale)
  const neg = int < 0n
  let digits = (neg ? -int : int).toString()
  if (scale > 0) {
    digits = digits.padStart(scale + 1, '0')
    digits = `${digits.slice(0, digits.length - scale)}.${digits.slice(digits.length - scale)}`
  }
  return neg ? `-${digits}` : digits
}

// ---------------------------------------------------------------------------
// PostgreSQL `numeric / numeric` operatorining aniq nusxasi.
// PostgreSQL bo'linmani `select_div_scale` tanlagan aniqlikkacha (kamida 16 ta qiymatli
// raqam) hisoblaydi. Shuning uchun `round(a / b, s)` ba'zan ikki marta yaxlitlanadi va
// `div(a, b, s)` dan farq qilishi mumkin. Bazadagi triggerni aynan takrorlash kerak
// bo'lganda (masalan `purchasePrices`) shu funksiya ishlatiladi.
// ---------------------------------------------------------------------------

const NUMERIC_MIN_SIG_DIGITS = 16
const DEC_DIGITS = 4
const NUMERIC_MAX_DISPLAY_SCALE = 1000

/** NBASE=10000 ko'rinishidagi birinchi nolmas raqam guruhining og'irligi va qiymati. */
function nbaseLead(r: Raw): { weight: number; first: number } {
  if (r.int === 0n) return { weight: 0, first: 0 }
  const digits = (r.int < 0n ? -r.int : r.int).toString().padStart(r.scale + 1, '0')
  const intPart = digits.slice(0, digits.length - r.scale).replace(/^0+/, '')
  if (intPart !== '') {
    const weight = Math.floor((intPart.length - 1) / DEC_DIGITS)
    return { weight, first: Number(intPart.slice(0, intPart.length - weight * DEC_DIGITS)) }
  }
  let frac = digits.slice(digits.length - r.scale)
  frac = frac.padEnd(Math.ceil(frac.length / DEC_DIGITS) * DEC_DIGITS, '0')
  for (let k = 0; k * DEC_DIGITS < frac.length; k++) {
    const group = Number(frac.slice(k * DEC_DIGITS, (k + 1) * DEC_DIGITS))
    if (group !== 0) return { weight: -(k + 1), first: group }
  }
  return { weight: 0, first: 0 }
}

/**
 * PostgreSQL `a / b` (numeric) natijasi. `aScale`/`bScale` — operandlarning `dscale`i
 * (ustun turidagi kasr xonalari, masalan numeric(18,2) → 2); berilmasa satrdagi xonalar soni.
 */
export function pgNumericDiv(a: Dec, b: Dec, aScale?: number, bScale?: number): Dec {
  const x = raw(a)
  const y = raw(b)
  const xs = aScale ?? literalScale(a)
  const ys = bScale ?? literalScale(b)
  const l1 = nbaseLead(x)
  const l2 = nbaseLead(y)
  let qweight = l1.weight - l2.weight
  if (l1.first <= l2.first) qweight--
  let rscale = NUMERIC_MIN_SIG_DIGITS - qweight * DEC_DIGITS
  rscale = Math.max(rscale, xs, ys, 0)
  rscale = Math.min(rscale, NUMERIC_MAX_DISPLAY_SCALE)
  return div(a, b, rscale)
}

/** Satrda yozilgan kasr xonalari soni (oxirgi nollar bilan) — PostgreSQL literal `dscale`i. */
function literalScale(a: string): number {
  return DEC_RE.exec(a.replace(SPACE_RE, ''))?.[3]?.length ?? 0
}
