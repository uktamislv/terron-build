// Resurs smetasi (LRV — локальная ресурсная ведомость) importi. Sof funksiyalar, float yo'q.
//
// Tuzilish: sarlavha "№№ | ОБОСНОВАНИЕ | НАИМЕНОВАНИЕ РАБОТ И РЕСУРСОВ | ЕД.ИЗМ | КОЛ-ВО | | ЦЕНА | СУММА",
// ost-sarlavha "НА ЕДИНИЦУ | ПО ПРОЕКТУ", keyin ustun raqamlari qatori. Ish qatori — A="12",
// resurs qatori — A="12.3"; resurs turi summa qaysi ustunda turganidan (mehnat, texnika,
// materiallar, kabel, uskuna). Oxirida jami qatorlari ("Зарплата", "Строительные материалы", …).
import { normalizeAlias } from '../aliases'
import { abs, add, cmp, div, isNegative, isZero, mul, round, sub, type Dec } from '../decimal'
import { cellText, cellToDec, type DecCell } from './cells'
import { detectHeaderRow, isColumnNumberingRow } from './header'
import { autoMapColumns, compactHeader, subHeaderColumns } from './mapping'
import type { Cell } from './types'

export interface ResourceLayout {
  /** Sarlavha qatori (0 dan indeks). */
  headerRow: number
  /** Birinchi ma'lumot qatori (0 dan; ost-sarlavha va ustun raqamlaridan keyin). */
  dataStartRow: number
  col: {
    no: number
    code: number
    name: number
    unit: number
    /** "НА ЕДИНИЦУ" — birlikka norma (ost-sarlavha bo'lmasa null). */
    perUnit: number | null
    /** "ПО ПРОЕКТУ" (ost-sarlavha bo'lsa), aks holda "КОЛ-ВО". */
    qty: number
    price: number | null
    sum: number | null
    labor: number | null
    machine: number | null
    material: number | null
    equipment: number | null
    /** Kabel-o'tkazgich mahsulotlari ("Кабел" jami). Qatorlari `kind: 'equipment'`. */
    cable: number | null
  }
}

export type ResourceKind = 'labor' | 'machine' | 'material' | 'equipment' | 'unknown'

export interface ResourceRow {
  /** Excel qator raqami (1 dan). */
  rowNumber: number
  /** Tegishli ish raqami ("12.3" → "12"; ish qatorining o'zi resurs bo'lsa — o'z raqami). */
  workNo: string
  code: string
  name: string
  unit: string
  perUnit: Dec | null
  qty: Dec
  price: Dec | null
  sum: Dec | null
  kind: ResourceKind
}

export interface WorkRow {
  rowNumber: number
  no: string
  code: string
  name: string
  unit: string
  qty: Dec | null
  /** Oxirgi bo'lim qatori matni ("РАЗДЕЛ: ЗЕМЛЯНЫЕ РАБОТЫ"). */
  section: string | null
}

export type ResourceSkipReason = 'section' | 'total' | 'empty' | 'header' | 'invalid'

export interface ResourceTotals {
  labor: Dec | null
  machine: Dec | null
  material: Dec | null
  equipment: Dec | null
  cable: Dec | null
  /** "ВСЕГО С НДС" (oxirgi "Всего…"), bo'lmasa oxirgi "Итого". */
  grand: Dec | null
}

export interface ResourceParseResult {
  works: WorkRow[]
  resources: ResourceRow[]
  skipped: { rowNumber: number; reason: ResourceSkipReason }[]
  totals: ResourceTotals
}

type KindCol = 'labor' | 'machine' | 'material' | 'equipment' | 'cable'
const KIND_COLS: readonly KindCol[] = ['labor', 'machine', 'material', 'equipment', 'cable']

const WORK_NO = /^\d+$/
const RESOURCE_NO = /^(\d+)\.\d+$/
const LABOR_CODE = '000001'
const SCAN_ROWS = 30
/** Jami qatori summasi va ustun yig'indisi orasidagi ruxsat etilgan farq (so'm). */
const TOTAL_TOLERANCE: Dec = '1'
const QTY_SCALE = 6
const MONEY_SCALE = 2

/** Birlik taqqoslash shakli: kichik harf, bo'sh joy va nuqtasiz ("10 ШТ." → "10шт"). */
function unitKey(u: string): string {
  // Raqamlar orasidagi nuqta saqlanadi ("0.5т" ≠ "5т"); qisqartma nuqtalari ("т.", "маш.-ч") olib tashlanadi
  return normalizeAlias(u)
    .replace(/\s/g, '')
    .replace(/(?<!\d)\.|\.(?!\d)/g, '')
}

