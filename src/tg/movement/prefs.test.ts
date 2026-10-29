import { describe, expect, it } from 'vitest'
import { loadLastPurchaseObject, saveLastPurchaseObject } from '../purchase/prefs'
import { readMovementPrefill } from './prefill'
import { loadEntryType, loadLastObject, saveEntryType, saveLastObject } from './prefs'

describe('kirim/chiqim turi — faqat sessiya ichida', () => {
  it('standart "kirim"; sessiyada tanlangan "chiqim" eslab qolinadi, localStorage\'ga yozilmaydi', () => {
    window.localStorage.setItem('terron.movement.type', 'chiqim')
    expect(loadEntryType()).toBe('kirim')
    saveEntryType('chiqim')
    expect(loadEntryType()).toBe('chiqim')
    expect(window.localStorage.getItem('terron.movement.type')).toBeNull()
    window.sessionStorage.clear()
    expect(loadEntryType()).toBe('kirim')
  })
})

describe('oxirgi obyekt — xarid va kirim/chiqim alohida', () => {
  it('xarid obyekti kirim/chiqimnikini o\'zgartirmaydi (va aksincha)', () => {
    window.localStorage.clear()
    saveLastObject('o-site')
    saveLastPurchaseObject('o-other')
    expect(loadLastObject()).toBe('o-site')
    expect(loadLastPurchaseObject()).toBe('o-other')
  })
})

describe('readMovementPrefill', () => {
  it('kirim: qolgan miqdor va xarid; chiqimda — e\'tiborsiz; noto\'g\'ri miqdor — tashlanadi', () => {
    expect(
      readMovementPrefill({ movementPrefill: { type: 'kirim', objectId: 'o', materialId: 'm', qtyBase: '100.5', purchaseId: 'p' } }),
    ).toEqual({ type: 'kirim', objectId: 'o', materialId: 'm', qtyBase: '100.5', purchaseId: 'p' })
    expect(readMovementPrefill({ movementPrefill: { type: 'chiqim', objectId: 'o', materialId: 'm', qtyBase: '5', purchaseId: 'p' } })).toEqual({
      type: 'chiqim',
      objectId: 'o',
      materialId: 'm',
    })
    expect(readMovementPrefill({ movementPrefill: { type: 'kirim', objectId: 'o', materialId: 'm', qtyBase: '1e9' } })).toEqual({
      type: 'kirim',
      objectId: 'o',
      materialId: 'm',
    })
  })
})
