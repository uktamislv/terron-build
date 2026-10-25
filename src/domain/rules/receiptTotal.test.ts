import { describe, expect, it } from 'vitest'
import { receiptTotalMismatch } from './receiptTotal'

describe('receiptTotalMismatch', () => {
  it('teng → false', () => {
    expect(receiptTotalMismatch('1250000', '1250000.00')).toBe(false)
  })
  it('aynan 1 so\'m farq (ikki tomonga) → false', () => {
    expect(receiptTotalMismatch('1250001', '1250000')).toBe(false)
    expect(receiptTotalMismatch('1249999', '1250000')).toBe(false)
  })
  it('1.01 so\'m farq → true', () => {
    expect(receiptTotalMismatch('1250001.01', '1250000')).toBe(true)
    expect(receiptTotalMismatch('1249998.99', '1250000')).toBe(true)
  })
  it('chek summasi noma\'lum → false', () => {
    expect(receiptTotalMismatch(null, '5')).toBe(false)
  })
  it('nol summalar', () => {
    expect(receiptTotalMismatch('0', '0')).toBe(false)
    expect(receiptTotalMismatch('0', '2')).toBe(true)
  })
  it('juda katta summa float xatosiz', () => {
    expect(receiptTotalMismatch('9999999999999999.99', '9999999999999998.99')).toBe(false)
    expect(receiptTotalMismatch('9999999999999999.99', '9999999999999998.98')).toBe(true)
  })
})
