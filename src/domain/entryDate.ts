// Yozuv sanasi ("Bugun / Kecha / Boshqa sana") → `occurred_at` / `purchased_at` — sof funksiyalar.
// Bazadagi qoida (admin bo'lmaganlar): sana ∈ [now − 3 kun, now + 5 daqiqa] — `occurredAtAllowed`.
// Toshkent — UTC+5, yozgi vaqt yo'q.
import { OCCURRED_AT_PAST_MS, occurredAtAllowed } from './movements'

export type EntryDateChoice = 'today' | 'yesterday' | 'other'

const TZ_OFFSET_MS = 5 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
/** Oyna chegarasidan ichkariga zaxira — saqlash bir necha daqiqa kechiksa ham server rad etmasin. */
export const ENTRY_DATE_MARGIN_MS = 15 * 60 * 1000

/** Toshkent sanasi (`yyyy-mm-dd`) berilgan lahzada. */
export function tashkentDateOf(ms: number): string {
  return new Date(ms + TZ_OFFSET_MS).toISOString().slice(0, 10)
}

/** Sana tanlovi uchun chegaralar (`yyyy-mm-dd`): admin — faqat yuqori (bugun); boshqalar — oxirgi 3 kun. */
export function entryDateBounds(nowIso: string, isAdmin: boolean): { min: string | undefined; max: string } {
  const now = Date.parse(nowIso)
  const max = tashkentDateOf(now)
  if (isAdmin) return { min: undefined, max }
  return { min: tashkentDateOf(now - OCCURRED_AT_PAST_MS + ENTRY_DATE_MARGIN_MS), max }
}

/**
 * Tanlangan Toshkent sanasi → ISO vaqt. Bugun — `null` (server `now()`; qo'shimcha bosish yo'q).
 * Boshqa kun — shu kunning hozirgi soati (Toshkent). Admin bo'lmaganlarga oynaning eski chetiga
 * yaqin bo'lsa — chegara + 15 daqiqa. Kelajak yoki ruxsat etilmagan sana — `undefined`.
 */
export function entryDateToIso(isoDate: string, nowIso: string, isAdmin: boolean): string | null | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return undefined
  const now = Date.parse(nowIso)
  if (!Number.isFinite(now)) return undefined
  const today = tashkentDateOf(now)
  if (isoDate === today) return null
  if (isoDate > today) return undefined
  const dayStartUtc = Date.parse(`${isoDate}T00:00:00Z`) - TZ_OFFSET_MS
  if (!Number.isFinite(dayStartUtc)) return undefined
  const timeOfDay = (now + TZ_OFFSET_MS) % DAY_MS
  let at = dayStartUtc + timeOfDay
  if (!isAdmin) {
    const earliest = now - OCCURRED_AT_PAST_MS + ENTRY_DATE_MARGIN_MS
    if (at < earliest) at = earliest
    // Shu kun ichida qolishi kerak (tanlangan sana o'zgarmasin)
    if (tashkentDateOf(at) !== isoDate) return undefined
  }
  const iso = new Date(at).toISOString()
  return occurredAtAllowed(iso, nowIso, isAdmin) ? iso : undefined
}

/** Chip → sana: "Bugun" — null, "Kecha" — kechagi kun, "Boshqa sana" — tanlangan `otherDate`. */
export function entryDateFor(
  choice: EntryDateChoice,
  otherDate: string,
  nowIso: string,
  isAdmin: boolean,
): string | null | undefined {
  if (choice === 'today') return null
  if (choice === 'yesterday') return entryDateToIso(tashkentDateOf(Date.parse(nowIso) - DAY_MS), nowIso, isAdmin)
  return otherDate ? entryDateToIso(otherDate, nowIso, isAdmin) : undefined
}
