// Birlik konvertatsiyasi — yagona joy (CLAUDE.md, 6-qoida).
// Formulalar bazadagi `private.tg_compute_qty` trigger (b_compute_qty) bilan aynan bir xil:
//   qty_base       = round(qty_input * factor, 6)
//   unit_price     = round(total_amount / qty_input, 2)
//   price_per_base = round(total_amount / qty_base, 4)

import {
  cmp,
  div,
  intDigitsOf,
  isNegative,
  isZero,
  mul,
  parseDec,
  pgNumericDiv,
  round,
  scaleOf,
  type Dec,
} from './decimal'

/** `material_units` qatori: 1 `unit` = `factor` asosiy birlik. */
export interface UnitDef {
  id: string
  materialId: string
  unit: string
  factor: Dec
  variant: string | null
}

/** numeric(20,6) — miqdorlar (qty_input, qty_base). */
export const QTY_SCALE = 6
/** numeric(18,2) — pul (total_amount, unit_price). */
export const MONEY_SCALE = 2
/** numeric(18,4) — price_per_base. */
export const PRICE_PER_BASE_SCALE = 4

/** numeric(20,10) — material_units.factor. */
const FACTOR_INT_DIGITS = 10
const FACTOR_FRAC_DIGITS = 10
/** numeric(20,6) — qty_input. */
const QTY_INT_DIGITS = 14

/** Kiritilgan miqdorni asosiy birlikka: `round(qty_input * factor, 6)`. */
export function toBaseQty(qtyInput: Dec, factor: Dec): Dec {
  return round(mul(qtyInput, factor), QTY_SCALE)
}

/** Asosiy birlikdagi miqdorni boshqa birlikka (ko'rsatish uchun): `qty_base / factor`. */
export function fromBaseQty(qtyBase: Dec, factor: Dec, scale: number = QTY_SCALE): Dec {
  return div(qtyBase, factor, scale)
}

/**
 * Xarid narxlari — bazadagi trigger formulalari, PostgreSQL `numeric /` semantikasi bilan
 * (oraliq aniqlik ham bir xil). Kirish qiymatlari avval ustun turlariga keltiriladi:
 * total_amount → numeric(18,2), qty_input / qty_base → numeric(20,6).
 * Miqdor 0 bo'lsa narx 0 (triggerdagi `coalesce(... nullif(qty, 0) ..., 0)`).
 */
export function purchasePrices(totalAmount: Dec, qtyInput: Dec, qtyBase: Dec): { unitPrice: Dec; pricePerBase: Dec } {
  const total = round(totalAmount, MONEY_SCALE)
  const qi = round(qtyInput, QTY_SCALE)
  const qb = round(qtyBase, QTY_SCALE)
  const unitPrice = isZero(qi) ? '0' : round(pgNumericDiv(total, qi, MONEY_SCALE, QTY_SCALE), MONEY_SCALE)
  const pricePerBase = isZero(qb) ? '0' : round(pgNumericDiv(total, qb, MONEY_SCALE, QTY_SCALE), PRICE_PER_BASE_SCALE)
  return { unitPrice, pricePerBase }
}

/** "m²" yoki "m² devor · bir g'isht · 250 mm". */
export function unitLabel(u: Pick<UnitDef, 'unit' | 'variant'>): string {
  const variant = u.variant?.trim()
  return variant ? `${u.unit.trim()} · ${variant}` : u.unit.trim()
}