const LABOR_UNITS = new Set(['чел-ч', 'челч', 'чел-час', 'чел.-ч', 'чел/ч', 'чел/час', 'чел.час', 'чел-час.'].map(unitKey))
const MACHINE_UNITS = new Set(['маш-ч', 'машч', 'маш-час', 'маш.-ч', 'маш/ч', 'маш/час', 'маш.час'].map(unitKey))
const MONEY_UNITS = new Set(['сум', 'сўм', "so'm", 'som', 'руб', 'руб.'].map(unitKey))

/** Jami qatorlari yorlig'i → tur. `normalizeAlias` dan keyin boshidan solishtiriladi. */
const TOTAL_LABELS: [KindCol, string[]][] = [
  ['labor', ['зарплата', 'заработная плата', 'оплата труда', 'затраты труда']],
  ['machine', ['эксплуатация машин', 'машины и механизмы']],
  ['material', ['строительные материалы', 'материалы']],
  ['equipment', ['оборудование']],
  ['cable', ['кабел']],
]
const TOTAL_PREFIXES = ['итого', 'всего', 'jami', 'ндс', 'qqs', 'транспортные', 'заготовительно', 'прочие', 'страхование', 'накладные', 'сметная прибыль']

function labelKind(label: string): KindCol | null {
  const n = normalizeAlias(label)
  for (const [k, prefixes] of TOTAL_LABELS) if (prefixes.some((p) => n.startsWith(p))) return k
  return null
}

function isTotalLabel(label: string): boolean {
  const n = normalizeAlias(label)
  return n !== '' && (labelKind(label) !== null || TOTAL_PREFIXES.some((p) => n.startsWith(p)))
}

/** Eksponentali matn ("4E-005", "1,5e3") — Excel eksportidagi kichik sonlar. */
const SCI = /^([+-]?)(\d+)(?:[.,](\d+))?[eE]([+-]?\d{1,3})$/
const MAX_SCI_EXP = 30

/**
 * Exponentali satrni aniq o'nlikka (float yo'q, raqamlar siljitiladi). |daraja| > 30 → null.
 */
export function sciToDec(s: string): Dec | null {
  const m = SCI.exec(s.trim())
  if (!m) return null
  const exp = Number(m[4])
  if (Math.abs(exp) > MAX_SCI_EXP) return null
  const intPart = m[2] ?? ''
  const digits = intPart + (m[3] ?? '')
  const point = intPart.length + exp
  let out: string
  if (point <= 0) out = `0.${'0'.repeat(-point)}${digits}`
  else if (point >= digits.length) out = digits + '0'.repeat(point - digits.length)
  else out = `${digits.slice(0, point)}.${digits.slice(point)}`
  return add((m[1] === '-' ? '-' : '') + out, '0')
}

/** `cellToDec` + eksponentali satrlar (faqat resurs smetasi uchun). */
function resDec(c: Cell | undefined): DecCell {
  const d = cellToDec(c)
  if (d.state !== 'invalid' || typeof c !== 'string') return d
  const v = sciToDec(c)
  return v === null ? d : { state: 'ok', value: v }
}

function decOf(d: DecCell): Dec | null {
  return d.state === 'ok' ? d.value : null
}

/** Nol bo'lmagan son. */
function nonZero(c: Cell | undefined): Dec | null {
  const d = decOf(resDec(c))
  return d !== null && !isZero(d) ? d : null
}

function at(row: Cell[] | undefined, col: number | null): Cell | undefined {
  return col === null || row === undefined ? undefined : row[col]
}

type RowNo = { type: 'work'; no: string } | { type: 'resource'; no: string; workNo: string } | null

function rowNo(c: Cell | undefined): RowNo {
  const t = cellText(c)
  if (WORK_NO.test(t)) return { type: 'work', no: t }
  const m = RESOURCE_NO.exec(t)
  if (m) return { type: 'resource', no: t, workNo: m[1] ?? '' }
  return null
}

/** "№№", "№", "№ п/п", "N" — tartib raqami ustuni. */
function isNoHeader(c: Cell | undefined): boolean {
  if (typeof c !== 'string') return false
  const t = compactHeader(c)
  return /^№+(пп)?$/.test(t) || t === 'nn' || t === 'пп' || t === 'n'
}

/**
 * Resurs smetasi tuzilishini aniqlaydi. Sarlavha — `detectHeaderRow` (ustun raqamlari qatori
 * sarlavha emas); `code`, `name`, `unit`, `qty` majburiy, `№` ustuni (bo'lmasa `code` dan chapdagi
 * birinchi ustun). Keyingi qatorda "НА ЕДИНИЦУ / ПО ПРОЕКТУ" bo'lsa — `perUnit` va `qty` shu ustunlar.
 * Tur ustunlari (sarlavhadagi ustunlardan o'ngda) MA'LUMOTDAN topiladi:
 * 1. Jami qatorlari ("Зарплата", "Эксплуатация машин", "Строительные материалы", "ОБОРУДОВАНИЕ",
 *    "Кабел") summasi qaysi ustundagi qator qiymatlari yig'indisiga teng (±1 so'm) — o'sha.
 * 2. Qolganlari: mehnat — ЧЕЛ-Ч / 000001 qatorlari to'ldiradigan ustun, texnika — МАШ-Ч,
 *    material — qolganlardan eng ko'p to'ldirilgani, keyin uskuna, keyin kabel.
 * Kamida mehnat, texnika yoki material ustunlaridan biri topilmasa — null (oddiy smeta).
 */
