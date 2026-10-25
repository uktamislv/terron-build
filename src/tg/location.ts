// Batch 12 (D): yozuv paytidagi joylashuv. Telegram LocationManager (Bot API 8.0), bo'lmasa
// navigator.geolocation. Saqlashni HECH QACHON to'xtatmaydi: eng ko'pi 3 s kutadi, keyin `unavailable`.
import type { GeoFix } from '@/data/types'
import { getWebApp } from './telegram'

export const LOCATION_TIMEOUT_MS = 3000

interface TgLocationData {
  latitude: number
  longitude: number
  horizontal_accuracy?: number | null
}

interface TgLocationManager {
  isInited: boolean
  isLocationAvailable: boolean
  isAccessRequested: boolean
  isAccessGranted: boolean
  init(callback?: () => void): void
  getLocation(callback: (data: TgLocationData | null) => void): void
}

function locationManager(): TgLocationManager | null {
  const app = getWebApp() as unknown as { LocationManager?: TgLocationManager } | null
  return app?.LocationManager ?? null
}

/** Koordinata → Dec satr (6 kasr xona — `numeric(9,6)`). */
export function coordText(value: number): string {
  return value.toFixed(6)
}

function fix(lat: number, lng: number, accuracy: number | null | undefined): GeoFix {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { status: 'unavailable' }
  }
  const out: GeoFix = { status: 'ok', lat: coordText(lat), lng: coordText(lng) }
  if (typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0) out.accuracyM = Math.round(accuracy)
  return out
}

function fromTelegram(lm: TgLocationManager): Promise<GeoFix> {
  return new Promise((resolve) => {
    const read = () => {
      if (!lm.isLocationAvailable) {
        resolve({ status: 'unavailable' })
        return
      }
      lm.getLocation((data) => {
        if (data) resolve(fix(data.latitude, data.longitude, data.horizontal_accuracy))
        else resolve({ status: lm.isAccessRequested && !lm.isAccessGranted ? 'denied' : 'unavailable' })
      })
    }
    if (lm.isInited) read()
    else lm.init(read)
  })
}

function fromBrowser(): Promise<GeoFix> {
  const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined
  if (!geo) return Promise.resolve({ status: 'unavailable' })
  return new Promise((resolve) => {
    geo.getCurrentPosition(
      (pos) => resolve(fix(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy)),
      (err) => resolve({ status: err.code === 1 ? 'denied' : 'unavailable' }),
      { enableHighAccuracy: true, timeout: LOCATION_TIMEOUT_MS, maximumAge: 60_000 },
    )
  })
}

/** Joriy joylashuv; `timeoutMs` dan keyin — `unavailable`. Hech qachon xato tashlamaydi. */
export function captureLocation(timeoutMs = LOCATION_TIMEOUT_MS): Promise<GeoFix> {
  let source: Promise<GeoFix>
  try {
    const lm = locationManager()
    source = lm ? fromTelegram(lm) : fromBrowser()
  } catch {
    source = Promise.resolve({ status: 'unavailable' })
  }
  const timeout = new Promise<GeoFix>((resolve) => setTimeout(() => resolve({ status: 'unavailable' }), timeoutMs))
  return Promise.race([source.catch((): GeoFix => ({ status: 'unavailable' })), timeout])
}
