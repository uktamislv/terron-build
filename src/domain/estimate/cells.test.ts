import { describe, expect, it } from 'vitest'
import { cellText, cellToDec, numberToDec } from './cells'

describe('numberToDec', () => {
  it('float artefaktlari tozalanadi', () => {
    expect(numberToDec(0.1 + 0.2)).toBe('0.3')
    expect(numberToDec(1.1 * 3)).toBe('3.3')
    expect(numberToDec(1234.56)).toBe('1234.56')
    expect(numberToDec(2.675)).toBe('2.675')
  })

  it('eksponentasiz', () => {
    expect(numberToDec(1e21)).toBe('1000000000000000000000')
    expect(numberToDec(-1.5e22)).toBe('-15000000000000000000000')
    expect(numberToDec(1e-7)).toBe('0.0000001')
    expect(numberToDec(2 ** 60)).toBe('1152921504606850000')
  })

  it('10 kasr xonagacha', () => {
    expect(numberToDec(1e-11)).toBe('0')
    expect(numberToDec(0.00000000005)).toBe('0.0000000001')
    expect(numberToDec(1 / 3)).toBe('0.3333333333')
  })

  it('nol, manfiy, butun', () => {
    expect(numberToDec(0)).toBe('0')
    expect(numberToDec(-0)).toBe('0')
    expect(numberToDec(-12.5)).toBe('-12.5')
    expect(numberToDec(15006000)).toBe('15006000')
  })

  it('NaN va Infinity → null', () => {
    expect(numberToDec(NaN)).toBeNull()
    expect(numberToDec(Infinity)).toBeNull()
    expect(numberToDec(-Infinity)).toBeNull()
  })
})

describe('cellToDec', () => {
  it('satr: bo\'sh joy, NBSP, vergul', () => {
    expect(cellToDec('1 234,56')).toEqual({ state: 'ok', value: '1234.56' })
    expect(cellToDec('1 200')).toEqual({ state: 'ok', value: '1200' })
    expect(cellToDec(' 75000.00 ')).toEqual({ state: 'ok', value: '75000' })
  })

  it('bo\'sh va tire', () => {
    expect(cellToDec(null)).toEqual({ state: 'empty' })
    expect(cellToDec(undefined)).toEqual({ state: 'empty' })
    expect(cellToDec('  ')).toEqual({ state: 'empty' })
    expect(cellToDec('-')).toEqual({ state: 'empty' })
    expect(cellToDec('—')).toEqual({ state: 'empty' })
  })

  it('noto\'g\'ri', () => {
    expect(cellToDec('abc')).toEqual({ state: 'invalid' })
    expect(cellToDec('1e5')).toEqual({ state: 'invalid' })
    expect(cellToDec('1.234,56')).toEqual({ state: 'invalid' })
    expect(cellToDec(true)).toEqual({ state: 'invalid' })
    expect(cellToDec(NaN)).toEqual({ state: 'invalid' })
  })

  it('number', () => {
    expect(cellToDec(0.1 + 0.2)).toEqual({ state: 'ok', value: '0.3' })
  })
})

describe('cellText', () => {
  it('trim va bo\'sh joylar', () => {
    expect(cellText('  Цемент\n  М500 ')).toBe('Цемент М500')
    expect(cellText(null)).toBe('')
    expect(cellText(12.5)).toBe('12.5')
    expect(cellText(false)).toBe('false')
  })
})