export function detectResourceLayout(rows: Cell[][]): ResourceLayout | null {
  const headerRow = detectHeaderRow(rows, SCAN_ROWS)
  if (headerRow === null) return null
  const header = rows[headerRow] ?? []
  const m = autoMapColumns(header)
  if (m.name === undefined || m.unit === undefined || m.qty === undefined || m.code === undefined) return null

  const code = m.code
  // "№" `code` ga tushgan bo'lsa — haqiqiy kod ("ОБОСНОВАНИЕ") ustuni yo'q
  if (isNoHeader(header[code])) return null
  let no: number | null = null
  for (let i = 0; i < header.length; i++) {
    if (i !== m.name && i !== m.unit && i !== m.qty && i !== code && isNoHeader(header[i])) {
      no = i
      break
    }
  }
  if (no === null) {
    const used = new Set(Object.values(m))
    for (let i = 0; i < code; i++) {
      if (!used.has(i)) {
        no = i
        break
      }
    }
  }
  if (no === null) return null

  let dataStartRow = headerRow + 1
  let perUnit: number | null = null
  let qty = m.qty
  const sub = subHeaderColumns(rows[headerRow + 1] ?? [])
  if (sub.total !== null || sub.perUnit !== null) {
    dataStartRow = headerRow + 2
    if (sub.total !== null) {
      qty = sub.total
      perUnit = sub.perUnit ?? (m.qty !== sub.total ? m.qty : null)
    } else perUnit = sub.perUnit
  }
  while (dataStartRow < rows.length && isColumnNumberingRow(rows[dataStartRow] ?? [])) dataStartRow++

  const base = { no, code, name: m.name, unit: m.unit, perUnit, qty, price: m.price ?? null, sum: m.sum ?? null }
  const kinds = detectKindColumns(rows, dataStartRow, base)
  // Tur ustunlari yo'q LRV (faqat 8 ustun): "ПО ПРОЕКТУ" ost-sarlavhasi va "N.M" resurs qatorlari bo'lsa — qabul
  const noKinds = kinds.labor === null && kinds.machine === null && kinds.material === null
  if (noKinds && (sub.total === null || !hasResourceRows(rows, dataStartRow, no))) return null
  return { headerRow, dataStartRow, col: { ...base, ...kinds } }
}

/** Ish qatoridan keyingi birinchi raqamli qator shu ishning resursi ("N.M") bo'lsa — true. */
function hasChildRows(rows: Cell[][], workIndex: number, noCol: number, workNo: string): boolean {
  for (let i = workIndex + 1; i < rows.length; i++) {
    const n = rowNo(rows[i]?.[noCol])
    if (n !== null) return n.type === 'resource' && n.workNo === workNo
  }
  return false
}

function hasResourceRows(rows: Cell[][], start: number, noCol: number): boolean {
  for (let i = start; i < rows.length; i++) if (rowNo(rows[i]?.[noCol])?.type === 'resource') return true
  return false
}

