// Batch 12 (J): Telegram "Ochish" havolasidan ogohlantirish id'si.
import type { Role } from '@/domain/roles'
import { isUuid } from '@/lib/uuid'

/**
 * Havolani ochadigan rollar — alertlarni RLS ko'rsatadiganlar. Prorab alertni ko'rmaydi: u havolani
 * ochsa — oddiy bosh ekran, xato panelisiz.
 */
export const ALERT_LINK_ROLES: readonly Role[] = ['direktor', 'admin', 'super_admin']

/** `?alert=<uuid>` yoki Telegram start_param `alert_<uuid>` / `alert-<uuid>`. Noto'g'ri — null. */
export function alertIdFrom(search: URLSearchParams, startParam: string | null | undefined): string | null {
  const q = search.get('alert')
  if (isUuid(q)) return q
  const m = /^alert[_-](.+)$/.exec(startParam ?? '')
  return m && isUuid(m[1]) ? m[1] : null
}

