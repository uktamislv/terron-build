import { describe, expect, it } from 'vitest'
import { allowedQty, evaluateNorm, evaluateRequest, usagePct } from './norms'

const norm = (normQtyBase: string, wastePct: string, consumedQtyBase: string) =>
  evaluateNorm({ normQtyBase, wastePct, consumedQtyBase })
const req = (
  requestedQtyBase: string,
  allowedQtyBase: string,
  consumedQtyBase: string,
  otherOpenQtyBase = '0',
  deliveredQtyBase = '0',
) => evaluateRequest({ requestedQtyBase, allowedQtyBase, consumedQtyBase, deliveredQtyBase, otherOpenQtyBase })

describe('allowedQty', () => {
  it("waste 0 → norma o'zi", () => {
    expect(allowedQty('100', '0')).toBe('100')
    expect(allowedQty('0.000001', '0')).toBe('0.000001')
  })
  it('isrof bilan', () => {
    expect(allowedQty('100', '5')).toBe('105')
    expect(allowedQty('1000', '2.5')).toBe('1025')
    expect(allowedQty('3.333333', '7.25')).toBe('3.575')
  })
  it('6 xonaga yaxlitlash (half away from zero)', () => {
    // 0.000001 × 1.5 = 0.0000015 → 0.000002
    expect(allowedQty('0.000001', '50')).toBe('0.000002')
    // 0.000001 × 1.01 = 0.00000101 → 0.000001
    expect(allowedQty('0.000001', '1')).toBe('0.000001')
  })
  it('norma 0 → 0', () => {
    expect(allowedQty('0', '10')).toBe('0')
  })
  it('katta sonlar', () => {
    // 99999999999999.999999 × 100.9999 = 10099989999999999.9998990001
    expect(allowedQty('99999999999999.999999', '9999.99')).toBe('10099989999999999.999899')
    expect(allowedQty('10000000000000', '100')).toBe('20000000000000')
  })
})

describe('evaluateNorm', () => {
  it('sarf 0 → ok', () => {
    expect(norm('100', '5', '0')).toEqual({ status: 'ok', allowed: '105', overPct: null, severity: null })
  })
  it('aynan allowed → ok', () => {
    expect(norm('100', '5', '105')).toEqual({ status: 'ok', allowed: '105', overPct: null, severity: null })
  })
  it("allowed dan bir oz ko'p → over, ogohlantirish", () => {
    expect(norm('100', '5', '105.000001')).toEqual({ status: 'over', allowed: '105', overPct: '0', severity: 'ogohlantirish' })
    expect(norm('100', '0', '110')).toEqual({ status: 'over', allowed: '100', overPct: '10', severity: 'ogohlantirish' })
  })
  it('aynan 25 % → jiddiy', () => {
    expect(norm('100', '0', '125')).toEqual({ status: 'over', allowed: '100', overPct: '25', severity: 'jiddiy' })
  })
  it('24.99 % → ogohlantirish; 24.995 → 25 → jiddiy', () => {
    expect(norm('100', '0', '124.99')).toMatchObject({ overPct: '24.99', severity: 'ogohlantirish' })
    expect(norm('100', '0', '124.995')).toMatchObject({ overPct: '25', severity: 'jiddiy' })
  })
  it('isrof bilan over_pct', () => {
    // allowed 105, consumed 131.25 → 26.25 / 105 × 100 = 25 %
    expect(norm('100', '5', '131.25')).toMatchObject({ status: 'over', overPct: '25', severity: 'jiddiy' })
    expect(norm('3', '0', '4')).toMatchObject({ overPct: '33.33', severity: 'jiddiy' })
  })
  it("smetada yo'q (norm 0) + sarf → not_in_estimate", () => {
    expect(norm('0', '5', '10')).toEqual({ status: 'not_in_estimate', allowed: '0', overPct: null, severity: 'ogohlantirish' })
    expect(norm('0', '0', '0.000001')).toMatchObject({ status: 'not_in_estimate' })
  })
  it('norm 0 + sarf 0 → ok', () => {
    expect(norm('0', '5', '0')).toEqual({ status: 'ok', allowed: '0', overPct: null, severity: null })
  })
  it('katta sonlar', () => {
    expect(norm('10000000000000', '0', '99999999999999.999999')).toMatchObject({ status: 'over', overPct: '900', severity: 'jiddiy' })
    expect(norm('0.000001', '0', '99999999999999.999999')).toMatchObject({ status: 'over', overPct: '9999999999999999999800' })
  })
})

describe('evaluateRequest', () => {
  it('yetarli → over false', () => {
    expect(req('50', '100', '30', '10')).toEqual({ over: false, available: '60', overQty: '0' })
  })
  it('aynan available → over false', () => {
    expect(req('60', '100', '30', '10')).toEqual({ over: false, available: '60', overQty: '0' })
  })
  it('ortiq → over, overQty', () => {
    expect(req('60.000001', '100', '30', '10')).toEqual({ over: true, available: '60', overQty: '0.000001' })
    expect(req('80', '100', '30', '10')).toEqual({ over: true, available: '60', overQty: '20' })
  })
  it('manfiy available', () => {
    expect(req('5', '100', '120', '0')).toEqual({ over: true, available: '-20', overQty: '25' })
    expect(req('0', '10', '10', '5')).toEqual({ over: true, available: '-5', overQty: '5' })
  })
  it("smetada yo'q (allowed 0)", () => {
    expect(req('1', '0', '0', '0')).toEqual({ over: true, available: '0', overQty: '1' })
  })
  it("nol so'rov, nol available → over false", () => {
    expect(req('0', '10', '10')).toEqual({ over: false, available: '0', overQty: '0' })
  })
  it('delivered > consumed → delivered ayiriladi (xarid qilindi, chiqim yozilmagan)', () => {
    expect(req('50', '100', '30', '10', '70')).toEqual({ over: true, available: '20', overQty: '30' })
    expect(req('20', '100', '30', '10', '70')).toEqual({ over: false, available: '20', overQty: '0' })
    expect(req('1', '100', '0', '0', '100')).toEqual({ over: true, available: '0', overQty: '1' })
  })
  it('delivered < consumed → consumed ayiriladi', () => {
    expect(req('60', '100', '30', '10', '25')).toEqual({ over: false, available: '60', overQty: '0' })
    expect(req('60', '100', '30', '10', '-5')).toEqual({ over: false, available: '60', overQty: '0' })
  })
  it('delivered = consumed', () => {
    expect(req('60.000001', '100', '30', '10', '30')).toEqual({ over: true, available: '60', overQty: '0.000001' })
  })
  it('katta sonlar', () => {
    expect(req('99999999999999.999999', '99999999999999.999999', '0.000001', '0')).toEqual({
      over: true,
      available: '99999999999999.999998',
      overQty: '0.000001',
    })
  })
})

describe('usagePct', () => {
  it('allowed 0 → null', () => {
    expect(usagePct('10', '0')).toBeNull()
    expect(usagePct('0', '0')).toBeNull()
  })
  it('1 xona', () => {
    expect(usagePct('0', '100')).toBe('0')
    expect(usagePct('50', '100')).toBe('50')
    expect(usagePct('1', '3')).toBe('33.3')
    expect(usagePct('2', '3')).toBe('66.7')
    expect(usagePct('125', '100')).toBe('125')
  })
  it('chegara: 0.05 → 0.1', () => {
    expect(usagePct('0.05', '100')).toBe('0.1')
  })
})
