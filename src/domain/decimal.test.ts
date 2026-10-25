import { describe, expect, it } from 'vitest'
import {
  abs,
  add,
  cmp,
  div,
  intDigitsOf,
  isNegative,
  isZero,
  MAX_DEC_INPUT_LENGTH,
  mul,
  neg,
  parseDec,
  pgNumericDiv,
  round,
  scaleOf,
  sub,
  toFixedScale,
} from './decimal'

describe('parseDec', () => {
  it.each([
    ['1.5', '1.5'],
    ['1,5', '1.5'],
    ['1 250 000', '1250000'],
    ['1 250 000,75', '1250000.75'],
    ['  42  ', '42'],
    ['+3', '3'],
    ['-0.25', '-0.25'],
    ['-0', '0'],
    ['-0.000', '0'],
    ['0', '0'],
    ['007', '7'],
    ['50.000', '50'],
    ['.5', '0.5'],
    ['5.', '5'],
    ['0.000001', '0.000001'],
    ['99999999999999.999999', '99999999999999.999999'],
    ['-12.50', '-12.5'],
  ])('%j → %j', (input, expected) => {
    expect(parseDec(input)).toBe(expected)
  })

  it.each(['', '   ', '+', '-', '.', ',', '1e5', '1E-3', '1.2.3', '1,2,3', '1,250.5', 'abc', '12a', '--1', '+-1', '1-', 'NaN', 'Infinity', '0x10'])(
    '%j → null',
    (input) => {
      expect(parseDec(input)).toBeNull()
    },
  )
})

describe('parseDec — uzun kirish', () => {
  it('64 belgigacha qabul, 65 dan → null (bo\'sh joylar hisobga olinmaydi)', () => {
    expect(MAX_DEC_INPUT_LENGTH).toBe(64)
    expect(parseDec('9'.repeat(64))).toBe('9'.repeat(64))
    expect(parseDec('9'.repeat(65))).toBeNull()
    expect(parseDec(`-${'1'.repeat(63)}`)).toBe(`-${'1'.repeat(63)}`)
    expect(parseDec(`-${'1'.repeat(64)}`)).toBeNull()
    expect(parseDec(`0.${'0'.repeat(61)}1`)).toBe(`0.${'0'.repeat(61)}1`)
    expect(parseDec(` ${'1 '.repeat(64)}`)).toBe('1'.repeat(64))
  })

  it('juda uzun satr tez rad etiladi', () => {
    const t0 = performance.now()
    expect(parseDec(`1.${'0'.repeat(1_000_000)}`)).toBeNull()
    expect(parseDec('1'.repeat(1_000_000))).toBeNull()
    expect(performance.now() - t0).toBeLessThan(1000)
  })

  it('oxirgi nollar kesiladi', () => {
    expect(parseDec(`5.${'0'.repeat(60)}`)).toBe('5')
    expect(parseDec('-0.10000')).toBe('-0.1')
  })
})

describe('add / sub / mul', () => {
  it('0.1 + 0.2 = 0.3 (float xatosi yo\'q)', () => {
    expect(add('0.1', '0.2')).toBe('0.3')
    expect(cmp(add('0.1', '0.2'), '0.3')).toBe(0)
  })

  it('nol va manfiy', () => {
    expect(add('0', '0')).toBe('0')
    expect(add('-1.5', '1.5')).toBe('0')
    expect(sub('0', '5')).toBe('-5')
    expect(sub('1.1', '1.10')).toBe('0')
    expect(mul('-2', '0')).toBe('0')
    expect(mul('-1.5', '-2')).toBe('3')
    expect(mul('-1.5', '2')).toBe('-3')
  })

  it('juda katta sonlar aniq', () => {
    expect(add('99999999999999.999999', '0.000001')).toBe('100000000000000')
    expect(mul('99999999999999.999999', '9999999999.9999999999')).toBe('999999999999999999980000.0000000000000001')
    expect(sub('0.000001', '99999999999999.999999')).toBe('-99999999999999.999998')
  })

  it('kanonik natija (ortiqcha nollarsiz)', () => {
    expect(mul('2.50', '4')).toBe('10')
    expect(add('1.25', '1.75')).toBe('3')
  })
})

describe('round (half away from zero)', () => {
  it.each([
    ['2.5', 0, '3'],
    ['-2.5', 0, '-3'],
    ['2.4999999', 0, '2'],
    ['-2.4999999', 0, '-2'],
    ['1.0000005', 6, '1.000001'],
    ['-1.0000005', 6, '-1.000001'],
    ['1.0000004999', 6, '1'],
    ['0.005', 2, '0.01'],
    ['-0.005', 2, '-0.01'],
    ['0.004', 2, '0'],
    ['-0.004', 2, '0'],
    ['12.345', 5, '12.345'],
    ['0', 3, '0'],
    ['99999999999999.9999995', 6, '100000000000000'],
  ] as const)('round(%s, %i) = %s', (a, s, expected) => {
    expect(round(a, s)).toBe(expected)
  })

  it('manfiy yoki kasr scale → xato', () => {
    expect(() => round('1', -1)).toThrow()
    expect(() => round('1', 1.5)).toThrow()
  })
})

