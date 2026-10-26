import { describe, expect, it } from 'vitest'
import { receiptVerified } from './receiptVerified'

const base = {
  lookupTotal: '250000',
  lookupItems: [{ sum: '250000' }],
  lookupReceiptAt: '2026-10-26T09:00:00+05:00',
  totalAmount: '250000',
  purchasedAt: '2026-10-26T10:00:00+05:00',
}

describe('receiptVerified (server qoidasi bilan bir xil)', () => {
  it('jami mos va sana ±3 kun ichida — tasdiqlangan', () => {
    expect(receiptVerified(base)).toBe(true)
    expect(receiptVerified({ ...base, totalAmount: '250001' })).toBe(true)
  })
  it('jami 1 so‘mdan ko‘p farq — faqat biror qator mos kelsa', () => {
    expect(receiptVerified({ ...base, totalAmount: '250002' })).toBe(false)
    expect(receiptVerified({ ...base, lookupTotal: '400000', lookupItems: [{ sum: '150000' }, { sum: '250000' }] })).toBe(true)
  })
  it('jami noma’lum (null) — hech qachon tasdiqlanmaydi', () => {
    expect(receiptVerified({ ...base, lookupTotal: null })).toBe(false)
    expect(receiptVerified({ ...base, totalAmount: null })).toBe(false)
  })
  it('sana: aynan 3 kun — kiradi, undan ko‘p yoki noma’lum — yo‘q', () => {
    expect(receiptVerified({ ...base, lookupReceiptAt: '2026-10-23T10:00:00+05:00' })).toBe(true)
    expect(receiptVerified({ ...base, lookupReceiptAt: '2026-10-23T09:59:00+05:00' })).toBe(false)
    expect(receiptVerified({ ...base, lookupReceiptAt: '2026-10-29T10:00:00+05:00' })).toBe(true)
    expect(receiptVerified({ ...base, lookupReceiptAt: null })).toBe(false)
  })
})
