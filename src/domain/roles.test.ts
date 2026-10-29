import { describe, expect, it } from 'vitest'
import {
  ROLES,
  TG_BOTTOM_MAX,
  can,
  isProtectedProfile,
  isRole,
  tgBottomNavFor,
  tgExtraFor,
  tgNavFor,
  tgOverflowFor,
  webNavFor,
  type Action,
  type Role,
  type TgNavKey,
  type WebNavKey,
} from './roles'
import { SITE_ALERT_TYPES } from '@/data/alertsRepo'
import { ACTION_ROLES, ACTION_SOURCE, dbRolesFor, MATRIX_ROLES, SITE_ALERT_TYPES_BY_ROLE, sortRoles } from '@/test/roleMatrix'

// docs/auth-design.md "Rollar va menyu" jadvali — aynan ko'chirma.
const ALL_WEB: WebNavKey[] = [
  'dashboard',
  'materials',
  'movements',
  'purchases',
  'cash',
  'estimates',
  'requests',
  'alerts',
  'history',
  'users',
  'objects',
  'settings',
]

const EXPECTED_WEB: Record<Role, WebNavKey[]> = {
  // Audit 3: "Firmalar" — faqat tizim egasi
  super_admin: [...ALL_WEB, 'companies'],
  admin: ALL_WEB,
  direktor: ['dashboard', 'movements', 'purchases', 'cash', 'estimates', 'requests', 'alerts', 'history'],
  buxgalter: ['dashboard', 'materials', 'movements', 'purchases', 'cash', 'estimates', 'alerts'],
  taminotchi: ['dashboard', 'materials', 'purchases', 'cash', 'requests'],
  // Audit: prorab smetani (faqat ko'rish) va norma sarfini ko'radi
  prorab: ['dashboard', 'movements', 'estimates', 'requests'],
  omborchi: ['dashboard', 'movements'],
  haydovchi: [],
  tekshiruvchi: ['dashboard'],
}

const EXPECTED_TG: Record<Role, TgNavKey[]> = {
  // Audit: admin Telegram ilovasida so'rov ham yarata oladi
  super_admin: ['home', 'movement', 'purchase', 'request', 'inventory', 'mine'],
  admin: ['home', 'movement', 'purchase', 'request', 'inventory', 'mine'],
  direktor: ['home', 'mine'],
  buxgalter: ['mine'],
  taminotchi: ['purchase', 'mine'],
  prorab: ['home', 'movement', 'purchase', 'request', 'mine'],
  omborchi: ['home', 'movement', 'mine'],
  haydovchi: ['purchase', 'mine'],
  tekshiruvchi: ['inventory', 'mine'],
}

// Yagona matritsa (src/test/roleMatrix.ts) — SQL rol matritsasi testi ham shuni ishlatadi.
const EXPECTED_CAN: Record<Action, readonly Role[]> = ACTION_ROLES

describe('ROLES / isRole', () => {
  it("bazadagi user_role enum bilan bir xil (tartib bilan)", () => {
    expect([...ROLES]).toEqual([
      'super_admin',
      'admin',
      'direktor',
      'buxgalter',
      'taminotchi',
      'prorab',
      'omborchi',
      'haydovchi',
      'tekshiruvchi',
    ])
  })
  it("o'zgartirib bo'lmaydi", () => {
    expect(Object.isFrozen(ROLES)).toBe(true)
  })
  it.each(ROLES)('%s — rol', (r) => expect(isRole(r)).toBe(true))
  it.each([undefined, null, '', 'Admin', 'ADMIN', ' admin', 'user', 'superadmin', 1, {}, ['admin']])(
    '%j — rol emas',
    (x) => expect(isRole(x)).toBe(false),
  )
})

describe('webNavFor', () => {
  it.each(ROLES)('%s — jadval bilan aynan mos', (role) => {
    expect(webNavFor(role)).toEqual(EXPECTED_WEB[role])
  })
  it('har chaqiriqda yangi massiv (tashqaridan buzib bo\'lmaydi)', () => {
    const a = webNavFor('admin')
    a.pop()
    expect(webNavFor('admin')).toEqual(ALL_WEB)
  })
  it('companies faqat super_admin da', () => {
    for (const role of ROLES) expect(webNavFor(role).includes('companies')).toBe(role === 'super_admin')
  })
  it('users va objects faqat admin/super_admin da', () => {
    for (const role of ROLES) {
      const nav = webNavFor(role)
      const isAdmin = role === 'admin' || role === 'super_admin'
      expect(nav.includes('users')).toBe(isAdmin)
      expect(nav.includes('objects')).toBe(isAdmin)
    }
  })
})

describe('tgNavFor', () => {
  it.each(ROLES)('%s — jadval bilan aynan mos', (role) => {
    expect(tgNavFor(role)).toEqual(EXPECTED_TG[role])
  })
  it("hamma rolda 'mine' bor va oxirida", () => {
    for (const role of ROLES) expect(tgNavFor(role).at(-1)).toBe('mine')
  })
})

