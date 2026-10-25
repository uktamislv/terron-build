import { describe, expect, it } from 'vitest'
import { requestOverbuy } from './requestOverbuy'

describe('requestOverbuy', () => {
  it('aynan +20 % → false', () => {
    expect(requestOverbuy('100', '120', '20')).toBe(false)
  })
  it('+20 % dan biroz ko\'p → true', () => {
    expect(requestOverbuy('100', '120.000001', '20')).toBe(true)
  })
  it('kam yoki teng → false', () => {
    expect(requestOverbuy('100', '100', '20')).toBe(false)
    expect(requestOverbuy('100', '50', '20')).toBe(false)
  })
  it('pct = 0 → har qanday ortiqcha true', () => {
    expect(requestOverbuy('100', '100', '0')).toBe(false)
    expect(requestOverbuy('100', '100.000001', '0')).toBe(true)
  })
  it('kasr foiz', () => {
    expect(requestOverbuy('3', '3.6', '20')).toBe(false)
    expect(requestOverbuy('3', '3.316', '10.5')).toBe(true)
    expect(requestOverbuy('3', '3.31', '10.5')).toBe(false)
    expect(requestOverbuy('3', '3.315', '10.5')).toBe(false)
  })
  it('so\'rov 0 yoki manfiy, pct manfiy → false', () => {
    expect(requestOverbuy('0', '5', '20')).toBe(false)
    expect(requestOverbuy('-1', '5', '20')).toBe(false)
    expect(requestOverbuy('100', '500', '-1')).toBe(false)
  })
  it('juda katta sonlar', () => {
    expect(requestOverbuy('10000000000000', '12000000000000', '20')).toBe(false)
    expect(requestOverbuy('10000000000000', '12000000000000.000001', '20')).toBe(true)
  })
})
