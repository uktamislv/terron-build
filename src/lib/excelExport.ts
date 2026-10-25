// Umumiy Excel eksport (SheetJS, lazy chunk). docs/reports-design.md "Excel eksport":
// matn — formula injection himoyasi (`safeCell`), pul va miqdor — son katagi (aniq qiymatdan,
// 15 raqamdan uzun bo'lsa — matn), sana — Excel sana katagi `dd.mm.yyyy`, birinchi qator qotirilgan.
import { decToExcelNumber, isoToExcelDate, safeCell } from '@/domain/reports'
import { formatDate, formatDateTime, tashkentIsoDate } from './format'

export type ExportColumnType = 'text' | 'number' | 'money' | 'qty' | 'date' | 'datetime'

export interface ExportColumn {
  header: string
  key: string
  type: ExportColumnType
  /** Ustun kengligi (belgilarda); berilmasa — mazmunga qarab. */
  width?: number
}

export type ExportRow = Record<string, unknown>

export interface ExportSheetSpec {
  sheetName: string
  columns: ExportColumn[]
  rows: ExportRow[]
}

/** SheetJS katagi (faqat kerakli maydonlar). */
export interface XCell {
  t: 's' | 'n'
  v: string | number
  z?: string
}

export type XWorksheet = Record<string, unknown> & {
  '!ref': string
  '!cols': { wch: number }[]
}

/** So'm formati: minglik ajratuvchi (o'zbek/rus Excel'da — bo'sh joy), kasrsiz. */
export const MONEY_FORMAT = '#,##0'
export const QTY_FORMAT = 'General'
export const DATE_FORMAT = 'dd.mm.yyyy'
export const DATETIME_FORMAT = 'dd.mm.yyyy hh:mm'

const MIN_WIDTH = 8
const MAX_WIDTH = 50

/** Ustun indeksi → harf ("A", "Z", "AA"). */
export function colName(c: number): string {
  let n = c + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

export function cellRef(r: number, c: number): string {
  return `${colName(c)}${r + 1}`
}

/** ISO sana yoki vaqt → Toshkent kuni `yyyy-mm-dd`. */
function tashkentDay(value: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return tashkentIsoDate(0, d)
}

function textCell(value: unknown): XCell | null {
  if (value === null || value === undefined) return null
  const s = String(value)
  if (s === '') return null
  return { t: 's', v: safeCell(s) }
}

function decCell(value: unknown, z?: string): XCell | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? { t: 'n', v: value, ...(z ? { z } : {}) } : null
  let n: number | string
  try {
    n = decToExcelNumber(String(value))
  } catch {
    return textCell(value)
  }
  // Aniqlik yo'qolmasligi uchun matn — formula himoyasi bilan ("-123..." ham)
  return typeof n === 'number' ? { t: 'n', v: n, ...(z ? { z } : {}) } : { t: 's', v: safeCell(n) }
}

function dateCell(value: unknown, withTime: boolean): XCell | null {
  if (value === null || value === undefined || value === '') return null
  const s = String(value)
  const day = tashkentDay(s)
  if (!day) return textCell(s)
  let serial: number
  try {
    serial = isoToExcelDate(day)
  } catch {
    return textCell(s)
  }
  if (!withTime || /^\d{4}-\d{2}-\d{2}$/.test(s)) return { t: 'n', v: serial, z: withTime ? DATETIME_FORMAT : DATE_FORMAT }
  // formatDateTime → "dd.mm.yyyy HH:mm" (Toshkent)
  const [, hh = '0', mm = '0'] = /(\d{2}):(\d{2})$/.exec(formatDateTime(s)) ?? []
  return { t: 'n', v: serial + (Number(hh) * 60 + Number(mm)) / 1440, z: DATETIME_FORMAT }
}

/** Bitta qiymat → katak (yoki bo'sh). */
export function toCell(value: unknown, type: ExportColumnType): XCell | null {
  switch (type) {
    case 'text':
      return textCell(value)
    case 'number':
      return decCell(value)
    case 'money':
      return decCell(value, MONEY_FORMAT)
    case 'qty':
      return decCell(value, QTY_FORMAT)
    case 'date':
      return dateCell(value, false)
    case 'datetime':
      return dateCell(value, true)
  }
}

function displayLength(cell: XCell | null, type: ExportColumnType): number {
  if (!cell) return 0
  if (type === 'date') return 10
  if (type === 'datetime') return 16
  if (typeof cell.v === 'number') return String(Math.round(cell.v)).length + (type === 'money' ? 4 : 2)
  return Math.max(...cell.v.split('\n').map((l) => l.length))
}

