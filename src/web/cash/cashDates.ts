// Podotchet sanasi: forma `yyyy-mm-dd` (Asia/Tashkent) → `issued_at`.
import { TIME_ZONE } from '@/lib/format'

/** Bugungi sana Toshkent bo'yicha, `yyyy-mm-dd`. */
export function todayTashkent(now: Date = new Date()): string {
  const p: Record<string, string> = {}
  for (const x of new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)) {
    p[x.type] = x.value
  }
  return `${p.year}-${p.month}-${p.day}`
}

/**
 * Bugun — `null` (server `now()` qo'yadi); boshqa kun — shu kun 12:00 Toshkent (UTC+5);
 * noto'g'ri yoki kelajak sana — `undefined`.
 */
export function issuedAtIso(date: string, today: string): string | null | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined
  if (date === today) return null
  if (date > today) return undefined
  const d = new Date(`${date}T12:00:00+05:00`)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}