function detectKindColumns(
  rows: Cell[][],
  start: number,
  base: { no: number; code: number; name: number; unit: number; perUnit: number | null; qty: number; price: number | null; sum: number | null },
): Record<KindCol, number | null> {
  const used = Object.values(base).filter((v): v is number => v !== null)
  const firstCandidate = Math.max(...used) + 1
  let width = 0
  for (let i = start; i < rows.length; i++) width = Math.max(width, (rows[i] ?? []).length)

  const stats = new Map<number, { filled: number; labor: number; machine: number; sum: Dec }>()
  for (let c = firstCandidate; c < width; c++) stats.set(c, { filled: 0, labor: 0, machine: 0, sum: '0' })
  const totals: Partial<Record<KindCol, Dec>> = {}

  for (let i = start; i < rows.length; i++) {
    const row = rows[i] ?? []
    const no = rowNo(at(row, base.no))
    if (no === null) {
      const label = cellText(at(row, base.name))
      const k = label === '' ? null : labelKind(label)
      const v = base.sum === null ? null : decOf(resDec(at(row, base.sum)))
      if (k !== null && v !== null && totals[k] === undefined) totals[k] = v
      continue
    }
    const unit = unitKey(cellText(at(row, base.unit)))
    const isLabor = LABOR_UNITS.has(unit) || cellText(at(row, base.code)) === LABOR_CODE
    const isMachine = MACHINE_UNITS.has(unit)
    for (const [c, s] of stats) {
      const v = nonZero(row[c])
      if (v === null) continue
      s.filled++
      s.sum = add(s.sum, v)
      if (isLabor) s.labor++
      if (isMachine) s.machine++
    }
  }

  const result: Record<KindCol, number | null> = { labor: null, machine: null, material: null, equipment: null, cable: null }
  const taken = new Set<number>()
  // 1. Jami qatorlari bo'yicha
  for (const k of KIND_COLS) {
    const t = totals[k]
    if (t === undefined) continue
    for (const [c, s] of stats) {
      if (taken.has(c) || s.filled === 0) continue
      if (cmp(abs(sub(s.sum, t)), TOTAL_TOLERANCE) <= 0) {
        result[k] = c
        taken.add(c)
        break
      }
    }
  }
  // 2. Birlik ovozlari bo'yicha
  const byVotes = (key: 'labor' | 'machine'): number | null => {
    let best: number | null = null
    let bestVotes = 0
    for (const [c, s] of stats) {
      if (!taken.has(c) && s[key] > bestVotes) {
        best = c
        bestVotes = s[key]
      }
    }
    return best
  }
  if (result.labor === null) {
    result.labor = byVotes('labor')
    if (result.labor !== null) taken.add(result.labor)
  }
  if (result.machine === null) {
    result.machine = byVotes('machine')
    if (result.machine !== null) taken.add(result.machine)
  }
  // 3. Qolganlari — to'ldirilganlik bo'yicha (birlik ovozi bo'lmagan ustunlar). Jami yorliqlari bor
  // smetada bu qadam yo'q: yorlig'i yo'q tur (masalan "Кабел") — ustuni ham yo'q (izoh ustunlari olinmaydi).
  if (Object.keys(totals).length > 0) return result
  const rest = [...stats.entries()]
    .filter(([c, s]) => !taken.has(c) && s.filled > 0 && s.labor === 0 && s.machine === 0)
    .sort((a, b) => b[1].filled - a[1].filled || a[0] - b[0])
    .map(([c]) => c)
  for (const k of ['material', 'equipment', 'cable'] as const) {
    if (result[k] === null) result[k] = rest.shift() ?? null
  }
  return result
}

/** Qator turi: summa qaysi tur ustunida; bo'lmasa birlik (ЧЕЛ-Ч, МАШ-Ч) va kod 000001. */
function detectKind(row: Cell[], layout: ResourceLayout, unit: string, code: string, sum: Dec | null): ResourceKind {
  // Birlik ustun: ЧЕЛ-Ч / МАШ-Ч (МАШ/ЧАС, МАШ.ЧАС) qatori qaysi ustunda bo'lmasin mehnat / texnika
  // (ba'zi smetalarda texnika qatori xato bilan "materiallar" ustuniga yozilgan).
  const u = unitKey(unit)
  if (LABOR_UNITS.has(u)) return 'labor'
  if (MACHINE_UNITS.has(u)) return 'machine'
  const filled: KindCol[] = []
  let equal: KindCol | null = null
  for (const k of KIND_COLS) {
    const v = nonZero(at(row, layout.col[k]))
    if (v === null) continue
    filled.push(k)
    if (equal === null && sum !== null && cmp(v, sum) === 0) equal = k
  }
  const k = equal ?? filled[0] ?? null
  if (k !== null) return k === 'cable' ? 'equipment' : k
  if (code === LABOR_CODE) return 'labor'
  // Tur ustunlari umuman yo'q smeta — qolganlari material (uskunani ajratib bo'lmaydi)
  if (KIND_COLS.every((kc) => layout.col[kc] === null)) return 'material'
  return 'unknown'
}

/** Qatordagi birinchi raqam bo'lmagan matn (birlashtirilgan kataklar uchun). */
function rowLabel(row: Cell[], nameCol: number): string {
  const name = cellText(row[nameCol])
  if (name !== '') return name
  return Array.from(row).map(cellText).find((t) => t !== '' && !/^[\d\s.,-]+$/.test(t)) ?? ''
}

function hasNumber(row: Cell[]): boolean {
  return Array.from(row).some((c) => {
    const d = resDec(c)
    return d.state === 'ok'
  })
}

