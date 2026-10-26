// ============================================================================
// Batch 1 SQL testlari uchun umumiy fixture: ikki firma (A, B), har birida
// har rol, 3 obyekt, katalog va har bir operatsion jadvalda yorliqli qatorlar.
// Barcha qatorlar superuser (postgres) sifatida, RLS'siz yaratiladi.
// ============================================================================

import {
  addObjectMember,
  createCompany,
  createMaterial,
  createObject,
  createUser,
  insertRow,
  type Db,
  type Queryable,
  type TestUser,
  type UserRole,
} from './_harness'

export const ROLES: UserRole[] = [
  'super_admin',
  'admin',
  'direktor',
  'buxgalter',
  'taminotchi',
  'prorab',
  'omborchi',
  'haydovchi',
  'tekshiruvchi',
]

/** Barcha biznes jadvallari (audit trigger ulangan). */
export const BUSINESS_TABLES = [
  'companies',
  'profiles',
  'objects',
  'object_members',
  'materials',
  'material_units',
  'material_aliases',
  'suppliers',
  'cash_advances',
  'purchases',
  'transfers',
  'inventory_counts',
  'inventory_count_items',
  'estimates',
  'estimate_items',
  'estimate_import_templates',
  'material_requests',
  'movements',
  'alerts',
] as const
export type BusinessTable = (typeof BUSINESS_TABLES)[number]

/**
 * Tizim jadvallari (public): firma ustuni va vaqt ustunlari bor, lekin audit trigger,
 * created_by va soft delete yo'q; yozuvchi — faqat security definer funksiyalar.
 * DELETE / TRUNCATE baribir bloklangan.
 */
export const SYSTEM_TABLES = ['notification_outbox'] as const
export type SystemTable = (typeof SYSTEM_TABLES)[number]

/**
 * Biznes jadvallari + audit_log + view'lar (stock_balances, estimate_totals, profile_directory).
 * Anon / boshqa firma / nofaol profil "hech narsa ko'rmaydi" tekshiruvlari shu ro'yxat bo'yicha.
 */
export const ALL_RELATIONS = [
  ...BUSINESS_TABLES,
  'audit_log',
  'stock_balances',
  'estimate_totals',
  'profile_directory',
] as const
export type Relation = (typeof ALL_RELATIONS)[number]

/** Jadvaldagi firma ustuni (`companies` da — `id`). */
export const companyCol = (t: Relation): string => (t === 'companies' ? 'id' : 'company_id')

export interface CompanyFixture {
  id: string
  users: Record<UserRole, TestUser>
  /** Yorliq → qator id. */
  ids: Record<string, string>
}

let phoneSeq = 0
const phone = (): string => `+99893${String(1_000_000 + ++phoneSeq).slice(-7)}`

async function ins(db: Db, table: string, values: Record<string, unknown>): Promise<string> {
  const r = await insertRow<{ id: string }>(db, table, values)
  return r.id
}

/**
 * Firma: har rol uchun foydalanuvchi; obj1 (prorab, omborchi, haydovchi a'zo), obj2, obj3;
 * m1, m2 materiallar; har jadvalda yorliqli qatorlar.
 */
