import { describe, expect, it } from 'vitest'
import { negativeStockAfter } from './negativeStock'

describe('negativeStockAfter', () => {
  it('qoldiqdan ko\'p chiqim → manfiy qoldiq', () => {
    expect(negativeStockAfter('10', '12.5')).toBe('-2.5')
  })
  it('aynan nolga tushsa → null', () => {
    expect(negativeStockAfter('10', '10.000')).toBeNull()
  })
  it('kam chiqim → null', () => {
    expect(negativeStockAfter('10', '0.000001')).toBeNull()
  })
  it('qoldiq allaqachon manfiy → yanada manfiy', () => {
    expect(negativeStockAfter('-3', '1')).toBe('-4')
  })
  it('0 qoldiq, 0 chiqim → null', () => {
    expect(negativeStockAfter('0', '0')).toBeNull()
  })
  it('juda katta sonlar float xatosiz', () => {
    expect(negativeStockAfter('99999999999999.999999', '100000000000000')).toBe('-0.000001')
  })
})
