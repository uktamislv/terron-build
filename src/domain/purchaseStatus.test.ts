import { simpleReceiptStatus } from './purchaseStatus'

describe('simpleReceiptStatus — "Yozuvlarim" xarid holati', () => {
  it('0 — Kutilmoqda, qisman — Qisman, to‘liq yoki ortiq — Qabul qilindi', () => {
    expect(simpleReceiptStatus('500', '0')).toBe('pending')
    expect(simpleReceiptStatus('500', '250.5')).toBe('partial')
    expect(simpleReceiptStatus('500', '500')).toBe('received')
    expect(simpleReceiptStatus('500', '510')).toBe('received')
  })
  it('noma’lum (view ko‘rinmadi) — null', () => {
    expect(simpleReceiptStatus('500', null)).toBeNull()
    expect(simpleReceiptStatus('500', undefined)).toBeNull()
  })
})
