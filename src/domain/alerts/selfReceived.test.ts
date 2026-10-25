import { describe, expect, it } from 'vitest'
import { isSelfReceived } from './selfReceived'

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'

describe('isSelfReceived', () => {
  it('bir xil odam → true', () => {
    expect(isSelfReceived(A, A)).toBe(true)
  })
  it('boshqa odam → false', () => {
    expect(isSelfReceived(A, B)).toBe(false)
  })
  it('kirim yo\'q (null) → false', () => {
    expect(isSelfReceived(A, null)).toBe(false)
  })
  it('bo\'sh satrlar ham aynan solishtiriladi', () => {
    expect(isSelfReceived('', null)).toBe(false)
    expect(isSelfReceived('', '')).toBe(true)
  })
})
