import { describe, expect, it } from 'vitest'
import { decToExcelNumber, isoToExcelDate, safeCell } from './excel'
import { isoToDayNumber } from './period'

describe('safeCell', () => {
  it.each(['=SUM(A1)', '+998901234567', '-5', '@cmd', '\tx', '\rx'])('xavfli boshlanish: %j', (v) => {
    expect(safeCell(v)).toBe(`'${v}`)
  })
  it('oddiy matn, bo\'sh satr, kirill — o\'zgarmaydi', () => {
    expect(safeCell('Sement M500')).toBe('Sement M500')
    expect(safeCell('')).toBe('')
    expect(safeCell('Цемент М500')).toBe('Цемент М500')
    expect(safeCell("g'isht = 250")).toBe("g'isht = 250")
    expect(safeCell(' =1')).toBe(' =1')
  })
})

describe('decToExcelNumber', () => {
  it('oddiy qiymatlar → son', () => {
    expect(decToExcelNumber('0.1')).toBe(0.1)
    expect(decToExcelNumber('1234567.89')).toBe(1234567.89)
    expect(decToExcelNumber('-5')).toBe(-5)
    expect(decToExcelNumber('0.000001')).toBe(0.000001)
    expect(decToExcelNumber('0')).toBe(0)
    expect(decToExcelNumber('0.0000001')).toBe(1e-7)
  })
  it('aynan 15 qiymatli raqam → son, 16+ → matn', () => {
    expect(decToExcelNumber('123456789012345')).toBe(123456789012345)
    expect(decToExcelNumber('1234567890123.45')).toBe(1234567890123.45)
    expect(decToExcelNumber('1234567890123456')).toBe('1234567890123456')
    expect(decToExcelNumber('12345678901234567')).toBe('12345678901234567')
    expect(decToExcelNumber('-9999999999999999.99')).toBe('-9999999999999999.99')
  })
  it('oldingi nollar hisobga olinmaydi', () => {
    expect(decToExcelNumber('0.000123456789012345')).toBe(0.000123456789012345)
  })
  it('kanonik bo\'lmagan kirish normallashtiriladi, noto\'g\'ri → xato', () => {
    expect(decToExcelNumber('1.50')).toBe(1.5)
    expect(() => decToExcelNumber('abc')).toThrow()
  })
})

describe('isoToExcelDate', () => {
  it('konstantalar to\'g\'ri', () => {
    expect(isoToDayNumber('1899-12-31')).toBe(-25568)
    expect(isoToDayNumber('1900-03-01')).toBe(-25508)
  })
  it('ma\'lum seriya raqamlari', () => {
    expect(isoToExcelDate('2026-01-01')).toBe(46023)
    expect(isoToExcelDate('2025-01-01')).toBe(45658)
    expect(isoToExcelDate('1900-01-01')).toBe(1)
    expect(isoToExcelDate('1900-02-28')).toBe(59)
    expect(isoToExcelDate('1900-03-01')).toBe(61)
    expect(isoToExcelDate('2024-02-29')).toBe(45351)
  })
  it('vaqt qismi tashlanadi', () => {
    expect(isoToExcelDate('2026-01-01T23:59:59+05:00')).toBe(46023)
  })
  it('noto\'g\'ri sana → xato', () => {
    expect(() => isoToExcelDate('2026-02-30')).toThrow()
    expect(() => isoToExcelDate('1899-12-31')).toThrow()
    expect(() => isoToExcelDate('')).toThrow()
  })
})
