import { describe, expect, it } from 'vitest'
import { adjustmentFor, shortageItems, shortageSeverity, shortageValue, surplusItems } from './inventory'

const line = (materialId: string, expected: string, counted: string) => ({ materialId, expected, counted })

describe('shortageItems', () => {
  it("bo'sh ro'yxat", () => {
    expect(shortageItems([])).toEqual([])
  })
  it('faqat counted < expected, kattasidan', () => {
    const items = [line('a', '10', '10'), line('b', '10', '7'), line('c', '5', '6'), line('d', '100', '50'), line('e', '1', '0.999999')]
    expect(shortageItems(items)).toEqual([
      { materialId: 'd', shortage: '50' },
      { materialId: 'b', shortage: '3' },
      { materialId: 'e', shortage: '0.000001' },
    ])
  })
  it("teng kamomad → materialId bo'yicha", () => {
    expect(shortageItems([line('z', '5', '3'), line('m', '2', '0'), line('a', '10', '8')])).toEqual([
      { materialId: 'a', shortage: '2' },
      { materialId: 'm', shortage: '2' },
      { materialId: 'z', shortage: '2' },
    ])
  })
  it("qiymat bo'yicha tartib (satr emas): 10 > 9", () => {
    expect(shortageItems([line('a', '9', '0'), line('b', '10', '0')]).map((x) => x.materialId)).toEqual(['b', 'a'])
  })
  it('katta sonlar', () => {
    expect(shortageItems([line('a', '99999999999999.999999', '0')])).toEqual([{ materialId: 'a', shortage: '99999999999999.999999' }])
  })
})

describe('surplusItems', () => {
  it('faqat counted > expected', () => {
    const items = [line('a', '10', '10'), line('b', '10', '7'), line('c', '5', '6'), line('d', '0', '0.5')]
    expect(surplusItems(items)).toEqual([
      { materialId: 'c', surplus: '1' },
      { materialId: 'd', surplus: '0.5' },
    ])
    expect(surplusItems([])).toEqual([])
  })
  it("teng → materialId bo'yicha", () => {
    expect(surplusItems([line('b', '0', '1'), line('a', '1', '2')]).map((x) => x.materialId)).toEqual(['a', 'b'])
  })
})

describe('shortageValue', () => {
  it("narx yo'q → null", () => {
    expect(shortageValue('5', null)).toBeNull()
  })
  it('round(shortage * price, 2)', () => {
    expect(shortageValue('3', '1500')).toBe('4500')
    expect(shortageValue('0.333333', '1000.0001')).toBe('333.33')
    expect(shortageValue('0.000005', '1000')).toBe('0.01')
    expect(shortageValue('0.000001', '4999.9')).toBe('0')
    expect(shortageValue('2', '0')).toBe('0')
  })
  it('katta sonlar', () => {
    expect(shortageValue('99999999999999.999999', '99999999999999.9999')).toBe('9999999999999999989900000000')
  })
})

describe('shortageSeverity', () => {
  it('null → ogohlantirish', () => {
    expect(shortageSeverity(null)).toBe('ogohlantirish')
  })
  it('chegara 1 000 000', () => {
    expect(shortageSeverity('0')).toBe('ogohlantirish')
    expect(shortageSeverity('999999.99')).toBe('ogohlantirish')
    expect(shortageSeverity('1000000')).toBe('jiddiy')
    expect(shortageSeverity('1000000.01')).toBe('jiddiy')
  })
})

describe('adjustmentFor', () => {
  it('ishorali farq', () => {
    expect(adjustmentFor('10', '7')).toBe('-3')
    expect(adjustmentFor('10', '12.5')).toBe('2.5')
    expect(adjustmentFor('10', '10')).toBe('0')
    expect(adjustmentFor('0', '0')).toBe('0')
    expect(adjustmentFor('0.000001', '0')).toBe('-0.000001')
  })
})