describe('tgBottomNavFor / tgOverflowFor / tgExtraFor', () => {
  it.each(ROLES)('%s — pastki menyu ≤ 5, hammasi ochiq bandlar ichida, sig‘maganlari bosh ekranda', (role) => {
    const bottom = tgBottomNavFor(role)
    const overflow = tgOverflowFor(role)
    expect(bottom.length).toBeLessThanOrEqual(TG_BOTTOM_MAX)
    expect([...bottom, ...overflow].sort()).toEqual(tgNavFor(role).sort())
    // Sig'magan band bo'lsa — "Bosh" bor (u yerdan ochiladi)
    if (overflow.length > 0) expect(bottom).toContain('home')
  })
  it('admin: "Sanash" pastki menyudan bosh ekranga o‘tadi, "So‘rov" pastda', () => {
    expect(tgBottomNavFor('admin')).toEqual(['home', 'movement', 'purchase', 'request', 'mine'])
    expect(tgOverflowFor('admin')).toEqual(['inventory'])
  })
  it('prorab, omborchi — o‘zgarmagan pastki menyu', () => {
    expect(tgBottomNavFor('prorab')).toEqual(tgNavFor('prorab'))
    expect(tgOverflowFor('omborchi')).toEqual([])
  })
  it('qo‘shimcha bo‘limlar: Qoldiq — prorab, omborchi, admin; Tasdiqlash — admin', () => {
    expect(tgExtraFor('prorab')).toEqual(['stock'])
    expect(tgExtraFor('omborchi')).toEqual(['stock'])
    expect(tgExtraFor('admin')).toEqual(['stock', 'approvals'])
    // Ko'r-ko'rona sanash — tekshiruvchi qoldiqni ko'rmaydi
    expect(tgExtraFor('tekshiruvchi')).toEqual([])
    expect(tgExtraFor('haydovchi')).toEqual([])
  })
  it('buxgalter: faqat "Yozuvlarim" (pul yozuvlari bilan)', () => {
    expect(tgNavFor('buxgalter')).toEqual(['mine'])
  })
})

describe('isProtectedProfile (profile_protected)', () => {
  it('admin — admin va direktor profillari himoyalangan (o‘zinikini ham)', () => {
    expect(isProtectedProfile('admin', 'admin')).toBe(true)
    expect(isProtectedProfile('admin', 'direktor')).toBe(true)
    expect(isProtectedProfile('admin', 'prorab')).toBe(false)
  })
  it('super_admin — cheklovsiz', () => {
    expect(isProtectedProfile('super_admin', 'admin')).toBe(false)
    expect(isProtectedProfile('super_admin', 'direktor')).toBe(false)
  })
})

describe('can', () => {
  const actions = Object.keys(EXPECTED_CAN) as Action[]
  for (const action of actions) {
    it.each(ROLES)(`${action} — %s`, (role) => {
      expect(can(role, action)).toBe(EXPECTED_CAN[action].includes(role))
    })
  }
  it("direktor hech narsa yarata olmaydi (faqat ko'rish)", () => {
    for (const action of actions.filter((a) => a !== 'view_audit' && a !== 'view_alerts')) expect(can('direktor', action)).toBe(false)
  })
  it("noma'lum action → false", () => {
    expect(can('admin', 'drop_db' as Action)).toBe(false)
  })
})

describe('Batch 8: ko‘r-ko‘rona sanash', () => {
  it('tekshiruvchi veb’da ombor (qoldiq/harakatlar) ni ko‘rmaydi — faqat Bosh', () => {
    expect(webNavFor('tekshiruvchi')).toEqual(['dashboard'])
  })
  it('so‘rovni faqat admin tasdiqlaydi; ta‘minotchi — faqat "Xarid qilindi"', () => {
    expect(can('taminotchi', 'approve_request')).toBe(false)
    expect(can('taminotchi', 'mark_request_purchased')).toBe(true)
    expect(can('admin', 'approve_request')).toBe(true)
  })
})

describe('yagona rol matritsasi (src/test/roleMatrix.ts) — UI va baza bir xil', () => {
  it('MATRIX_ROLES === ROLES', () => {
    expect([...MATRIX_ROLES]).toEqual([...ROLES])
  })
  it('har bir Action matritsada bor va baza manbasi ko‘rsatilgan', () => {
    const actions = Object.keys(ACTION_ROLES).sort()
    expect(Object.keys(ACTION_SOURCE).sort()).toEqual(actions)
  })
  it.each(Object.keys(ACTION_ROLES) as Action[])('%s: UI rollari === baza huquqi rollari (ACTION_SOURCE)', (action) => {
    expect(sortRoles(ACTION_ROLES[action])).toEqual(sortRoles(dbRolesFor(action)))
  })
})

describe('sayt alertlari (alerts_select_site) — repo bilan bir xil', () => {
  it('prorab ko‘radigan turlar === SITE_ALERT_TYPES (listSiteAlerts filtri)', () => {
    expect([...(SITE_ALERT_TYPES_BY_ROLE.prorab ?? [])].sort()).toEqual([...SITE_ALERT_TYPES].sort())
  })
  it('omborchi turlari prorab turlarining qismi; boshqa rollarda sayt alerti yo‘q', () => {
    for (const t of SITE_ALERT_TYPES_BY_ROLE.omborchi ?? []) expect(SITE_ALERT_TYPES).toContain(t)
    expect(Object.keys(SITE_ALERT_TYPES_BY_ROLE).sort()).toEqual(['omborchi', 'prorab'])
  })
})
