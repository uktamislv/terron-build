import { describe, expect, it } from 'vitest'
import {
  OCCURRED_AT_FUTURE_MS,
  OCCURRED_AT_PAST_MS,
  defaultObjectId,
  movementWarnings,
  occurredAtAllowed,
  rankMaterials,
  stockAfter,
  validateMovementDraft,
  type MovementDraft,
  type UsageStat,
} from './movements'

const NOW = '2026-10-25T10:00:00.000Z'
const NOW_MS = Date.parse(NOW)
const iso = (ms: number): string => new Date(ms).toISOString()
const DAY = 24 * 60 * 60 * 1000

describe('stockAfter', () => {
  it('kirim va transfer_in qo\'shadi', () => {
    expect(stockAfter('100', 'kirim', '50.5')).toBe('150.5')
    expect(stockAfter('0', 'transfer_in', '0.000001')).toBe('0.000001')
  })
  it('chiqim va transfer_out ayiradi', () => {
    expect(stockAfter('420', 'chiqim', '150')).toBe('270')
    expect(stockAfter('10', 'transfer_out', '10')).toBe('0')
    expect(stockAfter('10', 'chiqim', '12.5')).toBe('-2.5')
  })
  it('inventory_adjust ishorasi bilan qo\'shiladi', () => {
    expect(stockAfter('100', 'inventory_adjust', '-3.25')).toBe('96.75')
    expect(stockAfter('100', 'inventory_adjust', '4')).toBe('104')
  })
  it('manfiy boshlang\'ich qoldiq', () => {
    expect(stockAfter('-5', 'kirim', '3')).toBe('-2')
    expect(stockAfter('-5', 'chiqim', '3')).toBe('-8')
  })
  it('float xatosiz va juda katta sonlar', () => {
    expect(stockAfter('0.1', 'kirim', '0.2')).toBe('0.3')
    expect(stockAfter('99999999999999.999999', 'kirim', '0.000001')).toBe('100000000000000')
  })
})

describe('movementWarnings', () => {
  it('qoldiq yetarli — ogohlantirish yo\'q', () => {
    expect(movementWarnings({ type: 'chiqim', qtyBase: '5', currentStock: '10' })).toEqual([])
  })
  it('qoldiqqa aynan teng — ogohlantirish yo\'q', () => {
    expect(movementWarnings({ type: 'chiqim', qtyBase: '10', currentStock: '10' })).toEqual([])
    expect(movementWarnings({ type: 'transfer_out', qtyBase: '10.000000', currentStock: '10' })).toEqual([])
  })
  it('qoldiqdan ko\'p — ikkala ogohlantirish, barqaror tartibda', () => {
    expect(movementWarnings({ type: 'chiqim', qtyBase: '10.000001', currentStock: '10' })).toEqual([
      'exceeds_stock',
      'negative_stock',
    ])
    expect(movementWarnings({ type: 'transfer_out', qtyBase: '1', currentStock: '0' })).toEqual([
      'exceeds_stock',
      'negative_stock',
    ])
  })
  it('manfiy boshlang\'ich qoldiq: kirim yetmasa — faqat negative_stock', () => {
    expect(movementWarnings({ type: 'kirim', qtyBase: '3', currentStock: '-5' })).toEqual(['negative_stock'])
    expect(movementWarnings({ type: 'kirim', qtyBase: '5', currentStock: '-5' })).toEqual([])
  })
  it('kirim va transfer_in hech qachon exceeds_stock bermaydi', () => {
    expect(movementWarnings({ type: 'kirim', qtyBase: '1000', currentStock: '0' })).toEqual([])
    expect(movementWarnings({ type: 'transfer_in', qtyBase: '1000', currentStock: '0' })).toEqual([])
  })
  it('inventory_adjust manfiy', () => {
    expect(movementWarnings({ type: 'inventory_adjust', qtyBase: '-3', currentStock: '10' })).toEqual([])
    expect(movementWarnings({ type: 'inventory_adjust', qtyBase: '-12', currentStock: '10' })).toEqual([
      'negative_stock',
    ])
  })
  it('nol qoldiq, nol miqdor', () => {
    expect(movementWarnings({ type: 'chiqim', qtyBase: '0', currentStock: '0' })).toEqual([])
  })
})

