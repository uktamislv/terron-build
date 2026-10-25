// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  PHONE_LOGIN_DOMAIN,
  TELEGRAM_LOGIN_DOMAIN,
  isSyntheticEmail,
  loginEmailFromPhone,
  telegramAuthEmail,
} from './loginEmail.ts'
import { normalizePhone } from './phone.ts'

describe('domenlar', () => {
  it('shartnoma qiymatlari', () => {
    expect(PHONE_LOGIN_DOMAIN).toBe('phone.terron-build.invalid')
    expect(TELEGRAM_LOGIN_DOMAIN).toBe('tg.terron-build.invalid')
  })
})

describe('loginEmailFromPhone', () => {
  it('E.164 → sintetik email', () => {
    expect(loginEmailFromPhone('+998901234567')).toBe('p998901234567@phone.terron-build.invalid')
    expect(loginEmailFromPhone('+79991234567')).toBe('p79991234567@phone.terron-build.invalid')
  })
  it('normalizePhone bilan zanjir', () => {
    expect(loginEmailFromPhone(normalizePhone('90 123 45 67') as string)).toBe('p998901234567@phone.terron-build.invalid')
  })
  it.each(['998901234567', '+998 90 123 45 67', '', '+', '+12345678', '+1234567890123456', 'p998901234567'])(
    "noto'g'ri %j → throw",
    (s) => expect(() => loginEmailFromPhone(s)).toThrow(),
  )
})

describe('telegramAuthEmail', () => {
  it('musbat butun son', () => {
    expect(telegramAuthEmail(123)).toBe('tg123@tg.terron-build.invalid')
    expect(telegramAuthEmail(7_123_456_789)).toBe('tg7123456789@tg.terron-build.invalid')
  })
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])("noto'g'ri %s → throw", (n) => {
    expect(() => telegramAuthEmail(n)).toThrow()
  })
  it('son emas → throw', () => {
    expect(() => telegramAuthEmail('123' as unknown as number)).toThrow()
  })
})

describe('isSyntheticEmail', () => {
  it('sintetik', () => {
    expect(isSyntheticEmail('p998901234567@phone.terron-build.invalid')).toBe(true)
    expect(isSyntheticEmail('tg123@tg.terron-build.invalid')).toBe(true)
    expect(isSyntheticEmail('  TG123@TG.TERRON-BUILD.INVALID ')).toBe(true)
  })
  it('haqiqiy email', () => {
    expect(isSyntheticEmail('admin@terron.uz')).toBe(false)
    // eski (Batch 2 dastlabki) domenlar endi sintetik emas — terron.uz bizniki emas
    expect(isSyntheticEmail('tg123@tg.terron.uz')).toBe(false)
    expect(isSyntheticEmail('p998901234567@phone.terron.uz')).toBe(false)
    expect(isSyntheticEmail('user@gmail.com')).toBe(false)
    expect(isSyntheticEmail('x@evilphone.terron-build.invalid')).toBe(false)
    expect(isSyntheticEmail('phone.terron-build.invalid')).toBe(false)
    expect(isSyntheticEmail('')).toBe(false)
  })
})
