// Tasodifiy kuchli parol (crypto.getRandomValues). Chalkash belgilar (0/O, 1/l/I) ishlatilmaydi.
const LOWER = 'abcdefghijkmnpqrstuvwxyz'
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGITS = '23456789'
const SYMBOLS = '!@#$%*-_+?'
const ALL = LOWER + UPPER + DIGITS + SYMBOLS

function randomIndex(max: number): number {
  // Modulo og'ishsiz: max dan katta bo'lgan eng yaqin karrali chegaradan yuqori qiymatlar tashlanadi
  const limit = Math.floor(0x100000000 / max) * max
  const buf = new Uint32Array(1)
  for (;;) {
    crypto.getRandomValues(buf)
    const n = buf[0] ?? 0
    if (n < limit) return n % max
  }
}

function pick(chars: string): string {
  return chars.charAt(randomIndex(chars.length))
}

/** Kamida bitta kichik, katta harf, raqam va belgi bo'lgan parol (standart 14 belgi). */
export function generatePassword(length = 14): string {
  const size = Math.max(length, 8)
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)]
  while (chars.length < size) chars.push(pick(ALL))
  // Fisher–Yates aralashtirish
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1)
    const tmp = chars[i] as string
    chars[i] = chars[j] as string
    chars[j] = tmp
  }
  return chars.join('')
}
