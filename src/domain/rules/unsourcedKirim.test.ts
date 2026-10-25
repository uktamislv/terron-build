import { describe, expect, it } from 'vitest'
import {
  candidatesCoverGap,
  isPurchaseCandidate,
  isUnsourcedKirim,
  kirimSourceReason,
  type CandidateKirim,
  type UnsourcedKirimInput,
} from './unsourcedKirim'

const AT = '2026-10-26T12:00:00+05:00'
const base: UnsourcedKirimInput = {
  type: 'kirim',
  purchaseId: null,
  occurredAt: AT,
  openPurchaseDates: [],
  sourceDates: ['2026-10-25T12:00:00+05:00'],
}

describe('kirimSourceReason / isUnsourcedKirim', () => {
  it('yaqinda manba bor, ochiq xarid yo\'q → null', () => {
    expect(kirimSourceReason(base)).toBeNull()
    expect(isUnsourcedKirim(base)).toBe(false)
  })
  it('hech qanday manba yo\'q → no_source', () => {
    expect(kirimSourceReason({ ...base, sourceDates: [] })).toBe('no_source')
    expect(isUnsourcedKirim({ ...base, sourceDates: [] })).toBe(true)
  })
  it('ochiq xarid manbadan ustun → open_purchase', () => {
    expect(kirimSourceReason({ ...base, openPurchaseDates: ['2026-10-25T12:00:00+05:00'] })).toBe('open_purchase')
  })
  it('parity: ochiq xarid oynasi [occ − 14 kun, occ + 1 kun], chegaralar kiradi', () => {
    const r = (d: string): string | null => kirimSourceReason({ ...base, openPurchaseDates: [d] })
    expect(r('2026-10-12T12:00:00+05:00')).toBe('open_purchase') // aynan −14 kun
    expect(r('2026-10-12T11:59:59+05:00')).toBeNull() // −14 kun − 1 s → oynadan tashqari
    expect(r('2026-10-27T12:00:00+05:00')).toBe('open_purchase') // aynan +1 kun
    expect(r('2026-10-27T12:00:01+05:00')).toBeNull() // +1 kun + 1 s
  })
  it('parity: manba oynasi [occ − 7 kun, occ], chegaralar kiradi', () => {
    const r = (d: string): string | null => kirimSourceReason({ ...base, sourceDates: [d] })
    expect(r('2026-10-19T12:00:00+05:00')).toBeNull() // aynan −7 kun — manba
    expect(r('2026-10-19T11:59:59+05:00')).toBe('no_source')
    expect(r(AT)).toBeNull() // aynan occurred_at — manba
  })
  it('parity: occurred_at dan KEYINGI manba hisobga olinmaydi', () => {
    expect(kirimSourceReason({ ...base, sourceDates: ['2026-10-26T12:00:01+05:00'] })).toBe('no_source')
    expect(kirimSourceReason({ ...base, sourceDates: ['2026-10-27T12:00:00+05:00'] })).toBe('no_source')
  })
  it('bir nechta sana — biri oynada bo\'lsa yetarli; vaqt zonalari aralash', () => {
    expect(kirimSourceReason({ ...base, sourceDates: ['2026-09-01T00:00:00Z', '2026-10-26T06:00:00Z'] })).toBeNull()
  })
  it('noto\'g\'ri sanalar e\'tiborsiz', () => {
    expect(kirimSourceReason({ ...base, openPurchaseDates: ['x'], sourceDates: ['y'] })).toBe('no_source')
  })
  it('noto\'g\'ri occurredAt → xato', () => {
    expect(() => kirimSourceReason({ ...base, occurredAt: 'x' })).toThrow()
  })
  it('purchase_id bor → null (ochiq xarid bo\'lsa ham)', () => {
    expect(kirimSourceReason({ ...base, purchaseId: 'p', openPurchaseDates: [AT], sourceDates: [] })).toBeNull()
  })
  it.each(['chiqim', 'transfer_in', 'transfer_out', 'inventory_adjust'] as const)('%s → null', (type) => {
    expect(kirimSourceReason({ ...base, type, openPurchaseDates: [AT], sourceDates: [] })).toBeNull()
  })
})

describe('isPurchaseCandidate', () => {
  const purchase = { objectId: 'o', materialId: 'm', purchasedAt: '2026-10-20T10:00:00Z' }
  const k: CandidateKirim = { objectId: 'o', materialId: 'm', purchaseId: null, transferId: null, type: 'kirim', occurredAt: '2026-10-21T10:00:00Z' }
  it('oyna ichida → true', () => {
    expect(isPurchaseCandidate(k, purchase)).toBe(true)
  })
  it('chegaralar: aynan xarid vaqti va aynan 72 soat — kiradi', () => {
    expect(isPurchaseCandidate({ ...k, occurredAt: '2026-10-20T10:00:00Z' }, purchase)).toBe(true)
    expect(isPurchaseCandidate({ ...k, occurredAt: '2026-10-23T10:00:00Z' }, purchase)).toBe(true)
    expect(isPurchaseCandidate({ ...k, occurredAt: '2026-10-23T10:00:01Z' }, purchase)).toBe(false)
    expect(isPurchaseCandidate({ ...k, occurredAt: '2026-10-20T09:59:59Z' }, purchase)).toBe(false)
  })
  it.each([
    ['boshqa obyekt', { objectId: 'x' }],
    ['boshqa material', { materialId: 'x' }],
    ['bog\'langan', { purchaseId: 'p' }],
    ['o\'tkazma', { transferId: 't' }],
    ['chiqim', { type: 'chiqim' }],
    ['noto\'g\'ri vaqt', { occurredAt: 'x' }],
  ])('%s → false', (_n, over) => {
    expect(isPurchaseCandidate({ ...k, ...(over as Partial<CandidateKirim>) }, purchase)).toBe(false)
  })
  it('oyna parametr', () => {
    expect(isPurchaseCandidate(k, purchase, 12)).toBe(false)
  })
})

describe('candidatesCoverGap', () => {
  it('bog\'langan 0, nomzodlar to\'liq yopadi → true', () => {
    expect(candidatesCoverGap('100', '0', ['60', '40'], '2')).toBe(true)
  })
  it('chegaraga aynan teng (2 %) → true; ko\'proq → false', () => {
    expect(candidatesCoverGap('100', '50', ['48'], '2')).toBe(true)
    expect(candidatesCoverGap('100', '50', ['47.99'], '2')).toBe(false)
  })
  it('nomzod yo\'q → faqat bog\'langan bilan', () => {
    expect(candidatesCoverGap('100', '100', [], '0')).toBe(true)
    expect(candidatesCoverGap('100', '0', [], '5')).toBe(false)
  })
  it('ortiqcha qabul ham chegaradan oshsa → false', () => {
    expect(candidatesCoverGap('100', '0', ['110'], '5')).toBe(false)
  })
  it('xarid 0 → xato (qoida 1 bilan bir xil)', () => {
    expect(() => candidatesCoverGap('0', '0', [], '5')).toThrow()
  })
})
