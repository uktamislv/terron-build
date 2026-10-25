// Batch 12 (G): Telegram QR skaner (`showScanQrPopup`, Bot API 6.4+).
import { getWebApp } from './telegram'

interface TgQrApi {
  showScanQrPopup?(params: { text?: string }, callback?: (text: string) => boolean | void): void
  closeScanQrPopup?(): void
  onEvent?(event: string, handler: () => void): void
  offEvent?(event: string, handler: () => void): void
}

function qrApi(): TgQrApi | null {
  const app = getWebApp() as unknown as TgQrApi | null
  return app && typeof app.showScanQrPopup === 'function' ? app : null
}

/** Skaner mavjudmi (Telegram ichida, yangi versiya). */
export function canScanQr(): boolean {
  return qrApi() !== null
}

/** QR skanerini ochadi; o'qilgan matn yoki null (yopildi / mavjud emas). Birinchi natijada yopiladi. */
export function scanQr(text: string): Promise<string | null> {
  const app = qrApi()
  if (!app?.showScanQrPopup) return Promise.resolve(null)
  return new Promise((resolve) => {
    let done = false
    const finish = (value: string | null) => {
      if (done) return
      done = true
      app.offEvent?.('scanQrPopupClosed', onClosed)
      resolve(value)
    }
    const onClosed = () => finish(null)
    app.onEvent?.('scanQrPopupClosed', onClosed)
    app.showScanQrPopup?.({ text }, (data) => {
      finish(data)
      return true
    })
  })
}
