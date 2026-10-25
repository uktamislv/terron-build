// Ustunlarni avtomatik moslash (smeta importi, Batch 7).
import { normalizeAlias } from '../aliases'
import { cellText } from './cells'
import { REQUIRED_FIELDS, type Cell, type ColumnMapping, type EstimateField, type RequiredField } from './types'

/**
 * Kalit so'zlar (o'zbek lotin, rus kirill). Taqqoslashdan oldin ikkala tomon ham
 * `normalizeAlias` dan o'tadi, keyin faqat harf, raqam va "№" qoldiriladi
 * ("Ед. изм." → "едизм", "Кол-во" → "колво", "O'lchov" / "Oʻlchov" → "olchov").
 */
const KEYWORDS: Record<EstimateField, readonly string[]> = {
  name: [
    'наименование',
    'наименование работ и затрат',
    'наименование работ',
    'наименование материалов',
    'материал',
    'материалы',
    'nomi',
    'nomlanishi',
    'ish nomi',
    'material nomi',
  ],
  unit: [
    'ед. изм',
    'ед',
    'единица измерения',
    'единица',
    'единицы',
    "o'lchov birligi",
    "o'lchov",
    "o'lch. bir",
    'birlik',
    'birligi',
  ],
  qty: ['кол-во', 'количество', 'объем', 'miqdori', 'miqdor', 'hajmi', 'hajm', 'soni'],
  price: [
    'цена',
    'цена за ед',
    'цена за единицу',
    'стоимость единицы',
    'стоимость ед',
    'narx',
    'narxi',
    'birlik narxi',
  ],
  sum: ['сумма', 'стоимость', 'общая стоимость', 'всего', 'summa', 'umumiy summa', 'jami', 'jami summa'],
  type: ['тип', 'вид', 'вид работ', 'turi', 'ish turi'],
  code: ['шифр', 'код', 'обоснование', '№', 'shifr', 'kod', 'kodi'],
}

/** O'zbek apostrof variantlari: ʻ ʼ (harf toifasida!), ' ‘ ’ ` ´. */
const APOSTROPHES = /[ʻʼ'‘’`´]/g

/** Taqqoslash uchun ixcham shakl. */
export function compactHeader(s: string): string {
  return normalizeAlias(s).replace(APOSTROPHES, '').replace(/[^\p{L}\p{N}№]/gu, '')
}

/** Shundan qisqa kalit so'zlar faqat to'liq yoki boshidan mos keladi ("вид" — "индивидуальный" ichida emas). */
const SHORT_KEYWORD = 3
/** Faqat to'liq mos keladi ("Ед." — ha, "Единичная расценка" — yo'q). */
const EXACT_ONLY = new Set(['ед'])

const COMPACT_KEYWORDS: [EstimateField, string][] = (Object.keys(KEYWORDS) as EstimateField[]).flatMap((f) =>
  KEYWORDS[f].map((k): [EstimateField, string] => [f, compactHeader(k)]),
)

/**
 * Bitta katak va maydon uchun moslik bahosi (0 — mos emas).
 * Sifat: to'liq teng 3, boshidan 2, ichida 1; bir xil sifatda uzunroq (aniqroq) kalit so'z ustun:
 * baho = sifat × 100 + kalit uzunligi. Masalan "Стоимость единицы": price ("стоимостьед", boshidan, 211)
 * sum ("стоимость", boshidan, 209) dan ustun.
 */
function scoreCell(text: string, field: EstimateField): number {
  if (text === '') return 0
  let best = 0
  for (const [f, k] of COMPACT_KEYWORDS) {
    if (f !== field || k === '') continue
    let q = 0
    if (text === k) q = 3
    else if (EXACT_ONLY.has(k)) q = 0
    else if (text.startsWith(k)) q = 2
    else if (k.length > SHORT_KEYWORD && text.includes(k)) q = 1
    if (q > 0) best = Math.max(best, q * 100 + k.length)
  }
  return best
}

/**
 * Sarlavha qatoridan ustunlarni taklif qiladi. Har ustun faqat bitta maydonga, har maydon
 * bitta ustunga. Ziddiyatda bahosi yuqori juftlik ustun (teng bo'lsa — chaproq ustun,
 * keyin ESTIMATE_FIELDS tartibi). Raqam kataklari e'tiborga olinmaydi.
 * `subHeader` (sarlavhadan keyingi qator) berilsa va unda "ПО ПРОЕКТУ" ustuni bo'lsa —
 * `qty` shu ustunga (resurs smetasi: "НА ЕДИНИЦУ" — norma, "ПО ПРОЕКТУ" — jami miqdor).
 */
export function autoMapColumns(header: Cell[], subHeader?: Cell[]): ColumnMapping {
  const candidates: { col: number; field: EstimateField; score: number; order: number }[] = []
  const fields = Object.keys(KEYWORDS) as EstimateField[]
  header.forEach((cell, col) => {
    if (typeof cell !== 'string') return
    const text = compactHeader(cellText(cell))
    fields.forEach((field, order) => {
      const score = scoreCell(text, field)
      if (score > 0) candidates.push({ col, field, score, order })
    })
  })
  candidates.sort((a, b) => b.score - a.score || a.col - b.col || a.order - b.order)
  const mapping: ColumnMapping = {}
  const usedCols = new Set<number>()
  for (const c of candidates) {
    if (mapping[c.field] !== undefined || usedCols.has(c.col)) continue
    mapping[c.field] = c.col
    usedCols.add(c.col)
  }
  if (subHeader) {
    const { total } = subHeaderColumns(subHeader)
    if (total !== null && (!usedCols.has(total) || mapping.qty === total)) mapping.qty = total
  }
  return mapping
}

const SUB_PER_UNIT = ['наединицу', 'наед', 'birlikka', 'birligiga']
const SUB_TOTAL = ['попроекту', 'loyihaboyicha', 'loyihabuyicha']

/**
 * "КОЛ-ВО" ostidagi ost-sarlavha (resurs smetasi, LRV): "НА ЕДИНИЦУ" (birlikka norma) va
 * "ПО ПРОЕКТУ" (loyiha bo'yicha jami miqdor) ustunlari. Topilmasa — null.
 */
export function subHeaderColumns(row: Cell[]): { perUnit: number | null; total: number | null } {
  let perUnit: number | null = null
  let total: number | null = null
  Array.from(row).forEach((cell, col) => {
    if (typeof cell !== 'string') return
    const t = compactHeader(cell)
    if (perUnit === null && SUB_PER_UNIT.some((k) => t === k || t.startsWith(k))) perUnit = col
    else if (total === null && SUB_TOTAL.some((k) => t === k || t.startsWith(k))) total = col
  })
  return { perUnit, total }
}

/** Yetishmayotgan majburiy maydonlar (`name`, `unit`, `qty` tartibida). */
export function validateMapping(m: ColumnMapping): RequiredField[] {
  return REQUIRED_FIELDS.filter((f) => {
    const v = m[f]
    return v === undefined || !Number.isInteger(v) || v < 0
  })
}
