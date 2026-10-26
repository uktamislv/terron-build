import { describe, expect, it } from 'vitest'
import { parseDec } from './decimal'
import {
  inputUnitView,
  MONEY_SCALE,
  PRICE_PER_BASE_SCALE,
  QTY_SCALE,
  conversionHint,
  findUnit,
  formatDecUz,
  fromBaseQty,
  purchasePrices,
  toBaseQty,
  unitLabel,
  validateFactor,
  validateQtyInput,
  type UnitDef,
} from './units'

// supabase/migrations/20261025000007_material_template.sql dagi haqiqiy koeffitsientlar
const u = (id: string, materialId: string, unit: string, factor: string, variant: string | null = null): UnitDef => ({
  id,
  materialId,
  unit,
  factor,
  variant,
})

const GISHT: UnitDef[] = [
  u('g1', 'gisht', 'dona', '1'),
  u('g2', 'gisht', 'poddon', '300'),
  u('g3', 'gisht', 'm² devor', '51', "yarim g'isht · 120 mm"),
  u('g4', 'gisht', 'm² devor', '102', "bir g'isht · 250 mm"),
  u('g5', 'gisht', 'm² devor', '153', "bir yarim g'isht · 380 mm"),
]
const ARMATURA: UnitDef[] = [
  u('a1', 'arm', 'kg', '1'),
  u('a2', 'arm', 'tonna', '1000'),
  u('a3', 'arm', 'metr', '0.395', 'Ø8'),
  u('a4', 'arm', 'metr', '0.617', 'Ø10'),
  u('a5', 'arm', 'metr', '0.888', 'Ø12'),
]
const QOP = u('s2', 'sement', 'qop', '50')
const QUM_TONNA = u('q2', 'qum', 'tonna', '0.6667')

describe('konstantalar', () => {
  it('bazadagi ustun turlariga mos', () => {
    expect(QTY_SCALE).toBe(6)
    expect(MONEY_SCALE).toBe(2)
    expect(PRICE_PER_BASE_SCALE).toBe(4)
  })
})

describe('toBaseQty', () => {
  it('shablon koeffitsientlari', () => {
    expect(toBaseQty('3', QOP.factor)).toBe('150')
    expect(toBaseQty('12', '0.888')).toBe('10.656')
    expect(toBaseQty('10', QUM_TONNA.factor)).toBe('6.667')
    expect(toBaseQty('2.5', '102')).toBe('255')
    expect(toBaseQty('1', '300')).toBe('300')
  })

  it('round(qty * factor, 6) — half away from zero', () => {
    expect(toBaseQty('0.000001', '0.5')).toBe('0.000001') // 0.0000005 → 0.000001
    expect(toBaseQty('0.000001', '0.4999')).toBe('0')
    expect(toBaseQty('-0.000001', '0.5')).toBe('-0.000001') // inventory_adjust
    expect(toBaseQty('1', '0.0000000001')).toBe('0')
    expect(toBaseQty('0.333333', '3')).toBe('0.999999')
  })

  it('juda katta qiymat', () => {
    expect(toBaseQty('99999999999999.999999', '1')).toBe('99999999999999.999999')
    expect(toBaseQty('99999999999999.999999', '9999999999.9999999999')).toBe('999999999999999999980000')
  })
})

describe('fromBaseQty', () => {
  it('teskari konvertatsiya', () => {
    expect(fromBaseQty('150', '50')).toBe('3')
    expect(fromBaseQty('10.656', '0.888')).toBe('12')
    expect(fromBaseQty('1', '0.6667')).toBe('1.499925')
    expect(fromBaseQty('100', '3')).toBe('33.333333')
    expect(fromBaseQty('100', '3', 2)).toBe('33.33')
    expect(fromBaseQty('0', '50')).toBe('0')
  })
})

