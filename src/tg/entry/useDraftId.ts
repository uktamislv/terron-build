// Qoralama id'si (idempotent saqlash): tarmoq xatosidan keyin AYNAN SHU yozuv qayta yuborilsa — o'sha id
// (baza 23505 → saqlangan qator qaytadi, ikki marta yozilmaydi). Muvaffaqiyatsiz urinishdan keyin
// foydalanuvchi asosiy maydonlarni (tur, obyekt, material, birlik, miqdor, summa) o'zgartirsa — bu boshqa
// yozuv: yangi id, aks holda baza eski (boshqa) qatorni "saqlandi" deb qaytarardi.
import { useCallback, useRef, useState } from 'react'
import { uuid } from '@/lib/uuid'

export interface DraftIdState {
  id: string
  /** Oxirgi urinishdagi asosiy maydonlar izi; null — hali urinish bo'lmagan. */
  fingerprint: string | null
}

/** Sof qoida: oldingi urinish izi boshqacha bo'lsa — yangi id, aks holda o'sha id. */
export function nextDraftId(prev: DraftIdState, fingerprint: string, makeId: () => string = uuid): DraftIdState {
  if (prev.fingerprint !== null && prev.fingerprint !== fingerprint) return { id: makeId(), fingerprint }
  return { id: prev.id, fingerprint }
}

/** Asosiy maydonlardan iz (tartib muhim; bo'sh qiymat — ''). */
export function draftFingerprint(parts: readonly (string | null | undefined)[]): string {
  return JSON.stringify(parts.map((p) => p ?? ''))
}

/**
 * `idFor(iz)` — saqlash urinishida chaqiriladi va yuboriladigan id ni qaytaradi.
 * `renew()` — muvaffaqiyatli saqlashdan (yoki "boshqa ma'lumot bilan saqlangan" xatosidan) keyin yangi id.
 */
export function useDraftId(): { idFor: (fingerprint: string) => string; renew: () => void } {
  const [initial] = useState(() => uuid())
  const ref = useRef<DraftIdState>({ id: initial, fingerprint: null })
  const idFor = useCallback((fingerprint: string) => {
    ref.current = nextDraftId(ref.current, fingerprint)
    return ref.current.id
  }, [])
  const renew = useCallback(() => {
    ref.current = { id: uuid(), fingerprint: null }
  }, [])
  return { idFor, renew }
}
