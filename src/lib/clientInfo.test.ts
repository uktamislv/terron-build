import { APP_VERSION, describeClient, shortUserAgent } from './clientInfo'

const UA =
  'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36'

describe('clientInfo', () => {
  it('UA qisqartiriladi', () => {
    expect(shortUserAgent(UA)).toBe('(Linux; Android 14; SM-A546E) AppleWebKit/537.36 Chrome/129.0.0.0 Mobile Safari/537.36')
    expect(shortUserAgent('x'.repeat(1000))).toHaveLength(300)
    expect(shortUserAgent(null)).toBe('')
  })

  it('Telegram ichida — platforma va versiya; tashqarida — web', () => {
    expect(describeClient({ telegram: { platform: 'android', version: '8.0' }, userAgent: UA })).toMatch(/^telegram android 8\.0 · \(Linux/)
    expect(describeClient({ telegram: { platform: '', version: null }, userAgent: '' })).toBe('telegram ? ?')
    expect(describeClient({ userAgent: UA })).toMatch(/^web · /)
    expect(describeClient({ userAgent: 'x'.repeat(2000) }).length).toBeLessThanOrEqual(500)
  })

  it('versiya: VITE_APP_VERSION bo‘lmasa — "1"', () => {
    expect(APP_VERSION).toBe(import.meta.env.VITE_APP_VERSION?.trim() || '1')
  })
})
