// Batch 12 (J): Telegram "Ochish" havolasidan ogohlantirish id'si.
import type { Role } from '@/domain/roles'
import { isUuid } from '@/lib/uuid'

/**
 * Havolani ochadigan rollar — barcha alertlarni RLS ko'rsatadiganlar ("topilmadi" xabari bilan).
 */
export const ALERT_LINK_ROLES: readonly Role[] = ['direktor', 'admin', 'super_admin']

/**
 * Obyekt a'zolari (docs/audit-fixes.md D3): RLS faqat a'zo obyektlarining ayrim turlarini ko'rsatadi
 * (`SITE_ALERT_TYPES`). Havola yuklab ko'riladi; RLS hech narsa bermasa — jimgina oddiy bosh ekran.
 */
export const SITE_ALERT_LINK_ROLES: readonly Role[] = ['prorab', 'omborchi']

/** Havola rejimi: `full` — topilmasa xabar; `site` — topilmasa yoki xato bo'lsa ko'rsatilmaydi; null — ochilmaydi. */
export function alertLinkMode(role: Role): 'full' | 'site' | null {
  if (ALERT_LINK_ROLES.includes(role)) return 'full'
  if (SITE_ALERT_LINK_ROLES.includes(role)) return 'site'
  return null
}

/** `?alert=<uuid>` yoki Telegram start_param `alert_<uuid>` / `alert-<uuid>`. Noto'g'ri — null. */
export function alertIdFrom(search: URLSearchParams, startParam: string | null | undefined): string | null {
  const q = search.get('alert')
  if (isUuid(q)) return q
  const m = /^alert[_-](.+)$/.exec(startParam ?? '')
  return m && isUuid(m[1]) ? m[1] : null
}