describe('purchasePrices', () => {
  it('100000 so\'m / 3 qop sement → 33333.33 va 666.6667', () => {
    const qtyBase = toBaseQty('3', QOP.factor)
    expect(purchasePrices('100000', '3', qtyBase)).toEqual({ unitPrice: '33333.33', pricePerBase: '666.6667' })
  })

  it('armatura Ø12: 1 000 000 so\'m / 120 metr', () => {
    const qtyBase = toBaseQty('120', '0.888') // 106.56 kg
    expect(qtyBase).toBe('106.56')
    expect(purchasePrices('1000000', '120', qtyBase)).toEqual({ unitPrice: '8333.33', pricePerBase: '9384.3844' })
  })

  it('qum: 450 000 so\'m / 10 tonna', () => {
    expect(purchasePrices('450000', '10', toBaseQty('10', '0.6667'))).toEqual({
      unitPrice: '45000',
      pricePerBase: '67496.6252',
    })
  })

  it('nol summa va nol miqdor (trigger: coalesce(..., 0))', () => {
    expect(purchasePrices('0', '5', '5')).toEqual({ unitPrice: '0', pricePerBase: '0' })
    expect(purchasePrices('1000', '0', '0')).toEqual({ unitPrice: '0', pricePerBase: '0' })
  })

  it('kirish qiymatlari ustun turlariga keltiriladi (total → 2 xona)', () => {
    expect(purchasePrices('100.005', '1', '1')).toEqual({ unitPrice: '100.01', pricePerBase: '100.01' })
  })
})

describe('unitLabel', () => {
  it('variantsiz va variantli', () => {
    expect(unitLabel({ unit: 'm²', variant: null })).toBe('m²')
    expect(unitLabel({ unit: 'm²', variant: "bir g'isht · 250 mm" })).toBe("m² · bir g'isht · 250 mm")
    expect(unitLabel({ unit: ' metr ', variant: ' Ø12 ' })).toBe('metr · Ø12')
    expect(unitLabel({ unit: 'kg', variant: '   ' })).toBe('kg')
  })
})

describe('findUnit', () => {
  it('katta-kichik harf va bo\'sh joylar', () => {
    expect(findUnit(GISHT, '  PODDON ')?.id).toBe('g2')
    expect(findUnit([QOP], 'Qop')?.id).toBe('s2')
    expect(findUnit(GISHT, 'tonna')).toBeUndefined()
  })

  it('variantli birliklar', () => {
    expect(findUnit(GISHT, 'm² devor', "bir g'isht · 250 mm")?.id).toBe('g4')
    expect(findUnit(GISHT, 'M² DEVOR', "  BIR G'ISHT · 250 MM ")?.id).toBe('g4')
    expect(findUnit(ARMATURA, 'metr', 'ø12')?.id).toBe('a5')
    expect(findUnit(ARMATURA, 'metr', 'Ø20')).toBeUndefined()
  })

  it('variant ko\'rsatilmasa: bir nechta variant → undefined (tanlash kerak)', () => {
    expect(findUnit(GISHT, 'm² devor')).toBeUndefined()
    expect(findUnit(ARMATURA, 'metr')).toBeUndefined()
  })

  it('variant ko\'rsatilmasa: variantsiz birlik ustun, yagona variantli birlik qaytadi', () => {
    const units = [u('x1', 'm', 'dona', '0.09', '30×30 sm')]
    expect(findUnit(units, 'dona')?.id).toBe('x1')
    expect(findUnit(units, 'dona', null)).toBeUndefined()
    const mixed = [u('y1', 'm', 'dona', '0.09', '30×30 sm'), u('y2', 'm', 'dona', '1')]
    expect(findUnit(mixed, 'dona')?.id).toBe('y2')
    expect(findUnit(mixed, 'dona', null)?.id).toBe('y2')
    expect(findUnit(mixed, 'dona', '')?.id).toBe('y2')
  })

  it('bo\'sh ro\'yxat', () => {
    expect(findUnit([], 'kg')).toBeUndefined()
  })
})

describe('validateFactor', () => {
  it.each([
    ['50', '50'],
    ['0,888', '0.888'],
    ['0.6667', '0.6667'],
    [' 1 000 ', '1000'],
    ['9999999999.9999999999', '9999999999.9999999999'],
    ['0.0000000001', '0.0000000001'],
    ['1.50000000000000', '1.5'],
  ])('%j → ok %j', (input, value) => {
    expect(validateFactor(input)).toEqual({ ok: true, value })
  })

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['abc', 'not_number'],
    ['1e3', 'not_number'],
    ['1.2.3', 'not_number'],
    ['0', 'not_positive'],
    ['0.000', 'not_positive'],
    ['-5', 'not_positive'],
    ['0.00000000001', 'too_precise'],
    ['1.12345678901', 'too_precise'],
    ['10000000000', 'too_large'],
    ['12345678901.5', 'too_large'],
  ] as const)('%j → %s', (input, reason) => {
    expect(validateFactor(input)).toEqual({ ok: false, reason })
  })
})

