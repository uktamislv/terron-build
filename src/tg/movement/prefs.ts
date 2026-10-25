// Kirim/chiqim formasi uchun eslab qolinadigan tanlovlar (faqat qulaylik).
// localStorage yopiq bo'lishi mumkin (maxfiy rejim, Telegram WebView) — har chaqiruv try/catch.
import type { EntryType } from '@/domain/movements'

const TYPE_KEY = 'terron.movement.type'
const OBJECT_KEY = 'terron.movement.object'

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // e'tiborsiz — eslab qolinmasa ham forma ishlaydi
  }
}

export function loadEntryType(): EntryType {
  return read(TYPE_KEY) === 'chiqim' ? 'chiqim' : 'kirim'
}

export function saveEntryType(type: EntryType): void {
  write(TYPE_KEY, type)
}

export function loadLastObject(): string | null {
  return read(OBJECT_KEY)
}

export function saveLastObject(objectId: string): void {
  write(OBJECT_KEY, objectId)
}