describe('div', () => {
  it('div(1, 3, 6)', () => {
    expect(div('1', '3', 6)).toBe('0.333333')
    expect(div('2', '3', 6)).toBe('0.666667')
    expect(div('-2', '3', 6)).toBe('-0.666667')
    expect(div('2', '-3', 6)).toBe('-0.666667')
    expect(div('-2', '-3', 6)).toBe('0.666667')
  })

  it('half away from zero', () => {
    expect(div('5', '2', 0)).toBe('3')
    expect(div('-5', '2', 0)).toBe('-3')
    expect(div('1', '8', 2)).toBe('0.13')
    expect(div('-1', '8', 2)).toBe('-0.13')
  })

  it('aniq bo\'linma va nol', () => {
    expect(div('100000', '3', 2)).toBe('33333.33')
    expect(div('0', '7', 4)).toBe('0')
    expect(div('1.5', '0.5', 0)).toBe('3')
    expect(div('0.000001', '1000000', 12)).toBe('0.000000000001')
  })

  it('nolga bo\'lish → xato', () => {
    expect(() => div('1', '0', 2)).toThrow()
    expect(() => div('1', '0.000', 2)).toThrow()
  })
})

describe('pgNumericDiv (PostgreSQL numeric / aniqligi)', () => {
  it('kamida 16 qiymatli raqam', () => {
    expect(pgNumericDiv('1', '3')).toBe('0.33333333333333333333')
    expect(pgNumericDiv('100000', '3')).toBe('33333.333333333333')
    expect(pgNumericDiv('10', '4')).toBe('2.5')
  })

  it('operand dscale hisobga olinadi', () => {
    // numeric(18,2) / numeric(20,6)
    expect(pgNumericDiv('100000', '150', 2, 6)).toBe('666.6666666666666667')
  })

  it('katta bo\'linmada aniqlik kamayadi (ikki marta yaxlitlash manbai)', () => {
    expect(pgNumericDiv('100000000000000000000', '3')).toBe('33333333333333333333')
    expect(div('100000000000000000000', '3', 2)).toBe('33333333333333333333.33')
  })
})

describe('cmp, isZero, isNegative, abs, neg', () => {
  it('cmp', () => {
    expect(cmp('1', '1.000')).toBe(0)
    expect(cmp('-1', '1')).toBe(-1)
    expect(cmp('0.1', '0.09')).toBe(1)
    expect(cmp('-0.1', '-0.09')).toBe(-1)
    expect(cmp('99999999999999.999999', '99999999999999.999998')).toBe(1)
  })

  it('isZero / isNegative', () => {
    expect(isZero('0')).toBe(true)
    expect(isZero('0.000')).toBe(true)
    expect(isZero('0.000001')).toBe(false)
    expect(isNegative('-0.000001')).toBe(true)
    expect(isNegative('0')).toBe(false)
    expect(isNegative('-0')).toBe(false)
  })

  it('abs / neg', () => {
    expect(abs('-12.5')).toBe('12.5')
    expect(abs('12.5')).toBe('12.5')
    expect(neg('12.5')).toBe('-12.5')
    expect(neg('-12.5')).toBe('12.5')
    expect(neg('0')).toBe('0')
  })

  it('noto\'g\'ri Dec → xato', () => {
    expect(() => add('abc', '1')).toThrow()
    expect(() => cmp('1e5', '1')).toThrow()
  })
})

describe('toFixedScale', () => {
  it.each([
    ['50', 2, '50.00'],
    ['0', 2, '0.00'],
    ['1.005', 2, '1.01'],
    ['-1.005', 2, '-1.01'],
    ['-0.001', 2, '0.00'],
    ['0.5', 0, '1'],
    ['33333.333', 2, '33333.33'],
    ['0.000001', 6, '0.000001'],
  ] as const)('toFixedScale(%s, %i) = %s', (a, s, expected) => {
    expect(toFixedScale(a, s)).toBe(expected)
  })
})

describe('scaleOf / intDigitsOf', () => {
  it('xonalar soni', () => {
    expect(scaleOf('1.50')).toBe(1)
    expect(scaleOf('7')).toBe(0)
    expect(scaleOf('-0.000001')).toBe(6)
    expect(intDigitsOf('0.5')).toBe(1)
    expect(intDigitsOf('-12345.6')).toBe(5)
    expect(intDigitsOf('99999999999999.999999')).toBe(14)
  })
})
