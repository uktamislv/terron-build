import { describe, expect, it } from 'vitest'
import { autoMapColumns, validateMapping } from './mapping'
import { CSV_STYLE } from './__fixtures__/csvStyle'
import { GRAND_SMETA, GRAND_SMETA_HEADER_ROW } from './__fixtures__/grandSmeta'
import { UZ_SIMPLE } from './__fixtures__/uzSimple'

describe('autoMapColumns', () => {
  it('grand-smeta (rus): стоимость единицы → price, общая стоимость → sum, обоснование → code', () => {
    expect(autoMapColumns(GRAND_SMETA[GRAND_SMETA_HEADER_ROW] ?? [])).toEqual({
      code: 1,
      name: 2,
      unit: 3,
      qty: 4,
      price: 6,
      sum: 7,
    })
  })

  it('o\'zbekcha', () => {
    expect(autoMapColumns(UZ_SIMPLE[0] ?? [])).toEqual({ name: 1, unit: 2, qty: 3, price: 4, sum: 5, type: 6 })
  })

  it('CSV uslubi, boshqa tartib', () => {
    expect(autoMapColumns(CSV_STYLE[3] ?? [])).toEqual({ code: 0, name: 1, qty: 2, unit: 3, price: 4 })
  })

  it('apostrof variantlari va qisman moslik', () => {
    expect(autoMapColumns(['Nomi', 'Oʻlchov', 'Miqdor (hajm)'])).toEqual({ name: 0, unit: 1, qty: 2 })
    expect(autoMapColumns(['Наименование', 'Ед.изм', 'Общее кол-во'])).toEqual({ name: 0, unit: 1, qty: 2 })
  })

  it('bir ustun faqat bitta maydonga', () => {
    const m = autoMapColumns(['Стоимость', 'Наименование'])
    expect(m).toEqual({ sum: 0, name: 1 })
    expect(m.price).toBeUndefined()
  })

  it('ziddiyat: aniqroq moslik ustun', () => {
    // ikkita "наименование": to'liq teng — ustun
    expect(autoMapColumns(['Наименование материалов (по прайсу)', 'Наименование']).name).toBe(1)
    // "Birlik narxi" — price, "Birlik" — unit
    expect(autoMapColumns(['Nomi', 'Birlik narxi', 'Birlik', 'Soni'])).toEqual({ name: 0, price: 1, unit: 2, qty: 3 })
  })

  it('qisqa kalit so\'zlar ichidan mos kelmaydi; raqam va bo\'sh kataklar e\'tiborsiz', () => {
    expect(autoMapColumns(['Индивидуальный', 'Единичная расценка', null, 5, ''])).toEqual({})
    expect(autoMapColumns([])).toEqual({})
  })
})

describe('validateMapping', () => {
  it('yetishmayotganlar tartib bilan', () => {
    expect(validateMapping({})).toEqual(['name', 'unit', 'qty'])
    expect(validateMapping({ name: 0, qty: 2 })).toEqual(['unit'])
    expect(validateMapping({ name: 0, unit: 1, qty: 2 })).toEqual([])
    expect(validateMapping({ name: -1, unit: 1.5, qty: 0 })).toEqual(['name', 'unit'])
  })
})
