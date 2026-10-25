// Batch 12 (L): har foydalanuvchi + material uchun oxirgi birlik va miqdor (faqat qulaylik).
// Serializatsiya va LRU — `@/domain/entryPrefs`; bu yerda faqat localStorage (try/catch — maxfiy
// rejim, Telegram WebView). Birlik oldindan tanlanadi; miqdor — faqat taklif (chip).
import {
  ENTRY_PREFS_STORAGE_KEY,
  getEntryPref,
  parseEntryPrefs,
  rememberEntryPref,
  serializeEntryPrefs,
  type EntryPref,
} from '@/domain/entryPrefs'

export type LastEntry = EntryPref

function readAll(): EntryPref[] {
  try {
    return parseEntryPrefs(window.localStorage.getItem(ENTRY_PREFS_STORAGE_KEY))
  } catch {
    return []
  }
}

export function loadLastEntry(profileId: string, materialId: string): LastEntry | null {
  return getEntryPref(readAll(), profileId, materialId)
}

export function rememberLastEntry(profileId: string, materialId: string, unitId: string, qty: string): void {
  try {
    const next = rememberEntryPref(readAll(), { userId: profileId, materialId, unitId, qty })
    window.localStorage.setItem(ENTRY_PREFS_STORAGE_KEY, serializeEntryPrefs(next))
  } catch {
    // e'tiborsiz — eslab qolinmasa ham forma ishlaydi
  }
}

/** Material tanlanganda boshlang'ich birlik: eslab qolingan (hali mavjud bo'lsa) yoki birinchisi. */
export function initialUnitId(units: readonly { id: string }[], last: LastEntry | null): string | null {
  if (last && units.some((u) => u.id === last.unitId)) return last.unitId
  return units[0]?.id ?? null
}