/**
 * Resurs smetasini ajratadi (`layout.dataStartRow` dan). Qoidalar:
 * - ustun raqamlari qatori → `header`; butunlay bo'sh → `empty`;
 * - A = "N" — ish (`WorkRow`, miqdor: `qty` ustuni, bo'sh bo'lsa `perUnit` ustuni). Ish qatorida
 *   narx yoki summa bo'lsa (uskuna, kabel, smetaga to'g'ridan-to'g'ri kiritilgan material) — u
 *   `ResourceRow` ham (`workNo` = o'z raqami, `perUnit` null);
 * - A = "N.M" — resurs: miqdor "ПО ПРОЕКТУ" (bo'sh bo'lsa `perUnit × ish hajmi`, 6 xona);
 *   nom, birlik yoki miqdor yo'q / noto'g'ri, narx yoki summa noto'g'ri → `invalid`. Manfiy miqdor
 *   ruxsat ("…ИСКЛЮЧАЕТСЯ" — chegirma ishlari), agregatsiyada ayiriladi;
 * - raqamsiz qator: jami yorlig'i ("Итого", "Зарплата", "НДС 12%", …), birligi "СУМ" yoki matnsiz
 *   faqat sonlar → `total`; faqat matn → `section` (keyingi ishlarning `section`i).
 * `totals`: jami qatorlari yorliqlaridan (summa ustuni); yorliq bo'lmasa — matnsiz "ustunlar
 * yig'indisi" qatoridagi tur ustunlari qiymatlari.
 */
export function parseResourceEstimate(rows: Cell[][], layout: ResourceLayout): ResourceParseResult {
  const { col } = layout
  const works: WorkRow[] = []
  const resources: ResourceRow[] = []
  const skipped: ResourceParseResult['skipped'] = []
  const totals: ResourceTotals = { labor: null, machine: null, material: null, equipment: null, cable: null, grand: null }
  const columnTotals: Partial<Record<KindCol, Dec>> = {}
  let section: string | null = null
  let lastWork: { no: string; qty: Dec | null } | null = null
  const noKindCols = KIND_COLS.every((k) => col[k] === null)
  let grandAll: Dec | null = null
  let grandItogo: Dec | null = null

  for (let i = layout.dataStartRow; i < rows.length; i++) {
    const row = rows[i] ?? []
    const rowNumber = i + 1
    const skip = (reason: ResourceSkipReason): void => {
      skipped.push({ rowNumber, reason })
    }
    if (Array.from(row).every((c) => cellText(c) === '')) {
      skip('empty')
      continue
    }
    if (isColumnNumberingRow(row)) {
      skip('header')
      continue
    }
    const no = rowNo(at(row, col.no))
    const code = cellText(at(row, col.code))
    const name = cellText(at(row, col.name))
    const unit = cellText(at(row, col.unit))

    if (no === null) {
      const label = rowLabel(row, col.name)
      const numeric = hasNumber(row)
      if (isTotalLabel(label) || MONEY_UNITS.has(unitKey(unit)) || (label === '' && numeric)) {
        const value = (col.sum === null ? null : decOf(resDec(row[col.sum]))) ?? lastNumber(row)
        const k = labelKind(label)
        if (k !== null && value !== null && totals[k] === null) totals[k] = value
        const n = normalizeAlias(label)
        if (value !== null && n.startsWith('всего')) grandAll = value
        if (value !== null && n.startsWith('итого')) grandItogo = value
        if (label === '') {
          for (const kc of KIND_COLS) {
            const v = decOf(resDec(at(row, col[kc])))
            if (v !== null && columnTotals[kc] === undefined) columnTotals[kc] = v
          }
        }
        skip('total')
        continue
      }
      if (!numeric && label !== '') {
        section = label
        skip('section')
        continue
      }
      skip('invalid')
      continue
    }

    const price = resDec(at(row, col.price))
    const sum = resDec(at(row, col.sum))

    if (no.type === 'work') {
      const q1 = resDec(row[col.qty])
      const qCell = q1.state === 'empty' && col.perUnit !== null ? resDec(row[col.perUnit]) : q1
      const qty = decOf(qCell)
      if (name === '') {
        skip('invalid')
        continue
      }
      works.push({ rowNumber, no: no.no, code, name, unit, qty, section })
      lastWork = { no: no.no, qty }
      if (price.state === 'empty' && sum.state === 'empty') continue
      // Tur ustunlarisiz smetada resurslari bor ishning narx/summasi — resurslar yig'indisi, resurs emas.
      // Tur ustunlari bo'lsa ish qatoridagi summa alohida resurs (masalan, prokat konstruksiya + montaj).
      if (noKindCols && hasChildRows(rows, i, col.no, no.no)) continue
      if (price.state === 'invalid' || sum.state === 'invalid' || qty === null || unit === '') {
        skip('invalid')
        continue
      }
      const s = decOf(sum)
      resources.push({
        rowNumber,
        workNo: no.no,
        code,
        name,
        unit,
        perUnit: null,
        qty,
        price: decOf(price),
        sum: s,
        kind: detectKind(row, layout, unit, code, s),
      })
      continue
    }

    // resurs qatori
    const perUnit = col.perUnit === null ? null : decOf(resDec(row[col.perUnit]))
    const qCell = resDec(row[col.qty])
    let qty: Dec | null = decOf(qCell)
    if (qCell.state === 'empty' && perUnit !== null && lastWork !== null && lastWork.no === no.workNo && lastWork.qty !== null) {
      qty = round(mul(perUnit, lastWork.qty), QTY_SCALE)
    }
    if (
      name === '' ||
      unit === '' ||
      qty === null ||
      price.state === 'invalid' ||
      sum.state === 'invalid'
    ) {
      skip('invalid')
      continue
    }
    const s = decOf(sum)
    resources.push({
      rowNumber,
      workNo: no.workNo,
      code,
      name,
      unit,
      perUnit,
      qty,
      price: decOf(price),
      sum: s,
      kind: detectKind(row, layout, unit, code, s),
    })
  }

  for (const k of KIND_COLS) if (totals[k] === null) totals[k] = columnTotals[k] ?? null
  totals.grand = grandAll ?? grandItogo
  return { works, resources, skipped, totals }
}

