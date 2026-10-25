// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { formatPhoneDisplay, looksLikePhone, normalizePhone } from './phone.ts'

describe('normalizePhone', () => {
  it.each([
    ['+998901234567', '+998901234567'],
    ['+998 90 123 45 67', '+998901234567'],
    ['+998 (90) 123-45-67', '+998901234567'],
    ['998901234567', '+998901234567'],
    ['998 90 123 45 67', '+998901234567'],
    ['901234567', '+998901234567'],
    ['90 123 45 67', '+998901234567'],
    ['(90) 123-45-67', '+998901234567'],
    ['8 90 123 45 67', '+998901234567'],
    ['8(90)1234567', '+998901234567'],
    ['00998901234567', '+998901234567'],
    ['  +998901234567  ', '+998901234567'],
    ['+998.90.123.45.67', '+998901234567'],
    ['+7 999 123-45-67', '+79991234567'],
    ['+44 20 7946 0958', '+442079460958'],
    ['+123456789', '+123456789'],
    ['+123456789012345', '+123456789012345'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected)
  })

  it.each([
    [''],
    ['   '],
    ['+'],
    ['abc'],
    ['+998 90 123 45 6'], // +998 dan keyin 8 raqam
    ['+9989012345678'], // +998 dan keyin 10 raqam
    ['99890123456'], // 11 raqam
    ['90123456'], // 8 raqam
    ['1234567890'], // 10 raqam, 8 bilan boshlanmaydi
    ['+12345678'], // 8 raqam
    ['+1234567890123456'], // 16 raqam
    ['+0123456789'], // 0 bilan boshlangan davlat kodi
    ['++998901234567'],
    ['+998 90 123 45 67 ext 1'],
    ['+998_901234567'],
    ['998901234567+'],
    ['user@example.com'],
    ['+998-90-123-45-6x'],
    ['９０１２３４５６７'], // to'liq kenglikdagi raqamlar
  ])('%j → null', (input) => {
    expect(normalizePhone(input)).toBeNull()
  })

  it('natija har doim bazadagi check bilan mos', () => {
    for (const s of ['+998901234567', '901234567', '+7 999 123 45 67', '8 90 123 45 67']) {
      expect(normalizePhone(s)).toMatch(/^\+[0-9]{9,15}$/)
    }
  })

  it('idempotent', () => {
    const once = normalizePhone('8 90 123 45 67') as string
    expect(normalizePhone(once)).toBe(once)
  })
})

describe('looksLikePhone', () => {
  it.each(['+998901234567', '90 123 45 67', '(90) 123-45-67', '998901234567', '+7 999 123 45 67', '1234567'])(
    '%s → telefon',
    (s) => expect(looksLikePhone(s)).toBe(true),
  )
  it.each(['admin@terron.uz', '901234567@mail.uz', '', '  ', 'admin', '123456', '+998 90 abc', 'p998901234567'])(
    '%j → telefon emas',
    (s) => expect(looksLikePhone(s)).toBe(false),
  )
})

describe('formatPhoneDisplay', () => {
  it("O'zbekiston raqami", () => {
    expect(formatPhoneDisplay('+998901234567')).toBe('+998 90 123 45 67')
    expect(formatPhoneDisplay('+998711234567')).toBe('+998 71 123 45 67')
  })
  it("boshqa davlat yoki noto'g'ri — o'zgarmaydi", () => {
    expect(formatPhoneDisplay('+79991234567')).toBe('+79991234567')
    expect(formatPhoneDisplay('+99890123456')).toBe('+99890123456')
    expect(formatPhoneDisplay('')).toBe('')
  })
})
