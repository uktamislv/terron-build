// Smeta faylini brauzerda o'qish (SheetJS). Fayl serverga yuklanmaydi — faqat natija saqlanadi.
// `xlsx` faqat shu yerda va dinamik import bilan — bosh bundle kattalashmaydi.
import type { Cell } from '@/domain/estimate'

export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const ACCEPTED_EXTENSIONS = ['.xlsx', '.xls', '.csv'] as const
/** O'qiladigan qatorlar (DoS himoyasi) va ustunlar chegarasi. */
export const MAX_SHEET_ROWS = 20000
export const MAX_SHEET_COLS = 100

export interface SheetData {
  name: string
  rows: Cell[][]
  /** `rows[0]` Excel'dagi qaysi qator (0 dan): Excel raqami = indeks + 1 + rowOffset. */
  rowOffset: number
  /** Yashirin qatorlar — Excel raqamlari (1 dan). */
  hiddenRows: number[]
}

export type ReadError = 'file_type' | 'file_too_large' | 'file_unreadable' | 'file_empty'

export class WorkbookError extends Error {
  readonly reason: ReadError
  constructor(reason: ReadError) {
    super(reason)
    this.name = 'WorkbookError'
    this.reason = reason
  }
}

export function checkFile(file: Pick<File, 'name' | 'size'>): ReadError | null {
  const lower = file.name.toLowerCase()
  if (!ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'file_type'
  if (file.size > MAX_FILE_BYTES) return 'file_too_large'
  if (file.size === 0) return 'file_empty'
  return null
}

function toCell(v: unknown): Cell {
  if (typeof v === 'string' || typeof v === 'boolean') return v
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  return null
}

/** `Blob.arrayBuffer` bo'lmagan eski WebView'lar uchun FileReader zaxirasi. */
function toArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}

/**
 * CSV baytlari → matn: UTF-8 (BOM bo'lsa ham), noto'g'ri UTF-8 bo'lsa — Windows-1251 (rus Excel).
 * SheetJS'ga baytlar emas, matn beriladi — u o'zi kodlashni taxmin qilmasin.
 */
export function decodeCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1251').decode(bytes)
  }
}

interface RowInfo {
  hidden?: boolean
}

/**
 * Faylni varaqlarga ajratadi; formulalar — hisoblangan qiymat, sanalar — son (cellDates: false).
 * CSV — alohida yo'l: barcha kataklar satr (`raw: true`), "1,5" kabi vergulli kasrlarni `parseDec`
 * hal qiladi (SheetJS'ning son taxmini "1,5" ni 15 qilardi).
 */
export async function readWorkbook(file: File): Promise<SheetData[]> {
  const bad = checkFile(file)
  if (bad) throw new WorkbookError(bad)
  let buffer: ArrayBuffer
  try {
    buffer = await toArrayBuffer(file)
  } catch {
    throw new WorkbookError('file_unreadable')
  }
  const XLSX = await import('xlsx')
  const isCsv = file.name.toLowerCase().endsWith('.csv')
  const limits = { sheetRows: MAX_SHEET_ROWS + 1, dense: true } as const
  let sheets: SheetData[]
  try {
    const wb = isCsv
      ? XLSX.read(decodeCsv(new Uint8Array(buffer)), { type: 'string', raw: true, ...limits })
      : XLSX.read(buffer, { type: 'array', cellDates: false, cellStyles: true, ...limits })
    sheets = wb.SheetNames.map((name) => {
      const ws = wb.Sheets[name]
      if (!ws) return { name, rows: [], rowOffset: 0, hiddenRows: [] }
      let rowOffset = 0
      const ref = ws['!ref']
      if (ref) {
        const range = XLSX.utils.decode_range(ref)
        if (range.e.c - range.s.c >= MAX_SHEET_COLS) range.e.c = range.s.c + MAX_SHEET_COLS - 1
        ws['!ref'] = XLSX.utils.encode_range(range)
        rowOffset = range.s.r
      }
      const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: true })
      const info = (ws['!rows'] ?? []) as (RowInfo | undefined)[]
      const hiddenRows: number[] = []
      info.forEach((r, i) => {
        if (r?.hidden) hiddenRows.push(i + 1)
      })
      return { name, rows: raw.map((r) => (Array.isArray(r) ? r.map(toCell) : [])), rowOffset, hiddenRows }
    })
  } catch {
    throw new WorkbookError('file_unreadable')
  }
  if (sheets.length === 0 || sheets.every((s) => s.rows.length === 0)) throw new WorkbookError('file_empty')
  return sheets
}
