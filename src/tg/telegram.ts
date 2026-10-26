// Telegram WebApp SDK ustidan yupqa qatlam. SDK index.html da yuklanadi.
// DIQQAT: initDataUnsafe faqat ko'rsatish uchun. Autentifikatsiya faqat tg-auth Edge Function'da
// initData (xom satr) HMAC orqali tekshirilgandan keyin.
import { colors } from '@/components/ui/tokens'

interface TgButton {
  setText(text: string): TgButton
  show(): TgButton
  hide(): TgButton
  enable(): TgButton
  disable(): TgButton
  showProgress(leaveActive?: boolean): TgButton
  hideProgress(): TgButton
  onClick(cb: () => void): TgButton
  offClick(cb: () => void): TgButton
  setParams(params: { color?: string; text_color?: string; is_active?: boolean; is_visible?: boolean }): TgButton
}

interface TgBackButton {
  show(): void
  hide(): void
  onClick(cb: () => void): void
  offClick(cb: () => void): void
}

interface TgWebApp {
  initData: string
  initDataUnsafe: { user?: { id: number; first_name?: string; last_name?: string; username?: string } }
  platform: string
  version: string
  ready(): void
  expand(): void
  close(): void
  /** Bot API 6.1+: tashqi havolani brauzerda ochish. */
  openLink?(url: string): void
  setHeaderColor(color: string): void
  setBackgroundColor(color: string): void
  /** Bot API 7.10+. */
  setBottomBarColor?(color: string): void
  /** Bot API 7.7+. Pastga surib yopishni o'chiradi (uzun formalar aylantirilganda yopilib qolmasin). */
  disableVerticalSwipes?(): void
  /** Bot API 6.2+. Yopishdan oldin tasdiq so'rash (to'ldirilgan qoralama yo'qolmasin). */
  enableClosingConfirmation?(): void
  disableClosingConfirmation?(): void
  isVersionAtLeast?(version: string): boolean
  /** Bot API 6.9+. Kontakt bot'ga xabar sifatida yuboriladi — callback raqamni bermaydi. */
  requestContact?(callback?: (shared: boolean) => void): void
  MainButton: TgButton
  BackButton: TgBackButton
  HapticFeedback: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void
    notificationOccurred(type: 'error' | 'success' | 'warning'): void
    selectionChanged(): void
  }
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp }
  }
}

export function getWebApp(): TgWebApp | null {
  const app = window.Telegram?.WebApp
  // SDK brauzerda ham yuklanadi, lekin Telegram tashqarisida initData bo'sh bo'ladi
  return app && app.initData ? app : null
}

export function isInsideTelegram(): boolean {
  return getWebApp() !== null
}

/** Telegram klienti shu Bot API versiyasini qo'llaydimi (eski klientlarda metod chaqirilsa xato chiqadi). */
export function supportsVersion(app: Pick<TgWebApp, 'isVersionAtLeast'>, version: string): boolean {
  try {
    return app.isVersionAtLeast?.(version) ?? false
  } catch {
    return false
  }
}

/**
 * Mini App ochilganda bir marta: to'liq ekran va bizning ranglarimiz (Telegram mavzusiga emas).
 * Har bir metod versiya bo'yicha tekshiriladi — eski klientda chaqirilsa SDK ogohlantiradi yoki xato beradi.
 */
export function initTelegram(): void {
  const app = getWebApp()
  if (!app) return
  app.ready()
  app.expand()
  if (supportsVersion(app, '6.1')) {
    // Sarlavha paneli — sahifa foni bilan bir xil (ilova ichidagi sarlavha shu fonda turadi)
    app.setHeaderColor(colors.canvas)
    app.setBackgroundColor(colors.canvas)
  }
  if (supportsVersion(app, '7.10')) app.setBottomBarColor?.(colors.paper)
  if (supportsVersion(app, '7.7')) app.disableVerticalSwipes?.()
  app.MainButton.setParams({ color: colors.brand, text_color: colors.paper })
}

/** Mini App'ni yopish (Telegram tashqarisida — hech narsa qilmaydi). */
export function closeApp(): void {
  getWebApp()?.close()
}

/** Tashqi havolani ochish: Telegram ichida — tizim brauzerida (openLink), tashqarida — yangi oynada. */
export function openExternalLink(url: string): void {
  const app = getWebApp()
  if (app?.openLink && supportsVersion(app, '6.1')) {
    app.openLink(url)
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** Xom initData — serverga (tg-auth) yuborish uchun. */
export function getInitData(): string {
  return getWebApp()?.initData ?? ''
}

/**
 * Foydalanuvchidan telefon raqamini bot'ga ulashishni so'raydi.
 * `true` — ulashdi, `false` — rad etdi yoki imkoniyat yo'q. Raqam serverda (tg-bot) tekshiriladi.
 */
export function requestContact(): Promise<boolean> {
  const app = getWebApp()
  if (!app?.requestContact) return Promise.resolve(false)
  return new Promise((resolve) => {
    app.requestContact?.((shared) => resolve(Boolean(shared)))
  })
}

/**
 * Telegram ishga tushirish parametrlarini (`#tgWebAppData=...`) URL'dan olib tashlaydi — initData
 * tarix/skrinshot/havola orqali tarqalmasin. SDK ularni yuklanishda (index.html, ilovadan oldin)
 * o'qib bo'lgan va sessionStorage'da saqlaydi, shuning uchun getInitData() ishlashda davom etadi.
 */
export function stripLaunchParamsFromUrl(): void {
  const { hash, pathname, search } = window.location
  if (!hash.includes('tgWebApp')) return
  window.history.replaceState(window.history.state, '', pathname + search)
}

/** Bot havolasi — Telegram tashqarisida ochilganda ko'rsatiladi. */
export function botLink(username: string | undefined = import.meta.env.VITE_TELEGRAM_BOT_USERNAME): string {
  const name = (username ?? '').replace(/^@/, '').trim()
  return name ? `https://t.me/${name}` : 'https://t.me/'
}

export const haptic = {
  tap: () => getWebApp()?.HapticFeedback.impactOccurred('light'),
  success: () => getWebApp()?.HapticFeedback.notificationOccurred('success'),
  error: () => getWebApp()?.HapticFeedback.notificationOccurred('error'),
  select: () => getWebApp()?.HapticFeedback.selectionChanged(),
}