export async function buildCompany(db: Db, name: string): Promise<CompanyFixture> {
  const id = await createCompany(db, { name })
  const users = {} as Record<UserRole, TestUser>
  for (const role of ROLES) {
    users[role] = await createUser(db, { companyId: id, role, phone: phone(), fullName: `${name} ${role}` })
  }
  const c = id
  const P = (r: UserRole): string => users[r].profileId
  const ids: Record<string, string> = {}

  ids.obj1 = await createObject(db, { companyId: c, name: `${name} obj1` })
  ids.obj2 = await createObject(db, { companyId: c, name: `${name} obj2` })
  ids.obj3 = await createObject(db, { companyId: c, name: `${name} obj3` })
  ids.mem_prorab = await addObjectMember(db, { companyId: c, objectId: ids.obj1, profileId: P('prorab') })
  ids.mem_omborchi = await addObjectMember(db, { companyId: c, objectId: ids.obj1, profileId: P('omborchi') })
  ids.mem_haydovchi = await addObjectMember(db, { companyId: c, objectId: ids.obj1, profileId: P('haydovchi') })

  ids.m1 = await createMaterial(db, { companyId: c, name: `${name} sement`, baseUnit: 'kg' })
  ids.m2 = await createMaterial(db, { companyId: c, name: `${name} qum`, baseUnit: 'm³' })
  ids.u1 = await ins(db, 'material_units', { company_id: c, material_id: ids.m1, unit: 'qop', factor: 50 })
  ids.al1 = await ins(db, 'material_aliases', { company_id: c, material_id: ids.m1, alias: `${name} Цемент` })
  ids.s1 = await ins(db, 'suppliers', { company_id: c, name: `${name} sotuvchi` })

  ids.ca_haydovchi = await ins(db, 'cash_advances', { company_id: c, recipient_id: P('haydovchi'), amount: 1_000_000 })
  ids.ca_prorab = await ins(db, 'cash_advances', { company_id: c, recipient_id: P('prorab'), amount: 500_000 })

  const purchase = (buyer: UserRole, obj: string): Promise<string> =>
    ins(db, 'purchases', {
      company_id: c,
      buyer_id: P(buyer),
      object_id: obj,
      material_id: ids.m1,
      supplier_id: ids.s1,
      qty_input: 10,
      unit_input: 'qop',
      qty_base: 500,
      unit_price: 60_000,
      total_amount: 600_000,
      created_by: P(buyer),
    })
  ids.p_hay_obj2 = await purchase('haydovchi', ids.obj2)
  ids.p_tam_obj1 = await purchase('taminotchi', ids.obj1)
  ids.p_pro_obj1 = await purchase('prorab', ids.obj1)

  const transfer = (from: string, to: string): Promise<string> =>
    ins(db, 'transfers', {
      company_id: c,
      from_object_id: from,
      to_object_id: to,
      material_id: ids.m1,
      qty_input: 1,
      unit_input: 'kg',
      qty_base: 1,
    })
  ids.tr_1to2 = await transfer(ids.obj1, ids.obj2)
  ids.tr_2to3 = await transfer(ids.obj2, ids.obj3)

  const movement = (type: string, obj: string, qty: number, extra: Record<string, unknown> = {}): Promise<string> =>
    ins(db, 'movements', {
      company_id: c,
      type,
      object_id: obj,
      material_id: ids.m1,
      qty_input: qty,
      unit_input: 'kg',
      qty_base: qty,
      ...extra,
    })
  ids.mv_obj1 = await movement('kirim', ids.obj1, 100, { purchase_id: ids.p_pro_obj1 })
  ids.mv_obj2 = await movement('kirim', ids.obj2, 40)

  const count = (obj: string): Promise<string> =>
    ins(db, 'inventory_counts', { company_id: c, object_id: obj, created_by: P('tekshiruvchi') })
  ids.ic_obj1 = await count(ids.obj1)
  ids.ic_obj2 = await count(ids.obj2)
  ids.ici_obj1 = await ins(db, 'inventory_count_items', {
    company_id: c,
    inventory_count_id: ids.ic_obj1,
    material_id: ids.m1,
    qty_counted: 5,
    created_by: P('tekshiruvchi'),
  })
  ids.ici_obj2 = await ins(db, 'inventory_count_items', {
    company_id: c,
    inventory_count_id: ids.ic_obj2,
    material_id: ids.m1,
    qty_counted: 5,
    created_by: P('tekshiruvchi'),
  })

  const estimate = (obj: string): Promise<string> =>
    ins(db, 'estimates', { company_id: c, object_id: obj, version: 1, title: 'Smeta', is_current: true })
  ids.est_obj1 = await estimate(ids.obj1)
  ids.est_obj2 = await estimate(ids.obj2)
  const estItem = (est: string): Promise<string> =>
    ins(db, 'estimate_items', {
      company_id: c,
      estimate_id: est,
      item_type: 'material',
      name: 'Sement',
      material_id: ids.m1,
      unit: 'kg',
      qty: 1000,
    })
  ids.ei_obj1 = await estItem(ids.est_obj1)
  ids.ei_obj2 = await estItem(ids.est_obj2)
  ids.tpl1 = await ins(db, 'estimate_import_templates', {
    company_id: c,
    name: `${name} shablon`,
    header_signature: 'nomi|birlik|miqdori',
    mapping: { name: 0, unit: 1, qty: 2 },
    header_row: 0,
  })

  const request = (obj: string): Promise<string> =>
    ins(db, 'material_requests', {
      company_id: c,
      object_id: obj,
      material_id: ids.m1,
      qty_input: 2,
      unit_input: 'qop',
      qty_base: 100,
      created_by: P('prorab'),
    })
  ids.mr_obj1 = await request(ids.obj1)
  ids.mr_obj2 = await request(ids.obj2)

  ids.alert1 = await ins(db, 'alerts', { company_id: c, type: 'narx_ogishi', object_id: ids.obj1, material_id: ids.m1 })

  return { id, users, ids }
}

