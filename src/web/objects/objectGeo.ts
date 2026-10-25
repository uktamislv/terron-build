// Obyekt koordinatasi formasi (Batch 12, D) — sof funksiyalar. Koordinata `numeric(9,6)`, radius metr.
import { cmp, parseDec, round, scaleOf } from '@/domain/decimal'

/** Baza: `radius_m` 10..50000. */
export const RADIUS_MIN = 10
export const RADIUS_MAX = 50_000
export const DEFAULT_RADIUS_M = 300

export interface GeoFormValue {
  lat: string | null
  lng: string | null
  radiusM: number
}

export type GeoFormErrors = Partial<Record<'lat' | 'lng' | 'radius' | 'pair', true>>

function coord(input: string, limit: number): string | null | 'bad' {
  const s = input.trim().replace(',', '.')
  if (s === '') return null
  const d = parseDec(s)
  if (d === null || cmp(d, String(-limit)) < 0 || cmp(d, String(limit)) > 0) return 'bad'
  return scaleOf(d) > 6 ? round(d, 6) : d
}

/**
 * Kenglik −90…90, uzunlik −180…180 (6 kasrgacha yaxlitlanadi), ikkalasi birga yoki ikkalasi bo'sh;
 * radius 10…50 000 m butun son (bo'sh — 300).
 */
export function parseGeoForm(lat: string, lng: string, radius: string): { ok: true; value: GeoFormValue } | { ok: false; errors: GeoFormErrors } {
  const errors: GeoFormErrors = {}
  const la = coord(lat, 90)
  const ln = coord(lng, 180)
  if (la === 'bad') errors.lat = true
  if (ln === 'bad') errors.lng = true
  if (la !== 'bad' && ln !== 'bad' && (la === null) !== (ln === null)) errors.pair = true
  const r = radius.trim()
  const radiusM = r === '' ? DEFAULT_RADIUS_M : /^\d{1,6}$/.test(r) ? Number(r) : NaN
  if (!Number.isInteger(radiusM) || radiusM < RADIUS_MIN || radiusM > RADIUS_MAX) errors.radius = true
  if (Object.keys(errors).length > 0 || la === 'bad' || ln === 'bad') return { ok: false, errors }
  return { ok: true, value: { lat: la, lng: ln, radiusM } }
}

/** "41.311081, 69.240562" — xaritadan nusxa olingan juftlikni ikki maydonga ajratadi. */
export function splitCoordPair(text: string): { lat: string; lng: string } | null {
  const m = /^\s*(-?\d{1,3}(?:[.]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.]\d+)?)\s*$/.exec(text)
  return m && m[1] && m[2] ? { lat: m[1], lng: m[2] } : null
}
