import { useCallback, useEffect, useRef } from 'react'
import type { GeoFix } from '@/data/types'
import { captureLocation } from '../location'

/** Shundan eski so'rov forma ochilganda yangilanadi (odam boshqa joyga o'tgan bo'lishi mumkin). */
export const GEO_MAX_AGE_MS = 60_000

/**
 * Batch 12 (D): joylashuv ekran ochilishi bilan so'raladi — ruxsat oynasi erta chiqadi va saqlashdagi
 * 3 s kutish kamdan-kam `unavailable` bilan tugaydi. `fresh` true bo'lganda (masalan forma ochildi)
 * so'rov `GEO_MAX_AGE_MS` dan eski bo'lsa — yangisi boshlanadi. Hech qachon bloklamaydi.
 * `get()` — joriy so'rov natijasi (eng ko'pi 3 s, xato tashlamaydi); `reset()` — keyingi yozuv uchun.
 */
export function useGeoCapture(fresh = false) {
  const pending = useRef<{ promise: Promise<GeoFix>; at: number } | null>(null)

  const start = useCallback(() => {
    pending.current = { promise: captureLocation(), at: Date.now() }
    return pending.current.promise
  }, [])

  // Ekran ochilganda
  useEffect(() => {
    if (!pending.current) start()
  }, [start])

  // Forma ochilganda — eskirgan bo'lsa yangilash
  useEffect(() => {
    if (fresh && (!pending.current || Date.now() - pending.current.at > GEO_MAX_AGE_MS)) start()
  }, [fresh, start])

  const get = useCallback((): Promise<GeoFix> => pending.current?.promise ?? start(), [start])

  const reset = useCallback(() => {
    start()
  }, [start])

  return { get, reset }
}
