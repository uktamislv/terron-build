import { describe, expect, it } from 'vitest'
import { evaluateReceipt, receiptDiffPct } from './receiptMismatch'

const T0 = '2026-10-25T08:00:00.000Z'
const H23 = '2026-10-26T07:59:59.999Z'
const H24 = '2026-10-26T08:00:00.000Z'

function ev(purchased: string, received: string, threshold = '2', now = T0) {
  return evaluateReceipt({ purchasedQtyBase: purchased, receivedQtyBase: received, purchasedAt: T0, nowIso: now, thresholdPct: threshold })
}

describe('receiptDiffPct', () => {
  it('asosiy holatlar', () => {
    expect(receiptDiffPct('100', '100')).toBe('0')
    expect(receiptDiffPct('100', '102')).toBe('2')
    expect(receiptDiffPct('100', '98')).toBe('2')
    expect(receiptDiffPct('100', '0')).toBe('100')
    expect(receiptDiffPct('3', '1')).toBe('66.67')
    expect(receiptDiffPct('3', '2')).toBe('33.33')
  })
  it('yaxlitlash — half away from zero', () => {
    // 0.005 % → 0.01
    expect(receiptDiffPct('1000', '1000.05')).toBe('0.01')
    expect(receiptDiffPct('1000', '1000.04')).toBe('0')
  })
  it('purchased = 0 → xato', () => {
    expect(() => receiptDiffPct('0', '5')).toThrow()
  })
  it('katta sonlar', () => {
    expect(receiptDiffPct('99999999999999.999999', '0.000001')).toBe('100')
    expect(receiptDiffPct('0.000001', '99999999999999.999999')).toBe('9999999999999999999800')
  })
})

describe('evaluateReceipt', () => {
  it('teng → ok', () => {
    expect(ev('100', '100')).toEqual({ status: 'ok', diffPct: '0', severity: null })
  })
  it('aynan chegarada → ok (ortiqcha ham, kam ham)', () => {
    expect(ev('100', '102')).toEqual({ status: 'ok', diffPct: '2', severity: null })
    expect(ev('100', '98', '2', H24)).toEqual({ status: 'ok', diffPct: '2', severity: null })
  })
  it('chegaradan ozgina ko\'p ortiqcha → over, ogohlantirish', () => {
    expect(ev('100', '102.01')).toEqual({ status: 'over', diffPct: '2.01', severity: 'ogohlantirish' })
  })
  it('3× chegara aynan → jiddiy; ozgina kam → ogohlantirish', () => {
    expect(ev('100', '106')).toEqual({ status: 'over', diffPct: '6', severity: 'jiddiy' })
    expect(ev('100', '105.99')).toEqual({ status: 'over', diffPct: '5.99', severity: 'ogohlantirish' })
    expect(ev('100', '94', '2', H24)).toEqual({ status: 'under', diffPct: '6', severity: 'jiddiy' })
  })
  it('kam: 24 soat o\'tmagan → pending (severity null)', () => {
    expect(ev('100', '50', '2', T0)).toEqual({ status: 'pending', diffPct: '50', severity: null })
    expect(ev('100', '50', '2', H23)).toEqual({ status: 'pending', diffPct: '50', severity: null })
  })
  it('kam: aynan 24 soat → under', () => {
    expect(ev('100', '50', '2', H24)).toEqual({ status: 'under', diffPct: '50', severity: 'jiddiy' })
    expect(ev('100', '97', '2', H24)).toEqual({ status: 'under', diffPct: '3', severity: 'ogohlantirish' })
  })
  it('hech narsa qabul qilinmagan → under 100 %', () => {
    expect(ev('10', '0', '2', '2026-11-01T00:00:00Z')).toEqual({ status: 'under', diffPct: '100', severity: 'jiddiy' })
  })
  it('ortiqcha — 24 soat kutilmaydi', () => {
    expect(ev('100', '150', '2', T0).status).toBe('over')
  })
  it('vaqt zonasi ofsetli ISO satrlar', () => {
    const r = evaluateReceipt({
      purchasedQtyBase: '100', receivedQtyBase: '50', thresholdPct: '2',
      purchasedAt: '2026-10-25T13:00:00+05:00', nowIso: '2026-10-26T08:00:00Z',
    })
    expect(r.status).toBe('under')
  })
  it('chegara 0: 0.01 % dan kichik farq yaxlitlanib 0 → ok (bazadagi kabi)', () => {
    expect(ev('100', '100.000001', '0')).toEqual({ status: 'ok', diffPct: '0', severity: null })
  })
  it('chegara 0 va farq 0.01 % → over ogohlantirish (chegara 0 da jiddiy yo`q, bazadagi kabi)', () => {
    expect(ev('100', '100.01', '0')).toEqual({ status: 'over', diffPct: '0.01', severity: 'ogohlantirish' })
    expect(ev('100', '0', '0', H24)).toEqual({ status: 'under', diffPct: '100', severity: 'ogohlantirish' })
  })
  it('createdAt: orqa sanali xarid — kutish kiritilgan vaqtdan (max(purchasedAt, createdAt) + 24 soat)', () => {
    const base = { purchasedQtyBase: '100', receivedQtyBase: '50', thresholdPct: '2', purchasedAt: '2026-10-20T08:00:00Z' }
    expect(evaluateReceipt({ ...base, createdAt: T0, nowIso: H23 }).status).toBe('pending')
    expect(evaluateReceipt({ ...base, createdAt: T0, nowIso: H24 }).status).toBe('under')
    // createdAt berilmasa — avvalgidek xarid vaqtidan
    expect(evaluateReceipt({ ...base, nowIso: H23 }).status).toBe('under')
    // createdAt xarid vaqtidan oldin bo'lsa — xarid vaqti
    expect(evaluateReceipt({ ...base, purchasedAt: T0, createdAt: '2026-10-20T08:00:00Z', nowIso: H23 }).status).toBe('pending')
    expect(() => evaluateReceipt({ ...base, createdAt: 'kecha', nowIso: H24 })).toThrow()
  })
  it('kasrli chegara', () => {
    expect(ev('100', '102.5', '2.5')).toEqual({ status: 'ok', diffPct: '2.5', severity: null })
    expect(ev('100', '107.5', '2.5')).toEqual({ status: 'over', diffPct: '7.5', severity: 'jiddiy' })
  })
  it('purchased = 0 → xato; noto\'g\'ri vaqt → xato', () => {
    expect(() => ev('0', '1')).toThrow()
    expect(() => evaluateReceipt({ purchasedQtyBase: '10', receivedQtyBase: '1', purchasedAt: 'kecha', nowIso: T0, thresholdPct: '2' })).toThrow()
  })
})
