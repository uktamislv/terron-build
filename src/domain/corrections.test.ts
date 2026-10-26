import {
  adminCorrection,
  CORRECTION_WINDOW_MS,
  correctionRemainingMs,
  remainingMinutes,
  isUnlinked,
  selfCorrection,
  validateCorrection,
  type CorrectableEntry,
} from './corrections'

const NOW = '2026-10-26T10:00:00.000Z'
const ago = (min: number) => new Date(Date.parse(NOW) - min * 60_000).toISOString()

const kirim = (over: Partial<CorrectableEntry> = {}): CorrectableEntry => ({
  table: 'movements',
  createdBy: 'me',
  createdAt: ago(5),
  deletedAt: null,
  movementType: 'kirim',
  purchaseId: null,
  ...over,
})

describe('correct_entry oynasi (D1)', () => {
  it('muallif, 30 daqiqa ichida, bog‘lanmagan kirim — ruxsat, qolgan vaqt bilan', () => {
    const r = selfCorrection(kirim(), 'me', NOW)
    expect(r.allowed).toBe(true)
    expect(r.remainingMs).toBe(25 * 60_000)
    expect(remainingMinutes(r.remainingMs)).toBe(25)
  })

  it('30 daqiqa o‘tgan, boshqa muallif yoki o‘chirilgan — yo‘q', () => {
    // Chegara kiritiladi (server: now() <= created_at + 30 daqiqa)
    expect(selfCorrection(kirim({ createdAt: ago(30) }), 'me', NOW)).toEqual({ allowed: true, remainingMs: 0 })
    expect(selfCorrection(kirim({ createdAt: ago(31) }), 'me', NOW)).toEqual({ allowed: false, remainingMs: 0 })
    expect(selfCorrection(kirim({ createdBy: 'other' }), 'me', NOW).allowed).toBe(false)
    expect(selfCorrection(kirim({ deletedAt: NOW }), 'me', NOW).allowed).toBe(false)
  })

  it('bog‘langan: xaridga bog‘langan kirim, o‘tkazma, inventarizatsiya, kirimi bor xarid', () => {
    expect(isUnlinked(kirim({ purchaseId: 'p1' }))).toBe(false)
    expect(isUnlinked(kirim({ movementType: 'transfer_out' }))).toBe(false)
    expect(isUnlinked(kirim({ movementType: 'inventory_adjust' }))).toBe(false)
    expect(isUnlinked(kirim({ movementType: 'chiqim' }))).toBe(true)
    // O'tkazma / inventarizatsiya harakati va noma'lum xarid bog'lanishi — bog'langan
    expect(isUnlinked(kirim({ transferId: 't1' }))).toBe(false)
    expect(isUnlinked(kirim({ inventoryCountId: 'c1' }))).toBe(false)
    expect(isUnlinked(kirim({ purchaseId: undefined }))).toBe(false)
    const purchase: CorrectableEntry = { table: 'purchases', createdBy: 'me', createdAt: ago(1), deletedAt: null, linkedReceipts: 0 }
    expect(isUnlinked(purchase)).toBe(true)
    expect(isUnlinked({ ...purchase, linkedReceipts: 1 })).toBe(false)
    // Qabul holati noma'lum — bog'langan deb olinadi (tugma ko'rsatilmaydi)
    expect(isUnlinked({ ...purchase, linkedReceipts: null })).toBe(false)
  })

  it('admin — vaqt cheklovisiz, faqat bog‘lanmagan va o‘chirilmagan', () => {
    expect(adminCorrection(kirim({ createdAt: ago(60 * 24 * 30), createdBy: 'other' }))).toBe(true)
    expect(adminCorrection(kirim({ purchaseId: 'p' }))).toBe(false)
    expect(adminCorrection(kirim({ deletedAt: NOW }))).toBe(false)
  })

  it('qolgan vaqt va format', () => {
    expect(correctionRemainingMs(ago(0), NOW)).toBe(CORRECTION_WINDOW_MS)
    expect(correctionRemainingMs('xato', NOW)).toBe(0)
    // Butun daqiqalar (pastga): 12:30 → 12; oxirgi daqiqa — 0 ("1 daqiqadan kam")
    expect(remainingMinutes(12 * 60_000 + 30_000)).toBe(12)
    expect(remainingMinutes(61_000)).toBe(1)
    expect(remainingMinutes(59_999)).toBe(0)
    expect(remainingMinutes(-5)).toBe(0)
  })
})

