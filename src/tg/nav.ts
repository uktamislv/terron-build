import { tgNavFor, type Role, type TgNavKey } from '@/domain/roles'
import { t } from '@/i18n'

export interface TgNavItem {
  key: TgNavKey
  to: string
  label: string
}

/** Mini App pastki menyu bandlari. Qaysi rol nimani ko'rishini `tgNavFor` hal qiladi. */
export const tgNavItems: Record<TgNavKey, TgNavItem> = {
  home: { key: 'home', to: '/tg', label: t.tg.nav.home },
  movement: { key: 'movement', to: '/tg/movement', label: t.tg.nav.movement },
  purchase: { key: 'purchase', to: '/tg/purchase', label: t.tg.nav.purchase },
  request: { key: 'request', to: '/tg/request', label: t.tg.nav.request },
  inventory: { key: 'inventory', to: '/tg/inventory', label: t.tg.nav.inventory },
  mine: { key: 'mine', to: '/tg/mine', label: t.tg.nav.mine },
}

export function tgNavForRole(role: Role): TgNavItem[] {
  return tgNavFor(role).map((key) => tgNavItems[key])
}
