import { describe, expect, it } from 'vitest'
import { detectHeaderRow, headerSignature, isColumnNumberingRow } from './header'
import { RESOURCE_LRV } from './__fixtures__/resourceLrv'
import { CSV_STYLE } from './__fixtures__/csvStyle'
import { GRAND_SMETA, GRAND_SMETA_HEADER_ROW } from './__fixtures__/grandSmeta'
import { UZ_SIMPLE } from './__fixtures__/uzSimple'
import type { Cell } from './types'

describe('detectHeaderRow', () => {
  it('fixture\'lar', () => {
    expect(detectHeaderRow(GRAND_SMETA)).toBe(GRAND_SMETA_HEADER_ROW)
    expect(detectHeaderRow(UZ_SIMPLE)).toBe(0)
    expect(detectHeaderRow(CSV_STYLE)).toBe(3)
  })

  it('3 qator yuqoridagi matn ostida', () => {
    const rows: Cell[][] = [['Smeta'], ['Obyekt: Chilonzor'], [null], ['Nomi', 'Birlik', 'Miqdori'], ['Qum', 'm3', 5]]
    expect(detectHeaderRow(rows)).toBe(3)
  })

  it('name + (qty yoki unit) shart', () => {
    expect(detectHeaderRow([['Nomi', 'Narxi']])).toBeNull()
    expect(detectHeaderRow([['Miqdori', 'Birlik']])).toBeNull()
    expect(detectHeaderRow([['Nomi', 'Birlik']])).toBe(0)
  })

  it('eng ko\'p maydon; teng bo\'lsa yuqoridagisi', () => {
    const rows: Cell[][] = [['Nomi', 'Birlik'], ['Nomi', 'Birlik', 'Miqdori', 'Narxi'], ['Nomi', 'Birlik', 'Soni', 'Narx']]
    expect(detectHeaderRow(rows)).toBe(1)
  })

  it('maxScan va bo\'sh ro\'yxat', () => {
    const rows: Cell[][] = [[], [], ['Nomi', 'Birlik', 'Miqdori']]
    expect(detectHeaderRow(rows, 2)).toBeNull()
    expect(detectHeaderRow(rows, 3)).toBe(2)
    expect(detectHeaderRow(rows, 0)).toBeNull()
    expect(detectHeaderRow([])).toBeNull()
  })
})

describe('headerSignature', () => {
  it('normallashtirish va | bilan', () => {
    expect(headerSignature(['  Наименование ', 'Ед.  изм.', null, 'Кол-во', null, ''])).toBe(
      'наименование|ед. изм.||кол-во',
    )
  })

  it('bir xil sarlavha — bir xil imzo (registr, bo\'sh joy, ё)', () => {
    expect(headerSignature(['Объём', 'Цена'])).toBe(headerSignature(['ОБЪЕМ ', ' цена']))
  })

  it('raqam, siyrak massiv, bo\'sh', () => {
    const sparse: Cell[] = ['A']
    sparse[2] = 'B'
    expect(headerSignature(sparse)).toBe('a||b')
    expect(headerSignature([1, 2.5, true])).toBe('1|2.5|true')
    expect(headerSignature([])).toBe('')
    expect(headerSignature([null, ''])).toBe('')
  })
})


describe('isColumnNumberingRow va resurs smetasi sarlavhasi', () => {
  it('ustun raqamlari (+ qisqa birliklar) — sarlavha emas', () => {
    expect(isColumnNumberingRow([1, 2, 3, 4, 5, 6, 7, 8, 'ЧЕЛ-Ч', 'ЧЕЛ-Ч'])).toBe(true)
    expect(isColumnNumberingRow(['1', '2', '3', null, ''])).toBe(true)
    expect(isColumnNumberingRow([1, 2])).toBe(false)
    expect(isColumnNumberingRow([1, 3, 4])).toBe(false)
    expect(isColumnNumberingRow([1, 2, 3, 'Наименование работ'])).toBe(false)
    expect(isColumnNumberingRow([])).toBe(false)
  })

  it('LRV: sarlavha 2-qator (ustun raqamlari va ost-sarlavha emas)', () => {
    expect(detectHeaderRow(RESOURCE_LRV)).toBe(1)
    // raqamlar qatori sarlavha matnlari bilan birga bo'lsa ham u o'tkaziladi
    const rows: Cell[][] = [[1, 2, 3, 'ЕД'], ['Nomi', 'Birlik', 'Miqdori']]
    expect(detectHeaderRow(rows)).toBe(1)
  })
})