describe('rankMaterials', () => {
  const m = (id: string, name: string) => ({ id, name })
  const MATS = [m('s', 'Sement'), m('q', 'Qum'), m('g', "G'isht"), m('a', 'Armatura'), m('b', 'Beton')]
  const ago = (days: number): string => iso(NOW_MS - days * DAY)

  it('bo\'sh usage — nom bo\'yicha, o\'zbek alifbosi (G\' — Z dan keyin)', () => {
    expect(rankMaterials(MATS, [], NOW).map((x) => x.id)).toEqual(['a', 'b', 'q', 's', 'g'])
  })
  it('bo\'sh materiallar', () => {
    expect(rankMaterials([], [{ materialId: 'x', useCount: 3, lastUsedAt: NOW }], NOW)).toEqual([])
  })
  it('ishlatilganlar birinchi, yaqinlik koeffitsienti bilan', () => {
    const usage: UsageStat[] = [
      { materialId: 's', useCount: 3, lastUsedAt: ago(1) }, // 3
      { materialId: 'q', useCount: 5, lastUsedAt: ago(10) }, // 2.5
      { materialId: 'g', useCount: 10, lastUsedAt: ago(60) }, // 2.5, eskiroq
    ]
    expect(rankMaterials(MATS, usage, NOW).map((x) => x.id)).toEqual(['s', 'q', 'g', 'a', 'b'])
  })
  it('koeffitsient chegaralari: aniq 7 va 30 kun kiradi', () => {
    const usage: UsageStat[] = [
      { materialId: 'a', useCount: 1, lastUsedAt: ago(7) }, // 1
      { materialId: 'b', useCount: 1, lastUsedAt: iso(NOW_MS - 7 * DAY - 1) }, // 0.5
      { materialId: 'g', useCount: 1, lastUsedAt: ago(30) }, // 0.5
      { materialId: 'q', useCount: 1, lastUsedAt: iso(NOW_MS - 30 * DAY - 1) }, // 0.25
    ]
    expect(rankMaterials(MATS, usage, NOW).map((x) => x.id)).toEqual(['a', 'b', 'g', 'q', 's'])
  })
  it('teng ball — lastUsedAt yangisi oldin, keyin nom', () => {
    const usage: UsageStat[] = [
      { materialId: 'q', useCount: 2, lastUsedAt: ago(3) },
      { materialId: 's', useCount: 2, lastUsedAt: ago(1) },
      { materialId: 'b', useCount: 2, lastUsedAt: ago(1) },
    ]
    expect(rankMaterials(MATS, usage, NOW).map((x) => x.id)).toEqual(['b', 's', 'q', 'a', 'g'])
  })
  it('noma\'lum materialId e\'tiborsiz, useCount 0 — ishlatilmagan', () => {
    const usage: UsageStat[] = [
      { materialId: 'zzz', useCount: 100, lastUsedAt: NOW },
      { materialId: 'a', useCount: 0, lastUsedAt: NOW },
      { materialId: 's', useCount: 1, lastUsedAt: ago(100) },
    ]
    expect(rankMaterials(MATS, usage, NOW).map((x) => x.id)).toEqual(['s', 'a', 'b', 'q', 'g'])
  })
  it('bir material uchun bir nechta yozuv yig\'iladi', () => {
    const usage: UsageStat[] = [
      { materialId: 'q', useCount: 2, lastUsedAt: ago(1) },
      { materialId: 'q', useCount: 2, lastUsedAt: ago(2) },
      { materialId: 's', useCount: 3, lastUsedAt: ago(1) },
    ]
    expect(rankMaterials(MATS, usage, NOW).map((x) => x.id).slice(0, 2)).toEqual(['q', 's'])
  })
  it('juda katta useCount', () => {
    const usage: UsageStat[] = [
      { materialId: 'q', useCount: 1_000_000_000, lastUsedAt: ago(100) },
      { materialId: 's', useCount: 999_999_999, lastUsedAt: ago(100) },
    ]
    expect(rankMaterials(MATS, usage, NOW).map((x) => x.id).slice(0, 2)).toEqual(['q', 's'])
  })
  it('kirish massivini o\'zgartirmaydi va deterministik', () => {
    const input = [...MATS].reverse()
    const snapshot = input.map((x) => x.id)
    const usage: UsageStat[] = [{ materialId: 'g', useCount: 1, lastUsedAt: ago(1) }]
    const r1 = rankMaterials(input, usage, NOW)
    const r2 = rankMaterials([...MATS], usage, NOW)
    expect(input.map((x) => x.id)).toEqual(snapshot)
    expect(r1.map((x) => x.id)).toEqual(r2.map((x) => x.id))
    expect(r1[0]).toBe(input.find((x) => x.id === 'g'))
  })
  it('bir xil nom — id bo\'yicha barqaror', () => {
    const r = rankMaterials([m('2', 'Sement'), m('1', 'Sement')], [], NOW)
    expect(r.map((x) => x.id)).toEqual(['1', '2'])
  })
})

