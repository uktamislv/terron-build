// logic.ts lar uchun umumiy sof turlar va yordamchilar (Deno va Node'da ishlaydi).

/** logic.ts natijasi — index.ts uni HTTP javobga aylantiradi. */
export interface HandlerResult {
  status: number
  body: unknown
}

/** Log funksiyasi. `extra` ga hech qachon sir (token, parol, initData) qo'yilmaydi. */
export type LogFn = (level: 'info' | 'warn' | 'error', message: string, extra?: Record<string, unknown>) => void

export const respond = (status: number, body: unknown): HandlerResult => ({ status, body })

/** Oddiy obyekt (massiv emas) ekanini tekshiradi. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const PW_CLASSES = [
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'abcdefghijklmnopqrstuvwxyz',
  '0123456789',
  '!#$%&*+-.:=?@^_~',
] as const
const PW_ALL = PW_CLASSES.join('')

/** Tekis taqsimlangan tasodifiy indeks [0, n) — rejection sampling (modulo og'ishisiz). */
function randomIndex(n: number): number {
  const limit = 256 - (256 % n)
  const buf = new Uint8Array(1)
  for (;;) {
    crypto.getRandomValues(buf)
    const b = buf[0] as number
    if (b < limit) return b % n
  }
}

/**
 * Kuchli tasodifiy parol (WebCrypto, Deno va Node'da bir xil): `length` (≥ 32) belgi,
 * katta va kichik harf, raqam va belgi — har biridan kamida bittadan (GoTrue parol
 * siyosati yoqilgan bo'lsa ham o'tadi). Hech kimga berilmaydi.
 */
export function randomPassword(length = 40): string {
  const len = Math.max(32, length)
  const chars: string[] = PW_CLASSES.map((cls) => cls[randomIndex(cls.length)] as string)
  while (chars.length < len) chars.push(PW_ALL[randomIndex(PW_ALL.length)] as string)
  // Fisher–Yates: majburiy belgilar boshida qolmasin
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1)
    ;[chars[i], chars[j]] = [chars[j] as string, chars[i] as string]
  }
  return chars.join('')
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

/** Xatoni logga xavfsiz ko'rinishda (faqat xabar). */
export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
