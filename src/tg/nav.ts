import { tgBottomNavFor, tgNavFor, type Role, type TgNavKey } from '@/domain/roles'
import { t } from '@/i18n'

export interface TgNavItem {
  key: TgNavKey
  to: string
  label: string
  /** Pastki menyudagi qisqa yorliq (bir qatorda). */
  shortLabel: string
}

/** Mini App pastki menyu bandlari. Qaysi rol nimani ko'rishini `tgNavFor` hal qiladi. */
export const tgNavItems: Record<TgNavKey, TgNavItem> = {
  home: { key: 'home', to: '/tg', label: t.tg.nav.home, shortLabel: t.tg.navShort.home ?? t.tg.nav.home },
  movement: { key: 'movement', to: '/tg/movement', label: t.tg.nav.movement, shortLabel: t.tg.navShort.movement ?? t.tg.nav.movement },
  purchase: { key: 'purchase', to: '/tg/purchase', label: t.tg.nav.purchase, shortLabel: t.tg.navShort.purchase ?? t.tg.nav.purchase },
  request: { key: 'request', to: '/tg/request', label: t.tg.nav.request, shortLabel: t.tg.navShort.request ?? t.tg.nav.request },
  inventory: { key: 'inventory', to: '/tg/inventory', label: t.tg.nav.inventory, shortLabel: t.tg.navShort.inventory ?? t.tg.nav.inventory },
  mine: { key: 'mine', to: '/tg/mine', label: t.tg.nav.mine, shortLabel: t.tg.navShort.mine ?? t.tg.nav.mine },
}

/** Rolga ochiq barcha bandlar (ruxsat tekshiruvi). */
export function tgNavForRole(role: Role): TgNavItem[] {
  return tgNavFor(role).map((key) => tgNavItems[key])
}

/** Pastki menyu (≤ 5 band). */
export function tgBottomNavForRole(role: Role): TgNavItem[] {
  return tgBottomNavFor(role).map((key) => tgNavItems[key])
}
