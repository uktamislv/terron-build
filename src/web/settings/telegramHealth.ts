// Telegram xabarlari holati — sof baholash (notification_health natijasi bo'yicha).
import type { NotificationHealth } from '@/data/companiesRepo'
import { t } from '@/i18n'

export type HealthLevel = 'ok' | 'warn' | 'danger'

/**
 * Umumiy holat: navbatda tiqilib qolgan xabar bor — `danger` (bot ishlamayapti); 7 kunda xato yoki
 * botni bloklaganlar bor — `warn`; aks holda `ok`. Hali hech narsa yuborilmagan bo'lsa ham `ok`
 * (yangi firma) — faqat xato belgilari muammo hisoblanadi.
 */
export function healthLevel(h: NotificationHealth): HealthLevel {
  if (h.stuckPendingCount > 0) return 'danger'
  if (h.failed7dCount > 0 || h.blockedProfiles.length > 0) return 'warn'
  return 'ok'
}

/** Sozlash skriptini qayta ishga tushirish maslahati kerakmi (tiqilish yoki yuborish xatolari). */
export function needsSetupHint(h: NotificationHealth): boolean {
  return h.stuckPendingCount > 0 || h.failed7dCount > 0
}

/** Xabar turi — o'zbekcha (noma'lum tur xom ko'rsatilmaydi). */
export function kindLabel(kind: string): string {
  return t.settings.health.kinds[kind] ?? t.settings.health.kindOther
}

/** Yuborish holati — o'zbekcha. */
export function statusLabel(status: string): string {
  return t.settings.health.statuses[status] ?? t.settings.health.statusOther
}