/** Sof: ustunlar va qatorlar → SheetJS worksheet obyekti (sarlavha 1-qator). */
export function buildWorksheet(columns: ExportColumn[], rows: ExportRow[]): XWorksheet {
  const ws: Record<string, unknown> = {}
  const widths = columns.map((c) => c.header.length)
  columns.forEach((col, c) => {
    ws[cellRef(0, c)] = { t: 's', v: safeCell(col.header) } satisfies XCell
  })
  rows.forEach((row, i) => {
    columns.forEach((col, c) => {
      const cell = toCell(row[col.key], col.type)
      if (cell) ws[cellRef(i + 1, c)] = cell
      widths[c] = Math.max(widths[c] ?? 0, displayLength(cell, col.type))
    })
  })
  const lastCol = Math.max(columns.length - 1, 0)
  ws['!ref'] = `A1:${cellRef(rows.length, lastCol)}`
  ws['!cols'] = columns.map((col, c) => ({
    wch: col.width ?? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, (widths[c] ?? 0) + 2)),
  }))
  return ws as XWorksheet
}

/** Excel varaq nomi: ≤ 31 belgi, `[]:*?/\` yo'q, bo'sh emas. */
export function sheetTitle(name: string): string {
  const clean = name.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31)
  return clean || 'Sheet1'
}

/** `terron-<bo'lim>-<dd.mm.yyyy>.xlsx` (Toshkent sanasi). */
export function exportFileName(section: string, now: Date = new Date()): string {
  return `terron-${section}-${formatDate(now)}.xlsx`
}

const FROZEN_VIEW =
  '<sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
  '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView>'

type XlsxModule = typeof import('xlsx')

/**
 * SheetJS CE qotirilgan qatorni yozmaydi — tayyor zip ichidagi varaq XML'iga `pane` qo'shiladi.
 * Biror narsa kutilmagandek bo'lsa — asl fayl qaytadi (qotirishsiz, lekin to'g'ri).
 */
function freezeHeader(XLSX: XlsxModule, bytes: Uint8Array, sheetCount: number): Uint8Array {
  try {
    const CFB = XLSX.CFB
    const zip = CFB.read(bytes, { type: 'array' })
    const enc = new TextEncoder()
    const dec = new TextDecoder()
    for (let i = 1; i <= sheetCount; i++) {
      const file = CFB.find(zip, `/xl/worksheets/sheet${i}.xml`)
      if (!file?.content) return bytes
      const xml = dec.decode(file.content as Uint8Array)
      const next = xml.replace(/<sheetView\b[^>]*?(\/>|>[\s\S]*?<\/sheetView>)/, FROZEN_VIEW)
      if (next === xml) return bytes
      CFB.utils.cfb_add(zip, `/xl/worksheets/sheet${i}.xml`, enc.encode(next))
    }
    const out = CFB.write(zip, { fileType: 'zip', type: 'array', compression: true }) as ArrayBuffer | number[] | Uint8Array
    return out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer)
  } catch {
    return bytes
  }
}

function saveFile(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([bytes as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function abortIfNeeded(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

/** Bir nechta varaqli fayl (masalan podotchet: balans + tarix). */
export async function exportWorkbook(opts: {
  fileName: string
  sheets: ExportSheetSpec[]
  signal?: AbortSignal
}): Promise<void> {
  abortIfNeeded(opts.signal)
  const XLSX = await import('xlsx')
  abortIfNeeded(opts.signal)
  const wb = XLSX.utils.book_new()
  const used = new Set<string>()
  for (const sheet of opts.sheets) {
    let name = sheetTitle(sheet.sheetName)
    for (let k = 2; used.has(name); k++) name = sheetTitle(`${sheet.sheetName.slice(0, 27)} ${k}`)
    used.add(name)
    XLSX.utils.book_append_sheet(wb, buildWorksheet(sheet.columns, sheet.rows) as never, name)
  }
  const raw = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true }) as ArrayBuffer
  const bytes = freezeHeader(XLSX, new Uint8Array(raw), opts.sheets.length)
  abortIfNeeded(opts.signal)
  saveFile(bytes, opts.fileName)
}

/** Bitta varaqli fayl. */
export function exportSheet(opts: {
  fileName: string
  sheetName: string
  columns: ExportColumn[]
  rows: ExportRow[]
  signal?: AbortSignal
}): Promise<void> {
  return exportWorkbook({
    fileName: opts.fileName,
    sheets: [{ sheetName: opts.sheetName, columns: opts.columns, rows: opts.rows }],
    signal: opts.signal,
  })
}
