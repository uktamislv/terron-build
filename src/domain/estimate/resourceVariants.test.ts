import { describe, expect, it } from 'vitest'
import { add, type Dec } from '../decimal'
import {
  aggregateMaterials,
  detectResourceLayout,
  guessUnit,
  isIdentifierCode,
  parseResourceEstimate,
  sciToDec,
  type ResourceLayout,
  type ResourceRow,
} from './resource'
import { RESOURCE_MIXED, RESOURCE_NO_CABLE, RESOURCE_SVOD } from './__fixtures__/resourceVariants'
import type { Cell } from './types'

function layoutOf(rows: Cell[][]): ResourceLayout {
  const l = detectResourceLayout(rows)
  if (!l) throw new Error('layout topilmadi')
  return l
}

const sumOf = (rs: ResourceRow[]): Dec => rs.reduce<Dec>((s, r) => add(s, r.sum ?? '0'), '0')
const kinds = (rs: ResourceRow[]): Record<string, number[]> => {
  const out: Record<string, number[]> = {}
  for (const r of rs) (out[r.kind] ??= []).push(r.rowNumber)
  return out
}

describe('tur ustunlarisiz "сводная" LRV', () => {
  const layout = layoutOf(RESOURCE_SVOD)
  const p = parseResourceEstimate(RESOURCE_SVOD, layout)

  it('layout: sarlavha 3-qatorda, tur ustunlari null', () => {
    expect(layout).toEqual({
      headerRow: 2,
      dataStartRow: 5,
      col: {
        no: 0,
        code: 1,
        name: 2,
        unit: 3,
        perUnit: 4,
        qty: 5,
        price: 6,
        sum: 7,
        labor: null,
        machine: null,
        material: null,
        equipment: null,
        cable: null,
      },
    })
  })

  it('resurslari bor ish resurs emas; resurssiz ish — material; tur birlikdan', () => {
    expect(p.works.map((w) => w.no)).toEqual(['1', '2', '3', '4', '5', '6'])
    expect(kinds(p.resources)).toEqual({ machine: [9], labor: [11, 17], material: [12, 14, 15, 18, 19] })
    expect(p.resources.find((r) => r.rowNumber === 15)).toMatchObject({ workNo: '4', qty: '6', price: '41400', sum: '248400' })
  })

  it('resurslar summasi = ish qatorlari summasi; jami qatorlari yo\'q', () => {
    expect(sumOf(p.resources)).toBe('568400')
    expect(p.totals).toEqual({ labor: null, machine: null, material: null, equipment: null, cable: null, grand: null })
    expect(p.skipped).toEqual([
      { rowNumber: 6, reason: 'section' },
      { rowNumber: 7, reason: 'section' },
      { rowNumber: 13, reason: 'empty' },
    ])
  })

  it('"ПО ПРОЕКТУ" yoki "N.M" qatorlari bo\'lmasa — oddiy smeta (null)', () => {
    expect(detectResourceLayout(RESOURCE_SVOD.filter((_, i) => i !== 3))).toBeNull()
    expect(detectResourceLayout(RESOURCE_SVOD.filter((r) => !/^\d+\.\d+$/.test(String(r[0] ?? ''))))).toBeNull()
  })
})

describe('aralash LRV: texnika "materiallar" ustunida, eksponentali son, КМ/ПОЛЮС', () => {
  const layout = layoutOf(RESOURCE_MIXED)
  const p = parseResourceEstimate(RESOURCE_MIXED, layout)

  it('layout: sarlavhadan oldin bo\'sh qator; tur ustunlari jamidan', () => {
    expect(layout.headerRow).toBe(3)
    expect(layout.dataStartRow).toBe(6)
    expect(layout.col).toMatchObject({ labor: 8, machine: 9, material: 10, cable: 11, equipment: 12 })
  })

  it('МАШ/ЧАС va МАШ.ЧАС — qaysi ustunda bo\'lmasin texnika', () => {
    expect(kinds(p.resources)).toEqual({
      labor: [10, 16, 19],
      machine: [11, 12, 13],
      material: [14, 15, 17],
      equipment: [20, 21],
    })
  })

  it('"4E-005" → 0.00004; xato qator yo\'q', () => {
    expect(p.resources.find((r) => r.rowNumber === 14)?.qty).toBe('0.00004')
    expect(p.skipped.filter((s) => s.reason === 'invalid')).toEqual([])
  })

  it('tur ustunlari bor smetada ish qatorining o\'z summasi resurs (resurslari bo\'lsa ham)', () => {
    expect(p.resources.find((r) => r.rowNumber === 15)).toMatchObject({ workNo: '3', kind: 'material', sum: '300000' })
    // barcha resurslar = ИТОГО
    expect(sumOf(p.resources)).toBe('6334040')
  })

  it('jami: yorliqlardan; grand — ВСЕГО С НДС; izoh qatorlari — total', () => {
    expect(p.totals).toEqual({
      labor: '420000',
      machine: '500000',
      material: '1224040',
      equipment: '990000',
      cable: '3200000',
      grand: '7206124.8',
    })
    expect(p.skipped.filter((s) => s.reason === 'total').map((s) => s.rowNumber)).toEqual([
      22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 34, 35,
    ])
  })

  it('barcha material/uskuna birliklari taniladi', () => {
    const units = aggregateMaterials(p.resources).map((a) => a.unit)
    expect(units.filter((u) => guessUnit(u) === null)).toEqual([])
  })
})