export interface TwoCompanies {
  A: CompanyFixture
  B: CompanyFixture
}

export async function buildTwoCompanies(db: Db): Promise<TwoCompanies> {
  return { A: await buildCompany(db, 'A'), B: await buildCompany(db, 'B') }
}

/**
 * UPDATE/DELETE ta'sir qilgan qatorlar soni yoki xato (tashlamaydi, savepoint bilan).
 */
export async function tryExec(
  tx: Queryable,
  sql: string,
  params?: unknown[],
): Promise<{ ok: true; affected: number } | { ok: false; code: string | null; msg: string }> {
  await tx.exec('savepoint fx_try')
  try {
    const r = await tx.query(sql, params)
    await tx.exec('release savepoint fx_try')
    return { ok: true, affected: r.affectedRows ?? 0 }
  } catch (e) {
    await tx.exec('rollback to savepoint fx_try')
    const err = e as { code?: string; message?: string }
    return { ok: false, code: err.code ?? null, msg: err.message ?? String(e) }
  }
}

// ----------------------------------------------------------------------------
// INSERT shablonlari: aktyor nomidan firma `co` ga yangi qator (created_by = aktyor).
// `co` — qaysi firma qatorlariga havola (odatda aktyorning o'z firmasi).
// ----------------------------------------------------------------------------

export interface InsertCase {
  sql: string
  params: unknown[]
}

let uniq = 0
const u = (): string => `t${++uniq}-${Math.random().toString(36).slice(2, 8)}`

