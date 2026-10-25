// Smeta qatorlarini ajratish (Batch 7). Sof funksiya, float yo'q.
import { normalizeAlias } from '../aliases'
import { abs, cmp, isNegative, isZero, mul, sub, type Dec } from '../decimal'
import { cellText, cellToDec, numberToDec, type DecCell } from './cells'
import { compactHeader } from './mapping'
import type { Cell, ColumnMapping, EstimateField } from './types'

export { numberToDec }

export type ParsedRowError =
  | 'qty_missing'
  | 'qty_invalid'
  | 'qty_not_positive'
  | 'price_invalid'
  | 'sum_invalid'
  | 'unit_missing'
  | 'sum_mismatch'

export interface ParsedRow {
  /** Excel'dagi qator raqami (1 dan). */
  rowNumber: number
  kind: 'item' | 'section' | 'total' | 'empty' | 'invalid'
  name: string
  unit: string
  qty: Dec | null
  price: Dec | null
  sum: Dec | null
  type: 'ish' | 'material' | null
  code: string
  errors: ParsedRowError[]
}

/** Jami qatorlari — nom (normalizeAlias) shu so'zlar bilan boshlanadi. */
const TOTAL_PREFIXES = ['итого', 'всего по', 'всего', 'jami']

/** `sum` va `qty × price` farqi shundan ko'p bo'lsa — `sum_mismatch` (so'm). */
const SUM_TOLERANCE: Dec = '1'

const TYPE_WORDS: Record<string, 'ish' | 'material'> = {
  ish: 'ish',
  ishlar: 'ish',
  работа: 'ish',
  работы: 'ish',
  material: 'material',
  materiallar: 'material',
  материал: 'material',
  материалы: 'material',
}

function parseType(c: Cell | undefined): 'ish' | 'material' | null {
  return TYPE_WORDS[compactHeader(cellText(c))] ?? null
}

function isTotalLabel(s: string): boolean {
  const n = normalizeAlias(s)
  return n !== '' && TOTAL_PREFIXES.some((p) => n.startsWith(p))
}

/**
 * Ustunlar raqamlari qatori (grand-smeta sarlavhasi ostidagi "1 | 2 | 3 | ... "):
 * kamida 3 ta bo'sh bo'lmagan katak, hammasi ketma-ket o'suvchi butun sonlar (+1 qadam).
 */
function isColumnNumberingRow(row: Cell[]): boolean {
  const values: number[] = []
  for (const c of Array.from(row)) {
    const t = cellText(c)
    if (t === '') continue
    if (!/^\d+$/.test(t)) return false
    values.push(Number(t))
  }
  if (values.length < 3) return false
  return values.every((v, i) => i === 0 || v === (values[i - 1] ?? NaN) + 1)
}

function decValue(d: DecCell): Dec | null {
  return d.state === 'ok' ? d.value : null
}

/**
 * Sarlavhadan keyingi qatorlarni ajratadi. Qoidalar (tartib bilan):
 * 1. `empty` — ustun raqamlari qatori ("1 | 2 | 3 ...") yoki butun qator bo'sh.
 * 2. `total` — nom (nom bo'sh bo'lsa — qatordagi birinchi raqam bo'lmagan matn, u `name` ga yoziladi)
 *    "итого", "всего по", "всего", "jami" bilan boshlanadi.
 * 3. `section` — nom bor, `qty`, `unit`, `price` bo'sh ("Раздел 1. ..."); moslangan ustunlar bo'sh,
 *    lekin boshqa ustunda matn bo'lsa ham bo'lim (o'sha matn `name` ga).
 * 4. Aks holda — qator. Xatolar: qty bo'sh/noto'g'ri/≤ 0, birlik bo'sh, narx noto'g'ri yoki manfiy,
 *    summa noto'g'ri → `invalid`. Nom bo'sh, lekin raqamlar bor → ham `invalid`.
 *    `sum_mismatch` (|sum − qty × price| > 1 so'm) — faqat ogohlantirish, `kind` `item` qoladi.
 */
export function parseRows(rows: Cell[][], headerRow: number, mapping: ColumnMapping): ParsedRow[] {
  const result: ParsedRow[] = []
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i] ?? []
    const get = (f: EstimateField): Cell | undefined => {
      const col = mapping[f]
      return col === undefined ? undefined : row[col]
    }
    const name = cellText(get('name'))
    const unit = cellText(get('unit'))
    const code = cellText(get('code'))
    const type = parseType(get('type'))
    const qtyCell = cellToDec(get('qty'))
    const priceCell = cellToDec(get('price'))
    const sumCell = cellToDec(get('sum'))
    const base: ParsedRow = {
      rowNumber: i + 1,
      kind: 'item',
      name,
      unit,
      qty: decValue(qtyCell),
      price: decValue(priceCell),
      sum: decValue(sumCell),
      type,
      code,
      errors: [],
    }

    const allEmpty =
      name === '' &&
      unit === '' &&
      code === '' &&
      cellText(get('type')) === '' &&
      qtyCell.state === 'empty' &&
      priceCell.state === 'empty' &&
      sumCell.state === 'empty'
    if (isColumnNumberingRow(row)) {
      result.push({ ...base, kind: 'empty' })
      continue
    }
    // Nom ustuni bo'sh bo'lsa — qatordagi birinchi raqam bo'lmagan matn (birlashtirilgan kataklar:
    // "Раздел 1. ..." yoki "Всего по смете" ko'pincha A ustunida turadi).
    const label =
      name !== '' ? name : (Array.from(row).map(cellText).find((t) => t !== '' && !/^[\d\s.,-]+$/.test(t)) ?? '')
    if (isTotalLabel(label)) {
      result.push({ ...base, kind: 'total', name: label })
      continue
    }
    if (allEmpty) {
      result.push(label === '' ? { ...base, kind: 'empty' } : { ...base, kind: 'section', name: label })
      continue
    }

    if (name !== '' && unit === '' && qtyCell.state === 'empty' && priceCell.state === 'empty') {
      result.push({ ...base, kind: 'section' })
      continue
    }

    const errors: ParsedRowError[] = []
    if (qtyCell.state === 'empty') errors.push('qty_missing')
    else if (qtyCell.state === 'invalid') errors.push('qty_invalid')
    else if (isNegative(qtyCell.value) || isZero(qtyCell.value)) errors.push('qty_not_positive')
    if (unit === '') errors.push('unit_missing')
    if (priceCell.state === 'invalid' || (priceCell.state === 'ok' && isNegative(priceCell.value))) {
      errors.push('price_invalid')
    }
    if (sumCell.state === 'invalid') errors.push('sum_invalid')

    const blocking = errors.length > 0 || name === ''
    if (qtyCell.state === 'ok' && priceCell.state === 'ok' && sumCell.state === 'ok') {
      const diff = abs(sub(sumCell.value, mul(qtyCell.value, priceCell.value)))
      if (cmp(diff, SUM_TOLERANCE) > 0) errors.push('sum_mismatch')
    }
    result.push({ ...base, kind: blocking ? 'invalid' : 'item', errors })
  }
  return result
}
