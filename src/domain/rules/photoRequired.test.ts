import { describe, expect, it } from 'vitest'
import { photoRequired, type PhotoRequiredInput } from './photoRequired'

const base: PhotoRequiredInput = { totalAmount: '1000000', thresholdAmount: '5000000', materialPhotoRequired: false, qrVerified: false }

describe('photoRequired', () => {
  it('chegaradan kam → null', () => {
    expect(photoRequired(base)).toBeNull()
  })
  it('aynan chegara → amount (chegara kiradi)', () => {
    expect(photoRequired({ ...base, totalAmount: '5000000.00' })).toBe('amount')
  })
  it('chegaradan 1 tiyin kam → null', () => {
    expect(photoRequired({ ...base, totalAmount: '4999999.99' })).toBeNull()
  })
  it('chegara o\'chiq (null) → null', () => {
    expect(photoRequired({ ...base, thresholdAmount: null, totalAmount: '999999999' })).toBeNull()
  })
  it('kirim (summa null) → faqat material belgisi', () => {
    expect(photoRequired({ ...base, totalAmount: null })).toBeNull()
    expect(photoRequired({ ...base, totalAmount: null, materialPhotoRequired: true })).toBe('material')
  })
  it('material belgisi summadan ustun', () => {
    expect(photoRequired({ ...base, totalAmount: '9000000', materialPhotoRequired: true })).toBe('material')
  })
  it('QR tasdiqlangan → har doim null', () => {
    expect(photoRequired({ ...base, totalAmount: '9000000', materialPhotoRequired: true, qrVerified: true })).toBeNull()
  })
  it('chegara 0 → har qanday summa (0 ham) majburiy', () => {
    expect(photoRequired({ ...base, thresholdAmount: '0', totalAmount: '0' })).toBe('amount')
  })
})