describe('validateCorrection', () => {
  const base = { table: 'movements' as const, original: { qtyInput: '3', unitId: 'u1', note: 'eski' }, qtyInput: '5', unitId: 'u1', reason: 'xato kiritilgan' }

  it('o‘zgargan maydonlar yuboriladi, o‘zgarmagani — null; sabab qirqiladi; izoh standart — o‘zgarmaydi', () => {
    expect(validateCorrection(base)).toEqual({
      ok: true,
      value: { qtyInput: '5', unitId: null, totalAmount: null, reason: 'xato kiritilgan', note: null, materialId: null, objectId: null },
    })
    expect(validateCorrection({ ...base, qtyInput: '3,0', unitId: 'u2', reason: '  x  ' })).toEqual({
      ok: true,
      value: { qtyInput: null, unitId: 'u2', totalAmount: null, reason: 'x', note: null, materialId: null, objectId: null },
    })
  })

  it('muallif: material yoki obyekt o‘zgarsa — yuboriladi, material bilan birlik ham', () => {
    const b = { ...base, original: { ...base.original, materialId: 'm1', objectId: 'o1' }, qtyInput: '3' }
    expect(validateCorrection({ ...b, materialId: 'm1', objectId: 'o1' })).toMatchObject({ ok: true, value: { materialId: null, objectId: null, unitId: null } })
    expect(validateCorrection({ ...b, materialId: 'm2', unitId: 'u9' })).toMatchObject({ ok: true, value: { materialId: 'm2', unitId: 'u9' } })
    expect(validateCorrection({ ...b, objectId: 'o2' })).toMatchObject({ ok: true, value: { objectId: 'o2', materialId: null } })
  })

  it('izoh ixtiyoriy: o‘zgarsa — yangi qiymat, o‘zgarmasa — null', () => {
    expect(validateCorrection({ ...base, note: 'eski' })).toMatchObject({ ok: true, value: { note: null } })
    expect(validateCorrection({ ...base, note: ' yangi ' })).toMatchObject({ ok: true, value: { note: 'yangi' } })
    expect(validateCorrection({ ...base, note: '' })).toMatchObject({ ok: true, value: { note: '' } })
  })

  it('sabab majburiy; miqdor 0 dan katta; birlik kerak', () => {
    expect(validateCorrection({ ...base, reason: '  ' })).toEqual({ ok: false, errors: { reason: 'required' } })
    expect(validateCorrection({ ...base, qtyInput: '0' })).toEqual({ ok: false, errors: { qty: 'zero' } })
    expect(validateCorrection({ ...base, qtyInput: '' })).toEqual({ ok: false, errors: { qty: 'required' } })
    expect(validateCorrection({ ...base, unitId: null })).toEqual({ ok: false, errors: { unit: 'required' } })
  })

  it('xarid: summa majburiy va musbat; o‘zgarmasa — null', () => {
    const p = { ...base, table: 'purchases' as const, original: { qtyInput: '3', unitId: 'u1', totalAmount: '150000' } }
    expect(validateCorrection({ ...p, totalInput: '' })).toEqual({ ok: false, errors: { total: 'required' } })
    expect(validateCorrection({ ...p, totalInput: '0' })).toEqual({ ok: false, errors: { total: 'invalid' } })
    expect(validateCorrection({ ...p, totalInput: '150 000' })).toMatchObject({ ok: true, value: { totalAmount: null } })
    expect(validateCorrection({ ...p, totalInput: '1 250 000' })).toMatchObject({ ok: true, value: { totalAmount: '1250000' } })
  })
})