describe('kabelsiz LRV, izoh ustuni, oxirgi "Итого:"', () => {
  const layout = layoutOf(RESOURCE_NO_CABLE)
  const p = parseResourceEstimate(RESOURCE_NO_CABLE, layout)

  it('izoh ustuni tur ustuni emas; kabel ustuni yo\'q', () => {
    expect(layout.col).toMatchObject({ labor: 8, machine: 9, material: 10, equipment: 11, cable: null })
  })

  it('kichik harfli birliklar, turlar, jami', () => {
    expect(kinds(p.resources)).toEqual({ labor: [8, 12], machine: [9], material: [10, 13], equipment: [14] })
    expect(sumOf(p.resources)).toBe('57048486')
    expect(p.totals).toEqual({
      labor: '1584000',
      machine: '2000000',
      material: '51964486',
      equipment: '1500000',
      cable: null,
      grand: '58048486',
    })
  })

  it('imzo qatori bo\'lim sifatida o\'tkaziladi, xato yo\'q', () => {
    expect(p.skipped.at(-1)).toEqual({ rowNumber: 24, reason: 'section' })
    expect(p.skipped.filter((s) => s.reason === 'invalid')).toEqual([])
  })
})

describe('sciToDec', () => {
  it.each([
    ['4E-005', '0.00004'],
    ['1,5e3', '1500'],
    ['-2.25E+2', '-225'],
    ['1E0', '1'],
    ['0e5', '0'],
    [' 3e-1 ', '0.3'],
  ])('%j → %s', (input, expected) => {
    expect(sciToDec(input)).toBe(expected)
  })

  it.each(['', 'e5', '1e', '1e31', '1e-31', '1.2.3e4', 'abc', '1 000e2'])('%j → null', (input) => {
    expect(sciToDec(input)).toBeNull()
  })
})

describe('guessUnit — yangi birliklar', () => {
  it('КМ → m × 1000, 10КМ → m × 10000, ПОЛЮС → dona', () => {
    expect(guessUnit('КМ')).toEqual({ baseUnit: 'm', factor: '1000', unitLabel: '1000 m' })
    expect(guessUnit('км.')).toEqual({ baseUnit: 'm', factor: '1000', unitLabel: '1000 m' })
    expect(guessUnit('10КМ')).toEqual({ baseUnit: 'm', factor: '10000', unitLabel: '10000 m' })
    expect(guessUnit('ПОЛЮС')).toEqual({ baseUnit: 'dona', factor: '1', unitLabel: 'dona' })
    expect(guessUnit('МАШ.ЧАС')).toBeNull()
    expect(guessUnit('МАШ/ЧАС')).toBeNull()
  })
})

describe('guessUnit — kasr ko\'paytuvchi so\'raladi', () => {
  it.each(['0.5 Т', '1.5М', '0,1т', '2,5 М3', '1.0ШТ'])('%j → null', (input) => {
    expect(guessUnit(input)).toBeNull()
  })

  it('qisqartma nuqtalari va butun ko\'paytuvchi ishlaydi', () => {
    expect(guessUnit('т.')).toEqual({ baseUnit: 't', factor: '1', unitLabel: 't' })
    expect(guessUnit('100ШТ')).toEqual({ baseUnit: 'dona', factor: '100', unitLabel: '100 dona' })
    expect(guessUnit('1000 шт.')).toEqual({ baseUnit: 'dona', factor: '1000', unitLabel: '1000 dona' })
    expect(guessUnit('10 м.')).toEqual({ baseUnit: 'm', factor: '10', unitLabel: '10 m' })
  })
})

describe('isIdentifierCode', () => {
  it.each(['045050', '000001', 'С124-9221', 'ОВК8', 'Т-ДС-04', 'КRJ-45', 'E1-1-8-8', '1602-30061-1'])('%j — identifikator', (c) => {
    expect(isIdentifierCode(c)).toBe(true)
  })

  it.each([
    '',
    'ПРАЙС',
    'прайс-2024',
    'ПРЕЙСКУРАНТ 12',
    'счёт №15',
    'СЧЕТ 15',
    'ТЦ 2023',
    'Цена поставщика 1',
    'ЦЕНЫ-7',
    'Договорная 1',
    'Калькуляция 3',
    'МОДЕМ',
    'А12',
    '1 2 ',
  ])('%j — identifikator emas', (c) => {
    expect(isIdentifierCode(c)).toBe(false)
  })
})
