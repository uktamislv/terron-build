// D bo'lim — joylashuv farqi (`joylashuv_farqi`, belgi).
// Bu geometriya, pul yoki miqdor emas — `number` (float) ataylab ishlatiladi: koordinatalar
// numeric(9,6) (~0.1 m), GPS aniqligi o'nlab metr; float xatosi (< 1 mm) ahamiyatsiz.
// SQL'da aynan shu formula (double precision): 2 * 6371000 * asin(least(1, sqrt(a))), so'ng
// `round(...)::integer` — butun metrga (`private.geo_distance_m`). Solishtirish butun metrlarda:
//   outside = round(d) > radius + least(accuracy, radius)
// Aniqlik radius bilan cheklanadi — juda yomon GPS (masalan 5 km) har qanday masofani "yashirmasligi" uchun.

/** Yer o'rtacha radiusi, metr (SQL bilan bir xil konstanta). */
export const EARTH_RADIUS_M = 6_371_000

/** `objects.radius_m` standart qiymati. */
export const DEFAULT_SITE_RADIUS_M = 300

const toRad = (deg: number): number => (deg * Math.PI) / 180

/**
 * Haversine masofa, metr:
 * a = sin²(Δφ/2) + cos φ1 · cos φ2 · sin²(Δλ/2); d = 2R · asin(min(1, √a)).
 */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dPhi = toRad(lat2 - lat1)
  const dLambda = toRad(lng2 - lng1)
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLambda / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)))
}

/**
 * `private.geo_distance_m` — butun metrgacha yaxlitlangan masofa. Masofa ≥ 0, shuning uchun
 * `Math.round` (half up) PostgreSQL `round` (half away from zero) bilan bir xil.
 */
export function distanceMetersRounded(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return Math.round(distanceMeters(lat1, lng1, lat2, lng2))
}

type Coord = number | string | null | undefined

export interface SiteCheckInput {
  /** Obyekt koordinatalari (`objects.lat/lng`; numeric satr ham bo'ladi). */
  siteLat: Coord
  siteLng: Coord
  /** `objects.radius_m`; ≤ 0 yoki noto'g'ri → 0. */
  radiusM: number
  /** Yozuv joylashuvi (`geo_lat/geo_lng`). */
  lat: Coord
  lng: Coord
  /** `geo_accuracy_m`; null/manfiy → 0. */
  accuracyM?: number | null
}

function coord(v: Coord, max: number): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string' && v.trim() === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || Math.abs(n) > max) return null
  return n
}

function nonNeg(v: number | null | undefined): number {
  return v !== null && v !== undefined && Number.isFinite(v) && v > 0 ? v : 0
}

/**
 * true — `round(distance) > radius + min(accuracy, radius)` (chegaraga teng — ichida; radius va
 * aniqlik null/manfiy → 0). null — obyekt yoki yozuv koordinatasi yo'q/noto'g'ri (alert yo'q).
 */
export function isOutsideSite(p: SiteCheckInput): boolean | null {
  const sLat = coord(p.siteLat, 90)
  const sLng = coord(p.siteLng, 180)
  const lat = coord(p.lat, 90)
  const lng = coord(p.lng, 180)
  if (sLat === null || sLng === null || lat === null || lng === null) return null
  const radius = nonNeg(p.radiusM)
  const accuracy = Math.min(nonNeg(p.accuracyM), radius)
  return distanceMetersRounded(sLat, sLng, lat, lng) > radius + accuracy
}
