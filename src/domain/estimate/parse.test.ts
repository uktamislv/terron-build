import { describe, expect, it } from 'vitest'
import { autoMapColumns } from './mapping'
import { parseRows, type ParsedRow } from './parse'
import { CSV_STYLE } from './__fixtures__/csvStyle'
import { GRAND_SMETA, GRAND_SMETA_HEADER_ROW } from './__fixtures__/grandSmeta'
import { UZ_SIMPLE } from './__fixtures__/uzSimple'
import type { Cell } from './types'

function parseFixture(rows: Cell[][], headerRow: number): ParsedRow[] {
  return parseRows(rows, headerRow, autoMapColumns(rows[headerRow] ?? []))
}

function byRow(rows: ParsedRow[], n: number): ParsedRow {
  const r = rows.find((x) => x.rowNumber === n)
  if (!r) throw new Error(`qator ${n} yo'q`)
  return r
}

describe('parseRows — grand-smeta', () => {
  const rows = parseFixture(GRAND_SMETA, GRAND_SMETA_HEADER_ROW)

  it('qator raqamlari Excel bo\'yicha (1 dan), sarlavhadan keyin', () => {
    expect(rows[0]?.rowNumber).toBe(GRAND_SMETA_HEADER_ROW + 2)
    expect(rows).toHaveLength(GRAND_SMETA.length - GRAND_SMETA_HEADER_ROW - 1)
  })

  it('turlar', () => {
    expect(rows.map((r) => r.kind)).toEqual([
      'empty', // 1 | 2 | 3 ... ustun raqamlari
      'section', // Раздел 1 (A ustunida)
      'item',
      'item',
      'total',
      'section',
      'item',
      'item',
      'invalid',
      'item',
      'total',
      'empty',
      'total', // Всего по смете (A ustunida)
    ])
  })

  it('bo\'lim va jami nomi boshqa ustundan olinadi', () => {
    expect(byRow(rows, 7).name).toBe('Раздел 1. Земляные работы')
    expect(byRow(rows, 18).name).toBe('Всего по смете')
  })

  it('satr va number raqamlar', () => {
    const r = byRow(rows, 8)
    expect(r).toMatchObject({
      name: 'Разработка грунта экскаватором',
      unit: 'м3',
      qty: '1250.5',
      price: '12000',
      sum: '15006000',
      code: 'ФЕР01-01-003-01',
      type: null,
      errors: [],
    })
    expect(byRow(rows, 9)).toMatchObject({ qty: '120.75', price: '85000.5', sum: '10263810.38', errors: [] })
  })

  it('qty noto\'g\'ri → invalid; sum_mismatch — ogohlantirish', () => {
    expect(byRow(rows, 14)).toMatchObject({ kind: 'invalid', qty: null, errors: ['qty_invalid'] })
    // 0.1 + 0.2 → '0.3'; 0.3 × 950000 = 285000 ≠ 400000
    expect(byRow(rows, 15)).toMatchObject({ kind: 'item', qty: '0.3', errors: ['sum_mismatch'] })
  })
})

describe('parseRows — o\'zbekcha', () => {
  const rows = parseFixture(UZ_SIMPLE, 0)

  it('tur ustuni', () => {
    expect(rows.slice(0, 3).map((r) => r.type)).toEqual(['material', 'material', 'ish'])
    expect(rows[1]).toMatchObject({ kind: 'item', qty: '50', price: '65000', sum: '3250000' })
  })

  it('xatolar', () => {
    expect(rows[3]).toMatchObject({ kind: 'invalid', errors: ['qty_not_positive'] })
    expect(rows[4]).toMatchObject({ kind: 'invalid', unit: '', errors: ['unit_missing'] })
    expect(rows[5]).toMatchObject({ kind: 'invalid', price: '-5', errors: ['price_invalid'] })
    expect(rows[6]).toMatchObject({ kind: 'total', name: 'Jami' })
  })
})

