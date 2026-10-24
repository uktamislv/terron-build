// Telegram WebApp SDK ustidan yupqa qatlam. SDK index.html da yuklanadi.
// DIQQAT: initDataUnsafe faqat ko'rsatish uchun. Autentifikatsiya faqat tg-auth Edge Function'da
// initData (xom satr) HMAC orqali tekshirilgandan keyin.

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
  setHeaderColor(color: string): void
  setBackgroundColor(color: string): void
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

/** Mini App ochilganda bir marta: to'liq ekran va bizning ranglarimiz. */
export function initTelegram(): void {
  const app = getWebApp()
  if (!app) return
  app.ready()
  app.expand()
  app.setHeaderColor('#1E5EFF')
  app.setBackgroundColor('#FFFFFF')
  app.MainButton.setParams({ color: '#1E5EFF', text_color: '#FFFFFF' })
}

/** Xom initData — serverga (tg-auth) yuborish uchun. */
export function getInitData(): string {
  return getWebApp()?.initData ?? ''
}

export const haptic = {
  tap: () => getWebApp()?.HapticFeedback.impactOccurred('light'),
  success: () => getWebApp()?.HapticFeedback.notificationOccurred('success'),
  error: () => getWebApp()?.HapticFeedback.notificationOccurred('error'),
  select: () => getWebApp()?.HapticFeedback.selectionChanged(),
}