function lastNumber(row: Cell[]): Dec | null {
  let v: Dec | null = null
  for (const c of Array.from(row)) {
    const d = resDec(c)
    if (d.state === 'ok') v = d.value
  }
  return v
}

// ---------------------------------------------------------------------------
// Agregatsiya

export interface AggregatedMaterial {
  /**
   * Kod identifikator (`isIdentifierCode`) va shu faylda bu kod ostida bitta nom bo'lsa — `code`
   * (bir kod turli birlikda kelsa — `code|birlik`); aks holda `normalizeAlias(nom)|birlik`.
   */
  key: string
  /**
   * Faqat identifikator va shu faylda bitta (normallashtirilgan) nomga mos kod, aks holda ''.
   * Bo'sh bo'lmasa — material identifikatori sifatida eslab qolish xavfsiz.
   */
  code: string
  /** Birinchi uchragan nom va birlik (asl matn). */
  name: string
  unit: string
  qty: Dec
  /** `round(sum / qty, 2)`; qty = 0 → null. */
  avgPrice: Dec | null
  sum: Dec
  occurrences: number
  rowNumbers: number[]
  /** Qatorlar turi; aralash bo'lsa: material > equipment > unknown. */
  kind: 'material' | 'equipment' | 'unknown'
}

/** Kod o'rniga yoziladigan umumiy so'zlar (prays, hisob, kalkulyatsiya, …). */
const PLACEHOLDER_WORDS = new Set(['тц', 'кп', 'сч', 'бн', 'нет', 'цена', 'цены', 'счет'])
const PLACEHOLDER_PREFIXES = ['прайс', 'прейскур', 'калькул', 'договор', 'коммерч', 'счет', 'расчет', 'цен', 'поставщ']

/**
 * Kod materialni aniqlaydimi: kamida 4 ta bo'sh joy bo'lmagan belgi, raqam bor va umumiy so'z
 * yo'q ("ПРАЙС-1", "счёт №15", "ТЦ 2023", "Калькуляция 3" — yo'q; "045050", "С124-9221", "ОВК8" — ha).
 * Registr va ё farq qilmaydi.
 */
export function isIdentifierCode(code: string): boolean {
  const n = normalizeAlias(code)
  if (n.replace(/\s/g, '').length < 4 || !/\p{N}/u.test(n)) return false
  const words = n.match(/\p{L}+/gu) ?? []
  return !words.some((w) => PLACEHOLDER_WORDS.has(w) || PLACEHOLDER_PREFIXES.some((p) => w.startsWith(p)))
}

const KIND_RANK: Record<AggregatedMaterial['kind'], number> = { material: 3, equipment: 2, unknown: 1 }

function aggKind(k: ResourceKind): AggregatedMaterial['kind'] {
  return k === 'material' || k === 'equipment' ? k : 'unknown'
}

/**
 * Bir xil resurslarni birlashtiradi: `qty = Σ qty`, `sum = Σ sum` (qatorda summa bo'lmasa —
 * `round(qty × price, 2)`, narx ham bo'lmasa 0). Natija summa bo'yicha kamayish tartibida
 * (teng bo'lsa — birinchi uchrash tartibida).
 */
