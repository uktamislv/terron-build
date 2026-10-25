// Batch 12 (D): yozuvdagi joylashuv ustunlari — movements va purchases uchun umumiy.
import type { GeoFix } from './types'

/** Ustunlar ro'yxati (select): koordinatalar `numeric` → satr. */
export const GEO_SELECT = 'geo_lat::text, geo_lng::text, geo_accuracy_m, geo_status'

/** Saqlanadigan qatorga `geo_*` ustunlari. `geo` berilmasa (veb) — hech narsa qo'shilmaydi. */
export function geoColumns(geo: GeoFix | null | undefined): Record<string, unknown> {
  if (!geo) return {}
  const ok = geo.status === 'ok' && geo.lat !== undefined && geo.lng !== undefined
  return {
    geo_status: ok ? 'ok' : geo.status === 'ok' ? 'unavailable' : geo.status,
    geo_lat: ok ? geo.lat : null,
    geo_lng: ok ? geo.lng : null,
    // Baza: 0..100000
    geo_accuracy_m: ok && geo.accuracyM !== undefined ? Math.min(100_000, Math.max(0, Math.round(geo.accuracyM))) : null,
  }
}

const SHA256_HEX = /^[0-9a-f]{64}$/

/** Rasm xeshi — faqat to'g'ri formatdagi (64 ta kichik hex) yuboriladi. */
export function cleanSha256(value: string | null | undefined): string | null {
  const v = value?.trim().toLowerCase()
  return v && SHA256_HEX.test(v) ? v : null
}
