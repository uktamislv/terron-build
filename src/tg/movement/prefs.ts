// Kirim/chiqim formasi uchun eslab qolinadigan tanlovlar (faqat qulaylik).
// localStorage / sessionStorage yopiq bo'lishi mumkin (maxfiy rejim, Telegram WebView) — har chaqiruv try/catch.
import type { EntryType } from '@/domain/movements'

const TYPE_KEY = 'terron.movement.type'
const OBJECT_KEY = 'terron.movement.object'

function read(key: string, storage: 'local' | 'session' = 'local'): string | null {
  try {
    return (storage === 'session' ? window.sessionStorage : window.localStorage).getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string, storage: 'local' | 'session' = 'local'): void {
  try {
    const store = storage === 'session' ? window.sessionStorage : window.localStorage
    store.setItem(key, value)
  } catch {
    // e'tiborsiz — eslab qolinmasa ham forma ishlaydi
  }
}

/**
 * Harakat turi: faqat joriy sessiya ichida eslab qolinadi (sessionStorage). Mini App qayta ochilganda
 * doim "Kirim" — kecha "Chiqim" tanlab qolgan omborchi kelgan yukni chiqim qilib yozib qo'ymasin.
 */
export function loadEntryType(): EntryType {
  return read(TYPE_KEY, 'session') === 'chiqim' ? 'chiqim' : 'kirim'
}

export function saveEntryType(type: EntryType): void {
  write(TYPE_KEY, type, 'session')
  // Eski versiya localStorage'da saqlagan — endi o'qilmaydi, tozalanadi
  try {
    window.localStorage.removeItem(TYPE_KEY)
  } catch {
    // e'tiborsiz
  }
}

/** Kirim/chiqim (va so'rov/o'tkazma) uchun oxirgi obyekt. Xaridniki alohida (`purchase/prefs.ts`). */
export function loadLastObject(): string | null {
  return read(OBJECT_KEY)
}

export function saveLastObject(objectId: string): void {
  write(OBJECT_KEY, objectId)
}