export function aggregateMaterials(
  resources: ResourceRow[],
  kinds: ResourceKind[] = ['material', 'equipment'],
): AggregatedMaterial[] {
  const wanted = new Set(kinds)
  const list = resources.filter((r) => wanted.has(r.kind))
  // Identifikator kodlar bo'yicha: qaysi nomlar va birliklar uchraydi
  const unitsByCode = new Map<string, Set<string>>()
  const namesByCode = new Map<string, Set<string>>()
  for (const r of list) {
    if (!isIdentifierCode(r.code)) continue
    const units = unitsByCode.get(r.code) ?? new Set<string>()
    units.add(unitKey(r.unit))
    unitsByCode.set(r.code, units)
    const names = namesByCode.get(r.code) ?? new Set<string>()
    names.add(normalizeAlias(r.name))
    namesByCode.set(r.code, names)
  }
  const map = new Map<string, AggregatedMaterial>()
  for (const r of list) {
    const u = unitKey(r.unit)
    const byCode = namesByCode.get(r.code)?.size === 1
    const key = !byCode
      ? `${normalizeAlias(r.name)}|${u}`
      : (unitsByCode.get(r.code)?.size ?? 0) > 1
        ? `${r.code}|${u}`
        : r.code
    const rowSum = r.sum ?? (r.price !== null ? round(mul(r.qty, r.price), MONEY_SCALE) : '0')
    const cur = map.get(key)
    if (cur) {
      cur.qty = add(cur.qty, r.qty)
      cur.sum = add(cur.sum, rowSum)
      cur.occurrences++
      cur.rowNumbers.push(r.rowNumber)
      const k = aggKind(r.kind)
      if (KIND_RANK[k] > KIND_RANK[cur.kind]) cur.kind = k
    } else {
      map.set(key, {
        key,
        code: byCode ? r.code : '',
        name: r.name,
        unit: r.unit,
        qty: r.qty,
        avgPrice: null,
        sum: rowSum,
        occurrences: 1,
        rowNumbers: [r.rowNumber],
        kind: aggKind(r.kind),
      })
    }
  }
  const items = [...map.values()]
  for (const it of items) it.avgPrice = isZero(it.qty) ? null : div(it.sum, it.qty, MONEY_SCALE)
  return items
    .map((it, order) => ({ it, order }))
    .sort((a, b) => cmp(b.it.sum, a.it.sum) || a.order - b.order)
    .map(({ it }) => it)
}

/**
 * Summa ulushi bo'yicha asosiy materiallar: summasi kamayish tartibida kumulyativ ulush
 * `sharePct` % ga yetguncha (shu chegarani kesib o'tgan material ham kiradi), kamida 1 ta
 * (ro'yxat bo'sh bo'lmasa). Manfiy/nol summalar jami summaga qo'shilmaydi. `sharePct` noto'g'ri
 * yoki ≤ 0 — faqat eng kattasi; ≥ 100 — summasi musbat hammasi.
 */
export function selectMainMaterials(items: AggregatedMaterial[], sharePct: Dec = '95'): Set<string> {
  const result = new Set<string>()
  if (items.length === 0) return result
  const sorted = items
    .map((it, order) => ({ it, order }))
    .sort((a, b) => cmp(b.it.sum, a.it.sum) || a.order - b.order)
    .map(({ it }) => it)
  const positive = sorted.filter((it) => !isNegative(it.sum) && !isZero(it.sum))
  const total = positive.reduce<Dec>((s, it) => add(s, it.sum), '0')
  const first = sorted[0]
  if (first) result.add(first.key)
  if (isZero(total)) return result
  let pct: Dec
  try {
    pct = round(sharePct, 6)
  } catch {
    return result
  }
  const target = mul(total, pct) // ulush × 100 bilan solishtiriladi
  let cum: Dec = '0'
  for (const it of positive) {
    if (cmp(mul(cum, '100'), target) >= 0) break
    result.add(it.key)
    cum = add(cum, it.sum)
  }
  return result
}

// ---------------------------------------------------------------------------
// Birliklar va nomlar

export interface UnitGuess {
  /** Katalogdagi asosiy birlik nomi: dona, kg, t, m, m², m³, l, komplekt. */
  baseUnit: string
  /** 1 smeta birligi = factor × baseUnit. */
  factor: Dec
  /** "t", "10 dona", "100 m²". */
  unitLabel: string
}

