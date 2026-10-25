import { describe, expect, it } from 'vitest'
import { cashBalance, formatSumInput, parseSumInput } from './cash'

describe('cashBalance', () => {
  it('bo\'sh ro\'yxatlar → 0', () => {
    expect(cashBalance([], [])).toBe('0')
  })
  it('berilgan − sarflangan, float xatosiz', () => {
    expect(cashBalance(['1000000', '500000.50'], ['250000.25', '0.25'])).toBe('1250000')
    expect(cashBalance(['0.1', '0.2'], [])).toBe('0.3')
  })
  it('manfiy qoldiq (ko\'proq sarflangan)', () => {
    expect(cashBalance(['100'], ['150.5'])).toBe('-50.5')
  })
  it('katta sonlar', () => {
    expect(cashBalance(['9999999999999999.99', '9999999999999999.99'], ['0.01'])).toBe('19999999999999999.97')
  })
})

describe('parseSumInput', () => {
  it.each([
    ['1 250 000', '1250000'],
    ['1 250 000', '1250000'],
    ['1 250', '1250'],
    ['1 250 000,50', '1250000.5'],
    ['99.5', '99.5'],
    ['0', '0'],
    ['0,00', '0'],
    ['  42  ', '42'],
    ['.5', '0.5'],
    ['5.', '5'],
    ['007', '7'],
    ['9999999999999999.99', '9999999999999999.99'],
  ])('%j → %s', (input, expected) => {
    expect(parseSumInput(input)).toBe(expected)
  })

  it.each([
    [''],
    ['   '],
    ['.'],
    ['-5'],
    ['-0'],
    ['+5'],
    ['1.505'],
    ['1.500'],
    ['1,2,3'],
    ['1.2.3'],
    ['1e5'],
    ['abc'],
    ['12 so\'m'],
    ['10000000000000000'],
    ['10000000000000000.5'],
  ])('%j → null', (input) => {
    expect(parseSumInput(input)).toBeNull()
  })

  it('64 belgidan uzun → null, aynan 64 — qabul', () => {
    const ok = ' '.repeat(60) + '1234'
    expect(ok.length).toBe(64)
    expect(parseSumInput(ok)).toBe('1234')
    expect(parseSumInput(' ' + ok)).toBeNull()
  })
})

describe('formatSumInput', () => {
  it.each([
    ['', ''],
    ['0', '0'],
    ['1', '1'],
    ['1234', '1 234'],
    ['1250000', '1 250 000'],
    ['1 250 000', '1 250 000'],
    ['12345,5', '12 345,5'],
    ['12345.50', '12 345.50'],
    ['1234,', '1 234,'],
    [',5', ',5'],
    ['007', '7'],
    ['000', '0'],
    ['0,05', '0,05'],
    ['1.2.3', '1.23'],
    ['-12a34', '1 234'],
    ['1 234 567', '1 234 567'],
    ['1,555', '1,555'],
  ])('%j → %j', (input, expected) => {
    expect(formatSumInput(input)).toBe(expected)
  })

  it('idempotent va raqamlar ketma-ketligi saqlanadi', () => {
    for (const s of ['1234567,89', '00012', '9 9 9 9', '1,2,3', 'a1b2c3d4', '1000000000000']) {
      const once = formatSumInput(s)
      expect(formatSumInput(once)).toBe(once)
    }
  })

  it('formatlangan natija parseSumInput bilan o\'qiladi', () => {
    expect(parseSumInput(formatSumInput('1250000,5'))).toBe('1250000.5')
  })
})
