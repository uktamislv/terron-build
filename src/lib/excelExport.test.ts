import { isAbortError } from '@/data/fetchAll'
import { buildWorksheet, cellRef, exportFileName, exportSheet, sheetTitle, toCell, type ExportColumn } from './excelExport'

const xlsx = vi.hoisted(() => ({
  appended: [] as { ws: Record<string, unknown>; name: string }[],
}))

vi.mock('xlsx', () => ({
  utils: {
    book_new: () => ({ SheetNames: [], Sheets: {} }),
    book_append_sheet: (_wb: unknown, ws: Record<string, unknown>, name: string) => xlsx.appended.push({ ws, name }),
  },
  write: () => new Uint8Array([1, 2, 3]).buffer,
  // zip post-processing muvaffaqiyatsiz — asl baytlar ishlatiladi
  CFB: {
    read: () => {
      throw new Error('not a zip')
    },
  },
}))

describe('katak turlari', () => {
  it('matn — formula injection himoyasi', () => {
    expect(toCell('=SUM(A1)', 'text')).toEqual({ t: 's', v: "'=SUM(A1)" })
    expect(toCell('+998', 'text')).toEqual({ t: 's', v: "'+998" })
    expect(toCell('@x', 'text')).toEqual({ t: 's', v: "'@x" })
    expect(toCell('Sement', 'text')).toEqual({ t: 's', v: 'Sement' })
    expect(toCell(null, 'text')).toBeNull()
  })

  it('pul va miqdor — son katagi; 15 raqamdan uzun — matn', () => {
    expect(toCell('1250000.50', 'money')).toEqual({ t: 'n', v: 1250000.5, z: '#,##0' })
    expect(toCell('12.345', 'qty')).toMatchObject({ t: 'n', v: 12.345 })
    expect(toCell('1234567890123456.7', 'money')).toEqual({ t: 's', v: '1234567890123456.7' })
    expect(toCell('-1234567890123456.7', 'money')).toEqual({ t: 's', v: "'-1234567890123456.7" })
    expect(toCell(7, 'number')).toEqual({ t: 'n', v: 7 })
  })

  it('sana — Excel seriya raqami, Toshkent kuni bo‘yicha', () => {
    expect(toCell('2026-01-01', 'date')).toEqual({ t: 'n', v: 46023, z: 'dd.mm.yyyy' })
    // 2025-12-31 20:00 UTC = 2026-01-01 01:00 Toshkent
    expect(toCell('2025-12-31T20:00:00Z', 'date')).toEqual({ t: 'n', v: 46023, z: 'dd.mm.yyyy' })
    const dt = toCell('2025-12-31T20:30:00Z', 'datetime')
    expect(dt?.z).toBe('dd.mm.yyyy hh:mm')
    expect(dt?.v).toBeCloseTo(46023 + 90 / 1440, 8)
  })
})

describe('buildWorksheet', () => {
  const columns: ExportColumn[] = [
    { header: 'Nomi', key: 'name', type: 'text' },
    { header: 'Summa', key: 'sum', type: 'money' },
    { header: 'Sana', key: 'day', type: 'date' },
  ]

  it('sarlavha, kataklar, diapazon va kengliklar', () => {
    const ws = buildWorksheet(columns, [
      { name: '=cmd', sum: '1000', day: '2026-10-01' },
      { name: null, sum: null, day: null },
    ])
    expect(ws.A1).toEqual({ t: 's', v: 'Nomi' })
    expect(ws.A2).toEqual({ t: 's', v: "'=cmd" })
    expect(ws.B2).toEqual({ t: 'n', v: 1000, z: '#,##0' })
    expect(ws.C2).toMatchObject({ t: 'n', z: 'dd.mm.yyyy' })
    expect(ws.A3).toBeUndefined()
    expect(ws['!ref']).toBe('A1:C3')
    expect(ws['!cols']).toHaveLength(3)
    expect(ws['!cols'][0]?.wch).toBeGreaterThanOrEqual(8)
  })

  it('yordamchilar', () => {
    expect(cellRef(0, 0)).toBe('A1')
    expect(cellRef(9, 27)).toBe('AB10')
    expect(sheetTitle('So‘rovlar [1]/2')).toBe('So‘rovlar  1  2')
    expect(sheetTitle('x'.repeat(40))).toHaveLength(31)
    expect(exportFileName('xaridlar', new Date('2026-10-24T20:00:00Z'))).toBe('terron-xaridlar-25.10.2026.xlsx')
  })
})

describe('exportSheet (xlsx mock)', () => {
  beforeEach(() => {
    xlsx.appended.length = 0
  })

  it('varaq qo‘shiladi va fayl nomi bilan yuklanadi', async () => {
    const createUrl = vi.fn(() => 'blob:x')
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('terron-test-01.10.2026.xlsx')
    })
    await exportSheet({
      fileName: 'terron-test-01.10.2026.xlsx',
      sheetName: 'Xaridlar',
      columns: [{ header: 'Izoh', key: 'note', type: 'text' }],
      rows: [{ note: '-1+1' }],
    })
    expect(xlsx.appended).toHaveLength(1)
    expect(xlsx.appended[0]?.name).toBe('Xaridlar')
    expect(xlsx.appended[0]?.ws.A2).toEqual({ t: 's', v: "'-1+1" })
    expect(createUrl).toHaveBeenCalled()
    expect(click).toHaveBeenCalledTimes(1)
    click.mockRestore()
  })

  it('bekor qilingan — fayl yaratilmaydi', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(exportSheet({ fileName: 'a.xlsx', sheetName: 'a', columns: [], rows: [], signal: ctrl.signal })).rejects.toSatisfy(
      isAbortError,
    )
    expect(xlsx.appended).toHaveLength(0)
  })
})
