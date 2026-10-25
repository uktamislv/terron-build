// L bo'lim — "oxirgi birlik va miqdor" (foydalanuvchi + material bo'yicha). Sof yordamchilar:
// saqlash formati, tekshiruv, LRU. localStorage'ga murojaat — `src/tg/*/prefs.ts` da (try/catch bilan).
// Miqdor faqat taklif (chip) sifatida ko'rsatiladi, maydonga avtomatik yozilmaydi.

import { isNegative, isZero, parseDec, type Dec } from './decimal'

/** localStorage kaliti (frontend ishlatadi). */
export const ENTRY_PREFS_STORAGE_KEY = 'terron.entryPrefs.v1'
/** Eng ko'p saqlanadigan yozuvlar soni (eng eskisi tashlanadi). */
export const ENTRY_PREFS_MAX = 200
const VERSION = 1
const MAX_ID_LENGTH = 64

export interface EntryPref {
  userId: string
  materialId: string
  /** `material_units.id`. */
  unitId: string
  /** Kiritilgan birlikdagi miqdor (`qty_input`), musbat. */
  qty: Dec
}

/** Ro'yxat — eng yangisi birinchi (LRU tartibi). */
export type EntryPrefs = readonly EntryPref[]

interface StoredV1 {
  v: 1
  items: { u: string; m: string; unit: string; q: string }[]
}

function validId(s: unknown): s is string {
  return typeof s === 'string' && s.length > 0 && s.length <= MAX_ID_LENGTH && s.trim() === s
}

function validQty(s: unknown): Dec | null {
  if (typeof s !== 'string') return null
  const d = parseDec(s)
  if (d === null || isZero(d) || isNegative(d)) return null
  return d
}

function sameKey(a: Pick<EntryPref, 'userId' | 'materialId'>, b: Pick<EntryPref, 'userId' | 'materialId'>): boolean {
  return a.userId === b.userId && a.materialId === b.materialId
}

/** Yozuvni tekshiradi va normallashtiradi (miqdor kanonik Dec); noto'g'ri → null. */
export function normalizeEntryPref(p: unknown): EntryPref | null {
  if (typeof p !== 'object' || p === null) return null
  const o = p as Record<string, unknown>
  if (!validId(o.userId) || !validId(o.materialId) || !validId(o.unitId)) return null
  const qty = validQty(o.qty)
  if (qty === null) return null
  return { userId: o.userId, materialId: o.materialId, unitId: o.unitId, qty }
}

/**
 * Saqlangan satrni o'qiydi. Hech qachon xato tashlamaydi: null, buzilgan JSON, boshqa versiya → [];
 * noto'g'ri yozuvlar tashlanadi; takroriy kalit — birinchisi (eng yangisi) qoladi; 200 tagacha.
 */
export function parseEntryPrefs(raw: string | null | undefined): EntryPref[] {
  if (typeof raw !== 'string' || raw === '') return []
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  if (typeof data !== 'object' || data === null) return []
  const d = data as Partial<StoredV1>
  if (d.v !== VERSION || !Array.isArray(d.items)) return []
  const out: EntryPref[] = []
  for (const it of d.items as unknown[]) {
    if (out.length >= ENTRY_PREFS_MAX) break
    if (typeof it !== 'object' || it === null) continue
    const r = it as Record<string, unknown>
    const p = normalizeEntryPref({ userId: r.u, materialId: r.m, unitId: r.unit, qty: r.q })
    if (p === null || out.some((x) => sameKey(x, p))) continue
    out.push(p)
  }
  return out
}

/** Satrga aylantiradi (noto'g'ri yozuvlar va takrorlar tashlanadi, 200 tagacha). */
export function serializeEntryPrefs(prefs: EntryPrefs): string {
  const clean: EntryPref[] = []
  for (const p of prefs) {
    if (clean.length >= ENTRY_PREFS_MAX) break
    const n = normalizeEntryPref(p)
    if (n === null || clean.some((x) => sameKey(x, n))) continue
    clean.push(n)
  }
  const stored: StoredV1 = { v: VERSION, items: clean.map((p) => ({ u: p.userId, m: p.materialId, unit: p.unitId, q: p.qty })) }
  return JSON.stringify(stored)
}

/** Foydalanuvchi + material uchun oxirgi tanlov yoki null. */
export function getEntryPref(prefs: EntryPrefs, userId: string, materialId: string): EntryPref | null {
  return prefs.find((p) => p.userId === userId && p.materialId === materialId) ?? null
}

/**
 * Yangi tanlovni eslab qoladi: ro'yxat boshiga qo'yiladi (eski shu kalitli yozuv olib tashlanadi),
 * 200 dan oshsa eng eskisi tashlanadi. Noto'g'ri `pref` → ro'yxat o'zgarmaydi (nusxa). Kirish o'zgarmaydi.
 */
export function rememberEntryPref(prefs: EntryPrefs, pref: EntryPref): EntryPref[] {
  const n = normalizeEntryPref(pref)
  if (n === null) return [...prefs]
  return [n, ...prefs.filter((p) => !sameKey(p, n))].slice(0, ENTRY_PREFS_MAX)
}
