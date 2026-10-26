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
  super_admin: ALL_WEB,
  admin: ALL_WEB,
  direktor: ['dashboard', 'movements', 'purchases', 'cash', 'estimates', 'requests', 'alerts', 'history'],
  buxgalter: ['dashboard', 'materials', 'movements', 'purchases', 'cash', 'estimates', 'alerts'],
  taminotchi: ['dashboard', 'materials', 'purchases', 'requests'],
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

// docs/db-design.md kirish matritsasi asosida.
const EXPECTED_CAN: Record<Action, Role[]> = {
  manage_users: ['super_admin', 'admin'],
  manage_objects: ['super_admin', 'admin'],
  manage_catalog: ['super_admin', 'admin'],
  issue_cash: ['super_admin', 'admin', 'buxgalter'],
  create_purchase: ['super_admin', 'admin', 'taminotchi', 'prorab', 'haydovchi'],
  create_movement: ['super_admin', 'admin', 'prorab', 'omborchi'],
  create_request: ['super_admin', 'admin', 'prorab'],
  approve_request: ['super_admin', 'admin'],
  mark_request_purchased: ['super_admin', 'admin', 'taminotchi'],
  manage_transfers: ['super_admin', 'admin'],
  apply_inventory: ['super_admin', 'admin'],
  run_inventory: ['super_admin', 'admin', 'tekshiruvchi'],
  view_audit: ['super_admin', 'admin', 'direktor'],
  view_alerts: ['super_admin', 'admin', 'direktor', 'buxgalter'],
  manage_alerts: ['super_admin', 'admin'],
  restore_records: ['super_admin', 'admin'],
  manage_estimates: ['super_admin', 'admin', 'buxgalter'],
}

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
