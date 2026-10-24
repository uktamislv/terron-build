export const TIME_ZONE = 'Asia/Tashkent'

function parts(date: Date, options: Intl.DateTimeFormatOptions): Record<string, string> {
  const result: Record<string, string> = {}
  for (const p of new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, ...options }).formatToParts(date)) {
    result[p.type] = p.value
  }
  return result
}

/** Sana `dd.mm.yyyy` ko'rinishida, Asia/Tashkent bo'yicha. */
export function formatDate(input: Date | string): string {
  const p = parts(new Date(input), { day: '2-digit', month: '2-digit', year: 'numeric' })
  return `${p.day}.${p.month}.${p.year}`
}

/** Sana va vaqt `dd.mm.yyyy HH:mm` ko'rinishida, Asia/Tashkent bo'yicha. */
export function formatDateTime(input: Date | string): string {
  const p = parts(new Date(input), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`
}

/**
 * Pul summasi so'mda, minglik ajratuvchi bo'sh joy: "1 250 000 so'm".
 * Qiymat bazadan `numeric` sifatida string bo'lib keladi — float'ga aylantirilmaydi.
 */
export function formatSum(value: string | bigint): string {
  const raw = String(value).trim()
  const negative = raw.startsWith('-')
  const [intPart = '0', fracPart] = raw.replace(/^[-+]/, '').split('.')
  const grouped = intPart.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  const frac = fracPart && /[1-9]/.test(fracPart) ? `,${fracPart.replace(/0+$/, '')}` : ''
  return `${negative ? '-' : ''}${grouped}${frac} so‘m`
}