function norm(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Birlikni nomi (va varianti) bo'yicha topadi — katta-kichik harf va chetdagi bo'sh joylar
 * hisobga olinmaydi.
 * - `variant` satr → aynan shu variantli birlik;
 * - `variant === null` → faqat variantsiz birlik (bazadagi `unit_input` qulayligi kabi);
 * - `variant` berilmagan → avval variantsiz birlik; u bo'lmasa va shu nomli birlik bitta
 *   bo'lsa — o'sha; bir nechta variant bo'lsa — `undefined` (foydalanuvchi tanlashi kerak).
 */
export function findUnit(units: UnitDef[], unitText: string, variant?: string | null): UnitDef | undefined {
  const name = norm(unitText)
  const sameName = units.filter((u) => norm(u.unit) === name)
  const isPlain = (u: UnitDef): boolean => u.variant === null || u.variant.trim() === ''
  if (variant === null) return sameName.find(isPlain)
  if (variant !== undefined) {
    const v = norm(variant)
    if (v === '') return sameName.find(isPlain)
    return sameName.find((u) => !isPlain(u) && norm(u.variant ?? '') === v)
  }
  const plain = sameName.find(isPlain)
  if (plain) return plain
  return sameName.length === 1 ? sameName[0] : undefined
}

export type FactorError = 'empty' | 'not_number' | 'not_positive' | 'too_precise' | 'too_large'

/** Koeffitsient: numeric(20,10) va `check (factor > 0)`. */
export function validateFactor(input: string): { ok: true; value: Dec } | { ok: false; reason: FactorError } {
  if (input.trim() === '') return { ok: false, reason: 'empty' }
  const value = parseDec(input)
  if (value === null) return { ok: false, reason: 'not_number' }
  if (cmp(value, '0') <= 0) return { ok: false, reason: 'not_positive' }
  if (intDigitsOf(value) > FACTOR_INT_DIGITS) return { ok: false, reason: 'too_large' }
  if (scaleOf(value) > FACTOR_FRAC_DIGITS) return { ok: false, reason: 'too_precise' }
  return { ok: true, value }
}

export type QtyError = 'empty' | 'not_number' | 'zero' | 'negative' | 'too_precise' | 'too_large'

/**
 * Miqdor: numeric(20,6). `allowNegative` — faqat inventory_adjust uchun (ishorali, lekin 0 emas).
 * Eslatma: qty_base ham numeric(20,6) — juda katta koeffitsientda `toBaseQty` natijasi
 * chegaradan chiqishi mumkin; buni baza rad etadi.
 */
export function validateQtyInput(
  input: string,
  opts?: { allowNegative?: boolean },
): { ok: true; value: Dec } | { ok: false; reason: QtyError } {
  if (input.trim() === '') return { ok: false, reason: 'empty' }
  const value = parseDec(input)
  if (value === null) return { ok: false, reason: 'not_number' }
  if (isZero(value)) return { ok: false, reason: 'zero' }
  if (isNegative(value) && !opts?.allowNegative) return { ok: false, reason: 'negative' }
  if (intDigitsOf(value) > QTY_INT_DIGITS) return { ok: false, reason: 'too_large' }
  if (scaleOf(value) > QTY_SCALE) return { ok: false, reason: 'too_precise' }
  return { ok: true, value }
}

/**
 * O'zbekcha raqam formati (ko'rsatish uchun): kasr ajratuvchi — vergul, minglik — tor bo'linmas
 * bo'shliq U+202F, minus — U+2212 ("1 250 000,5", "−3"). `parseDec` U+202F ni qabul qiladi (\s).
 */
export function formatDecUz(value: Dec): string {
  const c = parseDec(value)
  if (c === null) throw new Error(`formatDecUz: noto'g'ri qiymat: ${JSON.stringify(value)}`)
  const neg = c.startsWith('-')
  const [intPart = '0', frac] = (neg ? c.slice(1) : c).split('.')
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F')
  return `${neg ? '\u2212' : ''}${grouped}${frac ? `,${frac}` : ''}`
}

/** "1 qop = 50 kg", "1 m² devor · bir g'isht · 250 mm = 102 dona", "1 tonna = 0,6667 m³" (raqam va birlik orasida U+00A0). */
export function conversionHint(u: UnitDef, baseUnit: string): string {
  return `1\u00A0${unitLabel(u)} = ${formatDecUz(u.factor)}\u00A0${baseUnit.trim()}`
}

/**
 * Qoldiqni foydalanuvchi odatda kiritadigan birlikda ham ko'rsatish ("12 qop (600 kg)").
 * Faqat oxirgi ishlatilgan birlik hali mavjud va koeffitsienti > 1 bo'lsa; aks holda null (asosiy birlik yetarli).
 */
export function inputUnitView(
  qtyBase: Dec,
  units: readonly Pick<UnitDef, 'id' | 'unit' | 'variant' | 'factor'>[],
  lastUnitId: string | null,
  scale = 2,
): { qty: Dec; unit: string } | null {
  if (!lastUnitId) return null
  const u = units.find((x) => x.id === lastUnitId)
  if (!u || cmp(u.factor, '1') <= 0) return null
  return { qty: fromBaseQty(qtyBase, u.factor, scale), unit: unitLabel(u) }
}
