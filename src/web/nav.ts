import { webNavFor, type Role, type WebNavKey } from '@/domain/roles'
import { t } from '@/i18n'

export interface WebNavItem {
  key: WebNavKey
  to: string
  label: string
}

/** Barcha veb bo'limlari. Qaysi rol nimani ko'rishini `webNavFor` (src/domain/roles) hal qiladi. */
export const webNavItems: Record<WebNavKey, WebNavItem> = {
  dashboard: { key: 'dashboard', to: '/', label: t.web.nav.dashboard },
  materials: { key: 'materials', to: '/materials', label: t.web.nav.materials },
  movements: { key: 'movements', to: '/movements', label: t.web.nav.movements },
  purchases: { key: 'purchases', to: '/purchases', label: t.web.nav.purchases },
  cash: { key: 'cash', to: '/cash', label: t.web.nav.cash },
  estimates: { key: 'estimates', to: '/estimates', label: t.web.nav.estimates },
  requests: { key: 'requests', to: '/requests', label: t.web.nav.requests },
  alerts: { key: 'alerts', to: '/alerts', label: t.web.nav.alerts },
  history: { key: 'history', to: '/history', label: t.web.nav.history },
  users: { key: 'users', to: '/users', label: t.web.nav.users },
  objects: { key: 'objects', to: '/objects', label: t.web.nav.objects },
  settings: { key: 'settings', to: '/settings', label: t.web.nav.settings },
}

export function webNavForRole(role: Role): WebNavItem[] {
  return webNavFor(role).map((key) => webNavItems[key])
}
