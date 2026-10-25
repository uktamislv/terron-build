import { describe, expect, it } from 'vitest'
import { distanceMeters, distanceMetersRounded, isOutsideSite, type SiteCheckInput } from './geo'

// Toshkent, Amir Temur xiyoboni atrofi
const LAT = 41.311081
const LNG = 69.279737
/** 1 metr kenglik bo'yicha, gradus (R = 6371000). */
const M_PER_DEG = (Math.PI / 180) * 6_371_000

describe('distanceMeters', () => {
  it('bir nuqta → 0', () => {
    expect(distanceMeters(LAT, LNG, LAT, LNG)).toBe(0)
  })
  it('meridian bo\'yicha 1 gradus ≈ 111 195 m', () => {
    expect(distanceMeters(0, 0, 1, 0)).toBeCloseTo(111_194.93, 1)
  })
  it('simmetrik', () => {
    const a = distanceMeters(LAT, LNG, 41.3, 69.3)
    expect(distanceMeters(41.3, 69.3, LAT, LNG)).toBeCloseTo(a, 9)
  })
  it('Toshkent → Samarqand ≈ 270 km', () => {
    const d = distanceMeters(41.311081, 69.279737, 39.654167, 66.959722)
    expect(d).toBeGreaterThan(265_000)
    expect(d).toBeLessThan(275_000)
  })
  it('qarama-qarshi nuqtalar — NaN emas (asin min(1, …))', () => {
    expect(distanceMeters(0, 0, 0, 180)).toBeCloseTo(Math.PI * 6_371_000, 0)
  })
  it('kenglik bo\'yicha 300 m', () => {
    expect(distanceMeters(LAT, LNG, LAT + 300 / M_PER_DEG, LNG)).toBeCloseTo(300, 6)
  })
})

describe('distanceMetersRounded', () => {
  it('butun metr (private.geo_distance_m)', () => {
    expect(distanceMetersRounded(LAT, LNG, LAT + 300.4 / M_PER_DEG, LNG)).toBe(300)
    expect(distanceMetersRounded(LAT, LNG, LAT + 300.6 / M_PER_DEG, LNG)).toBe(301)
    expect(distanceMetersRounded(0, 0, 1, 0)).toBe(111_195)
    expect(distanceMetersRounded(LAT, LNG, LAT, LNG)).toBe(0)
  })
  it('numeric(9,6) koordinatalar bilan (bazadagi kabi)', () => {
    expect(distanceMetersRounded(41.311081, 69.279737, 41.32, 69.279737)).toBe(992)
  })
})

describe('isOutsideSite', () => {
  const base: SiteCheckInput = { siteLat: LAT, siteLng: LNG, radiusM: 300, lat: LAT, lng: LNG, accuracyM: 20 }
  const north = (m: number): number => LAT + m / M_PER_DEG
  it('obyekt ichida → false', () => {
    expect(isOutsideSite(base)).toBe(false)
  })
  it('radius + aniqlik ichida → false; tashqarida → true', () => {
    expect(isOutsideSite({ ...base, lat: north(319) })).toBe(false)
    expect(isOutsideSite({ ...base, lat: north(321) })).toBe(true)
  })
  it('aniqlik null/manfiy → 0', () => {
    expect(isOutsideSite({ ...base, lat: north(310), accuracyM: null })).toBe(true)
    expect(isOutsideSite({ ...base, lat: north(310), accuracyM: -50 })).toBe(true)
    expect(isOutsideSite({ ...base, lat: north(290), accuracyM: undefined })).toBe(false)
  })
  it('parity: aniqlik radius bilan cheklanadi — least(accuracy, radius)', () => {
    // radius 300, aniqlik 800 → samarali 300 → chegara 600 m
    expect(isOutsideSite({ ...base, lat: north(1000), accuracyM: 800 })).toBe(true)
    expect(isOutsideSite({ ...base, lat: north(600), accuracyM: 800 })).toBe(false)
    expect(isOutsideSite({ ...base, lat: north(601), accuracyM: 800 })).toBe(true)
    // aniqlik = radius — chegara 2 × radius
    expect(isOutsideSite({ ...base, lat: north(600), accuracyM: 300 })).toBe(false)
  })
  it('parity: masofa butun metrga yaxlitlanib solishtiriladi', () => {
    // chegara 320 m: 320.4 → 320 (ichida), 320.6 → 321 (tashqarida)
    expect(isOutsideSite({ ...base, lat: north(320.4) })).toBe(false)
    expect(isOutsideSite({ ...base, lat: north(320.6) })).toBe(true)
    // 320.5 → 321 (half up, masofa ≥ 0 — PG round bilan bir xil)
    expect(isOutsideSite({ ...base, lat: north(320.5001) })).toBe(true)
  })
  it('numeric satr koordinatalar', () => {
    expect(isOutsideSite({ ...base, siteLat: '41.311081', siteLng: '69.279737', lat: '41.320000', lng: '69.279737' })).toBe(true)
  })
  it('koordinata yo\'q yoki noto\'g\'ri → null', () => {
    expect(isOutsideSite({ ...base, siteLat: null })).toBeNull()
    expect(isOutsideSite({ ...base, siteLng: undefined })).toBeNull()
    expect(isOutsideSite({ ...base, lat: null })).toBeNull()
    expect(isOutsideSite({ ...base, lng: '' })).toBeNull()
    expect(isOutsideSite({ ...base, lat: 'abc' })).toBeNull()
    expect(isOutsideSite({ ...base, lat: 91 })).toBeNull()
    expect(isOutsideSite({ ...base, lng: -181 })).toBeNull()
    expect(isOutsideSite({ ...base, lat: Number.NaN })).toBeNull()
  })
  it('radius 0 → aniqlik ham 0 (least), 0.5 m dan uzoq — tashqarida', () => {
    expect(isOutsideSite({ ...base, radiusM: 0, lat: north(4), accuracyM: 5 })).toBe(true)
    expect(isOutsideSite({ ...base, radiusM: 0, lat: north(0.4), accuracyM: 5 })).toBe(false)
  })
  it('radius manfiy/NaN → 0', () => {
    expect(isOutsideSite({ ...base, radiusM: -10, lat: north(4), accuracyM: 5 })).toBe(true)
    expect(isOutsideSite({ ...base, radiusM: Number.NaN, lat: north(4), accuracyM: 5 })).toBe(true)
  })
})