describe('parseRows — CSV uslubi', () => {
  const rows = parseFixture(CSV_STYLE, 3)

  it('NBSP minglik, nuqta kasr, bo\'sh qty', () => {
    expect(rows[0]).toMatchObject({ kind: 'item', code: 'M-01', qty: '35.5', price: '180000', sum: null })
    expect(rows[1]).toMatchObject({ kind: 'item', qty: '1200', price: '75000' })
    expect(rows[2]).toMatchObject({ kind: 'invalid', errors: ['qty_missing'] })
    expect(rows[3]).toMatchObject({ kind: 'empty', rowNumber: 8 })
  })
})

describe('parseRows — chegaraviy holatlar', () => {
  const mapping = { name: 0, unit: 1, qty: 2, price: 3, sum: 4, type: 5 }

  it('sum_mismatch chegarasi: aynan 1 so\'m — xato emas, 1.01 — xato', () => {
    const rows = parseRows(
      [[], ['A', 'm', 2, '10', '21'], ['B', 'm', 2, 10, '21.01'], ['C', 'm', 2, 10, '19']],
      0,
      mapping,
    )
    expect(rows.map((r) => r.errors)).toEqual([[], ['sum_mismatch'], []])
  })

  it('summa noto\'g\'ri, narx noto\'g\'ri', () => {
    const rows = parseRows([[], ['A', 'm', 1, 'x', 'y']], 0, mapping)
    expect(rows[0]).toMatchObject({ kind: 'invalid', price: null, sum: null, errors: ['price_invalid', 'sum_invalid'] })
  })

  it('manfiy qty, bir nechta xato', () => {
    const rows = parseRows([[], ['A', '', '-3']], 0, mapping)
    expect(rows[0]?.errors).toEqual(['qty_not_positive', 'unit_missing'])
  })

  it('nom bo\'sh, raqamlar bor → invalid', () => {
    const rows = parseRows([[], [null, 'm', 5, 10]], 0, mapping)
    expect(rows[0]).toMatchObject({ kind: 'invalid', errors: [] })
  })

  it('bo\'lim: nom bor, qty/unit/price yo\'q (summa bo\'lsa ham)', () => {
    const rows = parseRows([[], ['1-bo\'lim. Poydevor', null, null, null, 5000]], 0, mapping)
    expect(rows[0]).toMatchObject({ kind: 'section', name: "1-bo'lim. Poydevor" })
  })

  it('jami prefikslari', () => {
    const rows = parseRows(
      [[], ['ИТОГО'], ['Всего по смете', 'm', 1], ['Jami: 5 000'], ['Итоговая'], ['Всегда', 'm', 1]],
      0,
      mapping,
    )
    expect(rows.map((r) => r.kind)).toEqual(['total', 'total', 'total', 'total', 'item'])
  })

  it('tur so\'zlari', () => {
    const rows = parseRows(
      [[], ['a', 'm', 1, null, null, 'Работы'], ['b', 'm', 1, null, null, 'МАТЕРИАЛ'], ['c', 'm', 1, null, null, 'boshqa']],
      0,
      mapping,
    )
    expect(rows.map((r) => r.type)).toEqual(['ish', 'material', null])
  })

  it('xaritada yo\'q ustun va bo\'sh ro\'yxat', () => {
    expect(parseRows([['h']], 0, mapping)).toEqual([])
    const rows = parseRows([[], ['Qum', 'm3', 5]], 0, { name: 0, unit: 1, qty: 2 })
    expect(rows[0]).toMatchObject({ kind: 'item', price: null, sum: null, code: '', type: null, errors: [] })
  })

  it('juda katta son', () => {
    const rows = parseRows([[], ['A', 'm', 1e21, '1 000 000 000 000']], 0, mapping)
    expect(rows[0]).toMatchObject({ kind: 'item', qty: '1000000000000000000000', price: '1000000000000' })
  })
})