describe('occurredAtAllowed', () => {
  it('chegaralar kiradi: aniq 3 kun oldin va aniq 5 daqiqa keyin', () => {
    expect(occurredAtAllowed(iso(NOW_MS - OCCURRED_AT_PAST_MS), NOW, false)).toBe(true)
    expect(occurredAtAllowed(iso(NOW_MS + OCCURRED_AT_FUTURE_MS), NOW, false)).toBe(true)
    expect(occurredAtAllowed(NOW, NOW, false)).toBe(true)
  })
  it('chegaradan 1 ms tashqarida — rad', () => {
    expect(occurredAtAllowed(iso(NOW_MS - 3 * DAY - 1), NOW, false)).toBe(false)
    expect(occurredAtAllowed(iso(NOW_MS + 5 * 60 * 1000 + 1), NOW, false)).toBe(false)
  })
  it('vaqt zonasi siljishi bilan yozilgan ISO', () => {
    // 15:04+05:00 = 10:04Z → 4 daqiqa kelajakda
    expect(occurredAtAllowed('2026-10-25T15:04:00+05:00', NOW, false)).toBe(true)
    expect(occurredAtAllowed('2026-10-25T15:06:00+05:00', NOW, false)).toBe(false)
  })
  it('admin — har doim true', () => {
    expect(occurredAtAllowed('2020-01-01T00:00:00Z', NOW, true)).toBe(true)
    expect(occurredAtAllowed('2030-01-01T00:00:00Z', NOW, true)).toBe(true)
  })
  it('noto\'g\'ri sana — false', () => {
    expect(occurredAtAllowed('kecha', NOW, false)).toBe(false)
    expect(occurredAtAllowed(NOW, 'hozir', false)).toBe(false)
  })
})

describe('validateMovementDraft', () => {
  const ok: MovementDraft = { type: 'kirim', objectId: 'o1', materialId: 'm1', unitId: 'u1', qtyInput: '1 250,5' }

  it('to\'g\'ri qoralama — kanonik miqdor', () => {
    expect(validateMovementDraft(ok)).toEqual({ ok: true, qtyInput: '1250.5' })
    expect(validateMovementDraft({ ...ok, type: 'chiqim', occurredAt: null })).toEqual({ ok: true, qtyInput: '1250.5' })
  })
  it('bo\'sh maydonlar — required', () => {
    expect(
      validateMovementDraft({ type: 'kirim', objectId: null, materialId: '', unitId: '  ', qtyInput: ' ' }),
    ).toEqual({ ok: false, errors: { object: 'required', material: 'required', unit: 'required', qty: 'required' } })
  })
  it.each([
    ['abc', 'not_number'],
    ['1e5', 'not_number'],
    ['0', 'zero'],
    ['0,000', 'zero'],
    ['-1', 'negative'],
    ['1.0000001', 'too_precise'],
    ['123456789012345', 'too_large'],
  ])('miqdor %s → %s', (qtyInput, code) => {
    expect(validateMovementDraft({ ...ok, qtyInput })).toEqual({ ok: false, errors: { qty: code } })
  })
  it('miqdor chegarasida — 14 xonali butun va 6 xonali kasr', () => {
    expect(validateMovementDraft({ ...ok, qtyInput: '99999999999999.999999' })).toEqual({
      ok: true,
      qtyInput: '99999999999999.999999',
    })
  })
  it('occurredAt oraliqdan tashqarida — out_of_range', () => {
    const old = iso(NOW_MS - 3 * DAY - 1)
    expect(validateMovementDraft({ ...ok, occurredAt: old }, { nowIso: NOW })).toEqual({
      ok: false,
      errors: { occurredAt: 'out_of_range' },
    })
    expect(validateMovementDraft({ ...ok, occurredAt: iso(NOW_MS - 3 * DAY) }, { nowIso: NOW }).ok).toBe(true)
  })
  it('admin uchun sana cheklovsiz', () => {
    expect(
      validateMovementDraft({ ...ok, occurredAt: '2020-01-01T00:00:00Z' }, { nowIso: NOW, isAdmin: true }).ok,
    ).toBe(true)
  })
  it('nowIso berilmasa oraliq tekshirilmaydi, lekin format tekshiriladi', () => {
    expect(validateMovementDraft({ ...ok, occurredAt: '2020-01-01T00:00:00Z' }).ok).toBe(true)
    expect(validateMovementDraft({ ...ok, occurredAt: 'kecha' })).toEqual({
      ok: false,
      errors: { occurredAt: 'out_of_range' },
    })
  })
  it('bir nechta xato birga', () => {
    expect(
      validateMovementDraft({ ...ok, objectId: null, qtyInput: '-2', occurredAt: '2030-01-01T00:00:00Z' }, { nowIso: NOW }),
    ).toEqual({ ok: false, errors: { object: 'required', qty: 'negative', occurredAt: 'out_of_range' } })
  })
})

describe('defaultObjectId', () => {
  it('bitta obyekt — o\'sha', () => {
    expect(defaultObjectId(['o1'])).toBe('o1')
    expect(defaultObjectId(['o1'], 'o9')).toBe('o1')
  })
  it('bo\'sh ro\'yxat — null', () => {
    expect(defaultObjectId([])).toBeNull()
    expect(defaultObjectId([], 'o1')).toBeNull()
  })
  it('bir nechta — lastUsed ro\'yxatda bo\'lsa o\'sha, aks holda null', () => {
    expect(defaultObjectId(['o1', 'o2'], 'o2')).toBe('o2')
    expect(defaultObjectId(['o1', 'o2'], 'o3')).toBeNull()
    expect(defaultObjectId(['o1', 'o2'], null)).toBeNull()
    expect(defaultObjectId(['o1', 'o2'])).toBeNull()
  })
})
