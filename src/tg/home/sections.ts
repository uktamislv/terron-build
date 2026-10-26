// Bosh ekran "Bo'limlar" havolalari (sof): qo'shimcha bo'limlar va pastki menyuga sig'magan bandlar.
import { tgExtraFor, tgOverflowFor, type Role, type TgExtraKey, type TgNavKey } from '@/domain/roles'
import { t } from '@/i18n'
import { tgNavItems } from '../nav'

export interface SectionLink {
  key: TgExtraKey | TgNavKey
  to: string
  label: string
  hint?: string
}

const EXTRA: Record<TgExtraKey, Omit<SectionLink, 'key'>> = {
  stock: { to: '/tg/stock', label: t.tg.stock.title, hint: t.tg.stock.hint },
  approvals: { to: '/tg/approvals', label: t.tg.approvals.title, hint: t.tg.approvals.hint },
}

export function homeSectionLinks(role: Role): SectionLink[] {
  return [
    ...tgExtraFor(role).map((key): SectionLink => ({ key, ...EXTRA[key] })),
    ...tgOverflowFor(role).map((key): SectionLink => ({ key, to: tgNavItems[key].to, label: tgNavItems[key].label })),
  ]
}
