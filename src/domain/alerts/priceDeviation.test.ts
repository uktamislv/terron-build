import { describe, expect, it } from 'vitest'
import { cmp, mul, round } from '../decimal'
import { evaluatePrice, weightedAverage, type PricePoint } from './priceDeviation'

const pt = (totalAmount: string, qtyBase: string): PricePoint => ({ totalAmount, qtyBase })
/** Har biri 1 birlikdan, narx = total. */
const unitPts = (...prices: string[]) => prices.map((p) => pt(p, '1'))

const ev = (price: string, lastN: PricePoint[], last90: PricePoint[] = [], threshold = '8', lowPct?: string) =>
  evaluatePrice({ pricePerBase: price, lastN, last90, thresholdPct: threshold, lowPct })

describe('weightedAverage', () => {
  it('< 2 nuqta → null', () => {
    expect(weightedAverage([])).toBeNull()
    expect(weightedAverage([pt('100', '1')])).toBeNull()
  })
  it('sum(total) / sum(qty), 4 xona', () => {
    expect(weightedAverage(unitPts('100', '200'))).toBe('150')
    expect(weightedAverage([pt('4', '3'), pt('0.01', '0.000001')])).toBe('1.3367')
  })
  it('total = 0 (bepul) nuqtalar hisobga olinmaydi (bazadagi q.total_amount > 0)', () => {
    expect(weightedAverage([pt('0', '100'), pt('0', '100'), pt('10000', '100'), pt('10000', '100')])).toBe('100')
    // qolgan pullik nuqta 2 tadan kam → null
    expect(weightedAverage([pt('0', '100'), pt('10000', '100')])).toBeNull()
    expect(ev('100', [pt('0', '100'), pt('0', '100'), pt('10000', '100'), pt('10000', '100')])).toMatchObject({ direction: 'ok', avgN: '100' })
  })
  it('miqdor bo\'yicha og\'irlik: 1 dona qimmat + 200 qop arzon', () => {
    // 100 000 × 1 + 50 000 × 200 → 10 100 000 / 201
    const pts = [pt('100000', '1'), pt('10000000', '200')]
    expect(weightedAverage(pts)).toBe('50248.7562')
    // Oddiy o'rtacha 75 000 bo'lardi — 60 000 lik narx "arzon" ko'rinardi; og'irlikli bilan +19.41 % → high
    expect(ev('60000', pts)).toMatchObject({ direction: 'high', avgN: '50248.7562', diffN: '19.41' })
  })
  it('sum(qty) = 0 → null', () => {
    expect(weightedAverage([pt('1', '0'), pt('2', '0')])).toBeNull()
  })
  it('katta sonlar', () => {
    expect(weightedAverage([pt('9999999999999999.99', '0.000001'), pt('9999999999999999.99', '0.000001')])).toBe(
      '9999999999999999990000',
    )
  })
})

describe('evaluatePrice', () => {
  it('ikkala oyna < 2 nuqta → ok, hammasi null', () => {
    expect(ev('1000', unitPts('10'), unitPts('10'))).toEqual({ direction: 'ok', avgN: null, diffN: null, avg90: null, diff90: null })
  })
  it('aynan chegarada → ok; ozgina ko\'p → high', () => {
    expect(ev('108', unitPts('100', '100'))).toEqual({ direction: 'ok', avgN: '100', diffN: '8', avg90: null, diff90: null })
    expect(ev('108.01', unitPts('100', '100')).direction).toBe('high')
  })
  it('faqat 90 kunlik oyna og\'sa ham → high', () => {
    expect(ev('110', unitPts('108', '108'), unitPts('100', '100'))).toEqual({
      direction: 'high', avgN: '108', diffN: '1.85', avg90: '100', diff90: '10',
    })
  })
  it('bosqichma-bosqich +2.6 % × 20: oxirgi N o\'tkazib yuboradi, avg90 ushlaydi', () => {
    const prices: string[] = []
    let p = '100'
    for (let k = 0; k < 20; k++) {
      prices.push(p)
      p = round(mul(p, '1.026'), 2)
    }
    const all = unitPts(...prices)
    const r = ev(p, all.slice(-5), all)
    expect(cmp(r.diffN!, '8')).toBeLessThanOrEqual(0)
    expect(cmp(r.diff90!, '8')).toBeGreaterThan(0)
    expect(r.direction).toBe('high')
  })
  it('−60 % → low; aynan −50 % → low; −49.99 % → ok', () => {
    expect(ev('40', unitPts('100', '100'))).toMatchObject({ direction: 'low', diffN: '-60' })
    expect(ev('50', unitPts('100', '100'))).toMatchObject({ direction: 'low', diffN: '-50' })
    expect(ev('50.01', unitPts('100', '100'))).toMatchObject({ direction: 'ok', diffN: '-49.99' })
  })
  it('low faqat 90 kunlik oynada ham ishlaydi; lowPct parametr', () => {
    expect(ev('40', unitPts('45', '45'), unitPts('100', '100')).direction).toBe('low')
    expect(ev('80', unitPts('100', '100'), [], '8', '20')).toMatchObject({ direction: 'low', diffN: '-20' })
    expect(ev('80.01', unitPts('100', '100'), [], '8', '20').direction).toBe('ok')
  })
  it('high low dan ustun (biri yuqori, biri past)', () => {
    expect(ev('100', unitPts('300', '300'), unitPts('50', '50')).direction).toBe('high')
  })
  it('faqat 0 so`mlik xaridlar → o`rtacha yo`q (diff null)', () => {
    expect(ev('500', unitPts('0', '0'))).toEqual({ direction: 'ok', avgN: null, diffN: null, avg90: null, diff90: null })
  })
  it('narx 0 → −100 % → low', () => {
    expect(ev('0', unitPts('100', '100'))).toMatchObject({ direction: 'low', diffN: '-100' })
  })
  it('chegara 0: har qanday yuqori og\'ish → high, teng → ok', () => {
    expect(ev('100.01', unitPts('100', '100'), [], '0').direction).toBe('high')
    expect(ev('100', unitPts('100', '100'), [], '0').direction).toBe('ok')
  })
})
