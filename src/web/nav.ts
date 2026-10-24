import { t } from '@/i18n'

// Rolga qarab filtrlash Batch 2 da qo'shiladi
export const webNav = [
  { to: '/', label: t.web.nav.dashboard },
  { to: '/materials', label: t.web.nav.materials },
  { to: '/movements', label: t.web.nav.movements },
  { to: '/purchases', label: t.web.nav.purchases },
  { to: '/cash', label: t.web.nav.cash },
  { to: '/estimates', label: t.web.nav.estimates },
  { to: '/requests', label: t.web.nav.requests },
  { to: '/alerts', label: t.web.nav.alerts },
  { to: '/history', label: t.web.nav.history },
  { to: '/users', label: t.web.nav.users },
] as const
