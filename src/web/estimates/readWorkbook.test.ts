// @vitest-environment node
// Haqiqiy `xlsx` moduli bilan (mock emas) — aynan kutubxona xatti-harakati tekshiriladi.
import * as XLSX from 'xlsx'
import { cellToDec } from '@/domain/estimate'
import { decodeCsv, MAX_SHEET_COLS, readWorkbook } from './readWorkbook'

/** Minimal CP1251 kodlovchi: kirill А–я, Ё/ё, qolgani ASCII. */
function cp1251(text: string): Uint8Array {
  return Uint8Array.from(Array.from(text), (ch) => {
    const c = ch.codePointAt(0) ?? 0
    if (c >= 0x410 && c <= 0x44f) return c - 0x410 + 0xc0
    if (c === 0x401) return 0xa8
    if (c === 0x451) return 0xb8
    if (c < 0x80) return c
    throw new Error(`cp1251: ${ch}`)
  })
}

function file(bytes: Uint8Array | string, name: string): File {
  return new File([bytes as BlobPart], name)
}

const CSV = 'Наименование;Ед. изм.;Кол-во;Цена\nЦемент М500;т;1,5;1 234,5\nПесок;м3;"1 234,5";10\n'

describe('readWorkbook — CSV', () => {
  it('UTF-8, ";" ajratkich: vergulli kasr satr bo‘lib keladi va to‘g‘ri o‘qiladi', async () => {
    const [sheet] = await readWorkbook(file(new TextEncoder().encode(CSV), 'smeta.csv'))
    const rows = sheet?.rows ?? []
    expect(rows[0]?.[0]).toBe('Наименование')
    expect(rows[1]?.[0]).toBe('Цемент М500')
    expect(rows[1]?.[2]).toBe('1,5')
    expect(cellToDec(rows[1]?.[2])).toEqual({ state: 'ok', value: '1.5' })
    expect(cellToDec(rows[1]?.[3])).toEqual({ state: 'ok', value: '1234.5' })
    expect(cellToDec(rows[2]?.[2])).toEqual({ state: 'ok', value: '1234.5' })
  })

  it('UTF-8 BOM bilan', async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(CSV)])
    const [sheet] = await readWorkbook(file(bytes, 'smeta.csv'))
    expect(sheet?.rows[0]?.[0]).toBe('Наименование')
  })

  it('Windows-1251 (rus Excel) — kirill nomlar to‘g‘ri', async () => {
    const [sheet] = await readWorkbook(file(cp1251(CSV), 'smeta.csv'))
    expect(sheet?.rows[1]?.[0]).toBe('Цемент М500')
    expect(sheet?.rows[2]?.[0]).toBe('Песок')
    expect(cellToDec(sheet?.rows[1]?.[2])).toEqual({ state: 'ok', value: '1.5' })
  })

  it('decodeCsv: noto‘g‘ri UTF-8 → CP1251', () => {
    expect(decodeCsv(cp1251('Ёлка'))).toBe('Ёлка')
  })
})

describe('readWorkbook — XLSX', () => {
  function xlsx(ws: XLSX.WorkSheet): File {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Smeta')
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellStyles: true }) as ArrayBuffer
    return file(new Uint8Array(out), 'smeta.xlsx')
  }

  it('yashirin qatorlar va `!ref` siljishi (Excel qator raqami)', async () => {
    const ws = XLSX.utils.sheet_add_aoa(
      XLSX.utils.aoa_to_sheet([]),
      [
        ['Наименование', 'Ед.', 'Кол-во'],
        ['Цемент', 'т', 2],
        ['Песок', 'м3', 3],
      ],
      { origin: 'A3' },
    )
    ws['!ref'] = 'A3:C5'
    ws['!rows'] = []
    ws['!rows'][3] = { hidden: true } // Excel'da 4-qator ("Цемент")
    const [sheet] = await readWorkbook(xlsx(ws))
    expect(sheet?.rowOffset).toBe(2)
    expect(sheet?.rows[0]?.[0]).toBe('Наименование')
    expect(sheet?.hiddenRows).toEqual([4])
    expect(sheet?.rows[1]?.[2]).toBe(2)
  })

  it(`ustunlar ${MAX_SHEET_COLS} tagacha qisqartiriladi`, async () => {
    const wide = Array.from({ length: 150 }, (_, i) => `c${i}`)
    const [sheet] = await readWorkbook(xlsx(XLSX.utils.aoa_to_sheet([wide, wide])))
    expect(sheet?.rows[0]).toHaveLength(MAX_SHEET_COLS)
  })
})
