// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { isRecord, isUuid, randomPassword } from './handler.ts'

describe('randomPassword', () => {
  it('standart: 40 belgi, katta/kichik harf, raqam va belgi', () => {
    for (let i = 0; i < 200; i++) {
      const p = randomPassword()
      expect(p).toHaveLength(40)
      expect(p).toMatch(/[A-Z]/)
      expect(p).toMatch(/[a-z]/)
      expect(p).toMatch(/[0-9]/)
      expect(p).toMatch(/[^A-Za-z0-9]/)
      expect(p).not.toMatch(/\s/)
    }
  })

  it('kamida 32 belgi (kichikroq so\'ralsa ham)', () => {
    expect(randomPassword(8)).toHaveLength(32)
    expect(randomPassword(64)).toHaveLength(64)
  })

  it('takrorlanmaydi', () => {
    const set = new Set(Array.from({ length: 500 }, () => randomPassword()))
    expect(set.size).toBe(500)
  })
})

describe('isRecord / isUuid', () => {
  it('isRecord', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord([])).toBe(false)
    expect(isRecord(null)).toBe(false)
  })
  it('isUuid', () => {
    expect(isUuid('11111111-2222-4333-8444-555555555555')).toBe(true)
    expect(isUuid('abc')).toBe(false)
    expect(isUuid(5)).toBe(false)
  })
})