/** Lotin harflari kirill o'xshashiga (smetalarda aralash yoziladi: "M3", "KГ"). */
const LATIN_TO_CYR: Record<string, string> = { a: 'а', c: 'с', e: 'е', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', h: 'н' }

/** Asosiy birlikka qo'shimcha ko'paytuvchi (km = 1000 m). */
const UNIT_SCALE: Record<string, Dec> = { км: '1000' }

const BASE_UNITS: Record<string, string> = {
  км: 'm',
  полюс: 'dona',
  т: 't',
  тн: 't',
  тонна: 't',
  кг: 'kg',
  м3: 'm³',
  'м³': 'm³',
  м2: 'm²',
  'м²': 'm²',
  м: 'm',
  пм: 'm',
  мп: 'm',
  л: 'l',
  шт: 'dona',
  комп: 'komplekt',
  компл: 'komplekt',
  комплект: 'komplekt',
  'к-т': 'komplekt',
  кт: 'komplekt',
}

/**
 * Smetadagi birlik matnidan katalog birligi va koeffitsient. Normallashtirish: `normalizeAlias`,
 * bo'sh joy va nuqtalar olib tashlanadi, lotin o'xshash harflar kirillga ("M3" → "м3").
 * Ko'paytuvchi oldida musbat butun son bo'lishi mumkin: "10 ШТ" → dona × 10, "1000М3" → m³ × 1000;
 * kasr ko'paytuvchi ("0.5 Т", "1,5М", "0,1т") → null.
 * "КМ" → m × 1000, "ПОЛЮС" → dona. Noma'lum (ЧЕЛ-Ч, МАШ-Ч, СУМ, …) → null.
 */
export function guessUnit(estimateUnit: string): UnitGuess | null {
  const k = Array.from(unitKey(estimateUnit), (ch) => LATIN_TO_CYR[ch] ?? ch).join('')
  // Kasr ko'paytuvchi ("0.5 Т", "1,5М") taxmin qilinmaydi — foydalanuvchidan so'raladi
  if (/\d[.,]\d/.test(k)) return null
  const m = /^(\d+)?(\D.*)$/.exec(k)
  if (!m) return null
  const key = m[2] ?? ''
  const base = BASE_UNITS[key]
  if (base === undefined) return null
  const prefix = (m[1] ?? '1').replace(/^0+(?=\d)/, '')
  if (prefix === '0') return null
  const factor = mul(prefix, UNIT_SCALE[key] ?? '1')
  return { baseUnit: base, factor, unitLabel: factor === '1' ? base : `${factor} ${base}` }
}

/** Kichik harf bilan yoziladigan o'lchov birliklari (so'z sifatida, raqamsiz yoki "м2"/"м3"). */
const LOWER_UNITS = new Set(['мм', 'см', 'дм', 'м', 'км', 'кг', 'г', 'т', 'тн', 'л', 'шт', 'м2', 'м3', 'мм2', 'см2', 'квт', 'вт', 'кв', 'мпа', 'кпа', 'атм'])
const CYR_VOWELS = /[аеёиоуыэюя]/i
const HAS_LOWER = /\p{Ll}/u

function isMarkToken(core: string): boolean {
  if (core === '') return false
  if (/[\p{N}Ø⌀]/u.test(core)) return true // marka/o'lcham: М-150, В15, Э42А, ПФ-115, Ø12
  if (/^[A-Z][A-Z-]*$/.test(core)) return true // lotin so'z/qisqartma: NYM, PVC, W
  if (/^[А-ЯЁ]?[IVX]+$/u.test(core)) return true // klass: АIII, AI
  const letters = core.replace(/[^\p{L}]/gu, '')
  // kirill qisqartma (unlisiz, ≥ 2 harf): ПВХ, ВВГ, МГ, СГ
  return letters.length >= 2 && /^[\p{Script=Cyrillic}]+$/u.test(letters) && !CYR_VOWELS.test(letters)
}

/**
 * Katalog uchun chiroyli nom. Bo'sh joylar bitta probelga. Nomda kichik harf bo'lsa — faqat
 * bo'sh joylar tuzatiladi. Aks holda (KATTA HARFLI smeta nomi) so'zma-so'z:
 * - o'lchov birligi (ММ, СМ, М, М2, М3, КГ, Т, Л, ШТ, КВТ, МПА, …) → kichik harf ("мм");
 * - marka va belgilar saqlanadi: raqamli so'zlar (М-150, В15, Э42А, ПФ-115, 5Х1,5), Ø, lotin
 *   qisqartmalar (NYM), klass (АIII), unlisiz kirill qisqartmalar (ПВХ, ВВГНГ, МГ);
 * - qolgan so'zlar kichik harf; natijaning birinchi harfi katta.
 */
export function materialNameFromEstimate(name: string): string {
  const s = name.replace(/\s+/g, ' ').trim()
  if (s === '' || HAS_LOWER.test(s)) return s
  const out = s.split(' ').map((token) => {
    const m = /^([^\p{L}\p{N}Ø⌀]*)(.*?)([^\p{L}\p{N}Ø⌀]*)$/u.exec(token)
    const lead = m?.[1] ?? ''
    const core = m?.[2] ?? token
    const trail = m?.[3] ?? ''
    if (LOWER_UNITS.has(core.toLowerCase())) return lead + core.toLowerCase() + trail
    if (isMarkToken(core)) return token
    return token.toLowerCase()
  })
  const joined = out.join(' ')
  const idx = joined.search(/\p{L}/u)
  if (idx < 0) return joined
  const ch = joined.charAt(idx)
  // Birinchi so'z marka bo'lsa (masalan "NYM") — o'zgarmaydi
  return joined.slice(0, idx) + ch.toUpperCase() + joined.slice(idx + 1)
}
