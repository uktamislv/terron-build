// UUID v4 (kichik harf). `crypto.randomUUID` faqat xavfsiz kontekstda va yangi brauzerlarda bor —
// eski Telegram WebView uchun `crypto.getRandomValues` asosidagi zaxira.

type CryptoLike = Pick<Crypto, 'getRandomValues'> & { randomUUID?: () => string }

export function uuid(c: CryptoLike = globalThis.crypto): string {
  if (typeof c.randomUUID === 'function') return c.randomUUID().toLowerCase()
  const b = c.getRandomValues(new Uint8Array(16))
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40 // versiya 4
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80 // RFC 4122 varianti
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** UUID shaklidagi satrmi (PostgREST filtr satriga qo'yishdan oldin — inyeksiyaning oldini olish). */
export function isUuid(x: unknown): x is string {
  return typeof x === 'string' && UUID_RE.test(x)
}