/** Aktyor (`me` profil id) `co` firmasiga `table` ga qator qo'shadigan SQL. RETURNING yo'q. */
export function insertCase(table: BusinessTable, co: CompanyFixture, me: string, obj = co.ids.obj1!): InsertCase {
  const c = co.id
  const ids = co.ids
  switch (table) {
    case 'companies':
      return { sql: `insert into public.companies (name, created_by) values ($1, $2)`, params: [`Yangi ${u()}`, me] }
    case 'profiles':
      return {
        sql: `insert into public.profiles (company_id, role, full_name, phone, created_by) values ($1, 'prorab', 'Yangi', $2, $3)`,
        params: [c, phone(), me],
      }
    case 'objects':
      return { sql: `insert into public.objects (company_id, name, created_by) values ($1, $2, $3)`, params: [c, u(), me] }
    case 'object_members':
      return {
        sql: `insert into public.object_members (company_id, object_id, profile_id, created_by) values ($1, $2, $3, $4)`,
        params: [c, ids.obj3, co.users.direktor.profileId, me],
      }
    case 'materials':
      return {
        sql: `insert into public.materials (company_id, name, base_unit, created_by) values ($1, $2, 'kg', $3)`,
        params: [c, u(), me],
      }
    case 'material_units':
      return {
        sql: `insert into public.material_units (company_id, material_id, unit, factor, created_by) values ($1, $2, $3, 2, $4)`,
        params: [c, ids.m1, u(), me],
      }
    case 'material_aliases':
      return {
        sql: `insert into public.material_aliases (company_id, material_id, alias, created_by) values ($1, $2, $3, $4)`,
        params: [c, ids.m1, u(), me],
      }
    case 'suppliers':
      return { sql: `insert into public.suppliers (company_id, name, created_by) values ($1, $2, $3)`, params: [c, u(), me] }
    case 'cash_advances':
      return {
        sql: `insert into public.cash_advances (company_id, recipient_id, amount, created_by) values ($1, $2, 1000, $3)`,
        params: [c, co.users.haydovchi.profileId, me],
      }
    case 'purchases':
      return {
        sql: `insert into public.purchases (company_id, buyer_id, object_id, material_id, qty_input, unit_input,
                qty_base, unit_price, total_amount, created_by)
              values ($1, $2, $3, $4, 1, 'kg', 1, 100, 100, $2)`,
        params: [c, me, obj, ids.m1],
      }
    case 'transfers':
      return {
        sql: `insert into public.transfers (company_id, from_object_id, to_object_id, material_id, qty_input, unit_input,
                qty_base, created_by)
              values ($1, $2, $3, $4, 1, 'kg', 1, $5)`,
        params: [c, obj, obj === ids.obj3 ? ids.obj1 : ids.obj3, ids.m1, me],
      }
    case 'inventory_counts':
      return {
        sql: `insert into public.inventory_counts (company_id, object_id, created_by) values ($1, $2, $3)`,
        params: [c, obj, me],
      }
    case 'inventory_count_items':
      return {
        sql: `insert into public.inventory_count_items (company_id, inventory_count_id, material_id, qty_counted, created_by)
              values ($1, $2, $3, 1, $4)`,
        params: [c, ids.ic_obj1, ids.m2, me],
      }
    case 'estimates':
      return {
        sql: `insert into public.estimates (company_id, object_id, version, title, created_by) values ($1, $2, 99, 'v99', $3)`,
        params: [c, obj, me],
      }
    case 'estimate_items':
      return {
        sql: `insert into public.estimate_items (company_id, estimate_id, item_type, name, qty, created_by)
              values ($1, $2, 'ish', 'Ish', 1, $3)`,
        params: [c, ids.est_obj1, me],
      }
    case 'estimate_import_templates':
      return {
        sql: `insert into public.estimate_import_templates (company_id, name, header_signature, mapping, created_by)
              values ($1, 'Shablon', $2, '{"name":0}'::jsonb, $3)`,
        params: [c, u(), me],
      }
    case 'material_requests':
      return {
        sql: `insert into public.material_requests (company_id, object_id, material_id, qty_input, unit_input, qty_base, created_by)
              values ($1, $2, $3, 1, 'kg', 1, $4)`,
        params: [c, obj, ids.m1, me],
      }
    case 'movements':
      return {
        sql: `insert into public.movements (company_id, type, object_id, material_id, qty_input, unit_input, qty_base, created_by)
              values ($1, 'kirim', $2, $3, 1, 'kg', 1, $4)`,
        params: [c, obj, ids.m1, me],
      }
    case 'alerts':
      return {
        sql: `insert into public.alerts (company_id, type, created_by) values ($1, 'narx_ogishi', $2)`,
        params: [c, me],
      }
  }
}

/** Har jadval uchun o'zgartiriladigan namunaviy qator yorlig'i (`companies` — firmaning o'zi). */
export const UPDATE_TARGET: Record<BusinessTable, string> = {
  companies: '__company__',
  profiles: '__haydovchi__',
  objects: 'obj1',
  object_members: 'mem_prorab',
  materials: 'm1',
  material_units: 'u1',
  material_aliases: 'al1',
  suppliers: 's1',
  cash_advances: 'ca_haydovchi',
  purchases: 'p_pro_obj1',
  transfers: 'tr_1to2',
  inventory_counts: 'ic_obj1',
  inventory_count_items: 'ici_obj1',
  estimates: 'est_obj1',
  estimate_items: 'ei_obj1',
  estimate_import_templates: 'tpl1',
  material_requests: 'mr_obj1',
  movements: 'mv_obj1',
  alerts: 'alert1',
}

export function targetId(co: CompanyFixture, table: BusinessTable): string {
  const label = UPDATE_TARGET[table]
  if (label === '__company__') return co.id
  if (label === '__haydovchi__') return co.users.haydovchi.profileId
  const v = co.ids[label]
  if (!v) throw new Error(`fixture yorlig'i yo'q: ${label}`)
  return v
}