describe('validateQtyInput', () => {
  it.each([
    ['3', '3'],
    ['1,5', '1.5'],
    ['0.000001', '0.000001'],
    ['99999999999999.999999', '99999999999999.999999'],
    ['1 250', '1250'],
  ])('%j → ok %j', (input, value) => {
    expect(validateQtyInput(input)).toEqual({ ok: true, value })
  })

  it.each([
    ['', 'empty'],
    [' ', 'empty'],
    ['bir', 'not_number'],
    ['2e2', 'not_number'],
    ['0', 'zero'],
    ['-0', 'zero'],
    ['0,000', 'zero'],
    ['-1', 'negative'],
    ['0.0000001', 'too_precise'],
    ['1.1234567', 'too_precise'],
    ['100000000000000', 'too_large'],
  ] as const)('%j → %s', (input, reason) => {
    expect(validateQtyInput(input)).toEqual({ ok: false, reason })
  })

  it('allowNegative (inventory_adjust): manfiy mumkin, nol — yo\'q', () => {
    expect(validateQtyInput('-2,5', { allowNegative: true })).toEqual({ ok: true, value: '-2.5' })
    expect(validateQtyInput('0', { allowNegative: true })).toEqual({ ok: false, reason: 'zero' })
    expect(validateQtyInput('-0.0000001', { allowNegative: true })).toEqual({ ok: false, reason: 'too_precise' })
    expect(validateQtyInput('-100000000000000', { allowNegative: true })).toEqual({ ok: false, reason: 'too_large' })
  })
})

describe('formatDecUz / conversionHint', () => {
  it('raqam formati: minglik — U+202F, minus — U+2212', () => {
    expect(formatDecUz('1250000.5')).toBe('1\u202F250\u202F000,5')
    expect(formatDecUz('-1000')).toBe('\u22121\u202F000')
    expect(formatDecUz('999')).toBe('999')
    expect(formatDecUz('0.6667')).toBe('0,6667')
    expect(formatDecUz('50.0000000000')).toBe('50')
  })

  it('formatlangan qiymat qayta o‘qiladi (U+202F — bo‘shliq)', () => {
    expect(parseDec(formatDecUz('1250000.5').replace(',', '.'))).toBe('1250000.5')
  })

  it('maslahat matni (raqam va birlik orasida U+00A0)', () => {
    expect(conversionHint(QOP, 'kg')).toBe('1\u00A0qop = 50\u00A0kg')
    expect(conversionHint(QUM_TONNA, 'm³')).toBe('1\u00A0tonna = 0,6667\u00A0m³')
    expect(conversionHint(GISHT[1]!, 'dona')).toBe('1\u00A0poddon = 300\u00A0dona')
    expect(conversionHint(GISHT[3]!, 'dona')).toBe("1\u00A0m² devor · bir g'isht · 250 mm = 102\u00A0dona")
    expect(conversionHint(ARMATURA[4]!, 'kg')).toBe('1\u00A0metr · Ø12 = 0,888\u00A0kg')
    expect(conversionHint(u('t', 'arm', 'tonna', '1000.0000000000'), 'kg')).toBe('1\u00A0tonna = 1\u202F000\u00A0kg')
  })
})

describe('inputUnitView — qoldiq odatiy birlikda', () => {
  const units = [
    { id: 'kg', unit: 'kg', variant: null, factor: '1' },
    { id: 'qop', unit: 'qop', variant: null, factor: '50' },
  ]
  it('oxirgi birlik koeffitsienti > 1 — shu birlikda', () => {
    expect(inputUnitView('600', units, 'qop')).toEqual({ qty: '12', unit: 'qop' })
  })
  it('kasr 2 xonagacha', () => {
    expect(inputUnitView('625', units, 'qop')).toEqual({ qty: '12.5', unit: 'qop' })
  })
  it('asosiy birlik, noma’lum yoki yo‘q birlik — null', () => {
    expect(inputUnitView('600', units, 'kg')).toBeNull()
    expect(inputUnitView('600', units, null)).toBeNull()
    expect(inputUnitView('600', units, 'gone')).toBeNull()
  })
})
