// Audit 3 tekshiruvi — 20261113000001_audit3_review_fixes.sql.
//   R2  faol firma: estimate_create_materials(p_company_id), remember_estimate_aliases, check_purchase_price
//   R3  create_company — telefon boshqa firmada
//   R4  evaluate_duplicate — ikki tomonlama qidiruv
//   R10 hisobot / tarix RPC'lari — p_company_id (faqat super_admin)
//   E9  svc_use_init_data — umumiy initData replay himoyasi
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asService, asUser, createDb, one, rows, scalar, type Db, type Queryable, type Row, type Tx, type UserRole } from './_harness'
import { raw, res, switchUid, sys, system } from './_tx'
import { buildTwoCompanies, type CompanyFixture } from './_fixtures'

let db: Db
let A: CompanyFixture
let B: CompanyFixture

beforeAll(async () => {
  db = await createDb()
  ;({ A, B } = await buildTwoCompanies(db))
})
afterAll(async () => {
  await db?.close()
})

const P = (role: UserRole, co: CompanyFixture = A): string => co.users[role].profileId
const as = <T>(role: UserRole, fn: (tx: Tx) => Promise<T>, co: CompanyFixture = A): Promise<T> =>
  asUser(db, co.users[role].authUid, fn)
const ago = (days: number): string => new Date(Date.now() - days * 86400e3).toISOString()

let seq = 0
const uniq = (p: string): string => `${p} ${++seq}-${randomUUID().slice(0, 6)}`

async function newMat(q: Queryable, co: string): Promise<{ id: string; unit: string }> {
  const id = await scalar<string>(q, `insert into public.materials (company_id, name, base_unit) values ($1, $2, 'kg') returning id`, [
    co,
    uniq('R material'),
  ])
  const unit = await scalar<string>(q, `select id from public.material_units where material_id = $1 and factor = 1`, [id])
  return { id, unit }
}

async function purchase(
  q: Queryable,
  co: CompanyFixture,
  o: { mat: { id: string; unit: string }; qty: string; total: string; at?: string },
): Promise<string> {
  return scalar<string>(
    q,
    `insert into public.purchases (company_id, buyer_id, object_id, material_id, unit_id, qty_input, unit_input, qty_base,
        unit_price, price_per_base, total_amount, purchased_at)
     values ($1, $2, $3, $4, $5, $6, '-', 0, 0, 0, $7, coalesce($8::timestamptz, now())) returning id`,
    [co.id, P('taminotchi', co), co.ids.obj1, o.mat.id, o.mat.unit, o.qty, o.total, o.at ?? null],
  )
}

async function kirim(q: Queryable, obj: string, mat: { id: string; unit: string }, qty: string): Promise<string> {
  return scalar<string>(
    q,
    `insert into public.movements (company_id, type, object_id, material_id, unit_id, qty_input, unit_input, qty_base, occurred_at)
     values ($1, 'kirim', $2, $3, $4, $5, '-', 0, now()) returning id`,
    [A.id, obj, mat.id, mat.unit, qty],
  )
}

// ============================================================================
// R2 — faol firmada yozish
// ============================================================================
describe('R2: estimate_create_materials(p_items, p_company_id)', () => {
  const CREATE = `select public.estimate_create_materials($1::jsonb, $2::uuid) as r`

  it('super_admin B firmani tanlasa — material B katalogida; p_company_id yo`q — o`z firmasi (A)', async () => {
    const r = await as('super_admin', async (tx) => {
      const nameB = uniq('Kabel B')
      const nameA = uniq('Kabel A')
      const toB = await scalar<{ material_id: string }[]>(tx, CREATE, [JSON.stringify([{ key: 'k', name: nameB, base_unit: 'm', code: uniq('RB-') }]), B.id])
      const toA = await scalar<{ material_id: string }[]>(tx, `select public.estimate_create_materials($1::jsonb) as r`, [
        JSON.stringify([{ key: 'k', name: nameA, base_unit: 'm' }]),
      ])
      return sys(tx, async () => ({
        b: await scalar<string>(tx, `select company_id from public.materials where id = $1`, [toB[0]!.material_id]),
        bAlias: await scalar<string>(tx, `select distinct company_id from public.material_aliases where material_id = $1`, [toB[0]!.material_id]),
        a: await scalar<string>(tx, `select company_id from public.materials where id = $1`, [toA[0]!.material_id]),
      }))
    })
    expect(r).toEqual({ b: B.id, bAlias: B.id, a: A.id })
  })

  it('admin boshqa firma id sini bersa — e`tiborsiz, o`z firmasida yaratiladi; yo`q firma (super_admin) — rad', async () => {
    const r = await as('admin', async (tx) => {
      const out = await scalar<{ material_id: string }[]>(tx, CREATE, [JSON.stringify([{ key: 'k', name: uniq('Admin mat'), base_unit: 'kg' }]), B.id])
      return sys(tx, () => scalar<string>(tx, `select company_id from public.materials where id = $1`, [out[0]!.material_id]))
    })
    expect(r).toBe(A.id)
    const missing = await as('super_admin', (tx) => res(tx, CREATE, [JSON.stringify([{ key: 'k', name: 'X', base_unit: 'kg' }]), randomUUID()]))
    expect(missing).toBe('42501:estimate_materials_forbidden')
  })
})

describe('R2: remember_estimate_aliases — firma smetadan', () => {
  it('super_admin B firma smetasi: alias B firmada yoziladi', async () => {
    const r = await as('super_admin', async (tx) => {
      const unitId = await scalar<string>(tx, `select id from public.material_units where material_id = $1 and factor = 1 and variant is null`, [B.ids.m1])
      const code = uniq('RB-SH-')
      const est = await scalar<string>(tx, `select public.import_estimate($1, $2, 'Smeta', 's.xlsx', null, $3::jsonb)`, [
        randomUUID(),
        B.ids.obj3,
        JSON.stringify([{ item_type: 'material', name: 'B sement', material_id: B.ids.m1, unit_id: unitId, qty: '1', code, row_number: 1 }]),
      ])
      const n = await scalar<number>(tx, `select public.remember_estimate_aliases($1, $2::jsonb)`, [est, JSON.stringify([{ material_id: B.ids.m1, code }])])
      const co = await sys(tx, () => scalar<string>(tx, `select company_id from public.material_aliases where alias = $1`, [code]))
      return { n, co }
    })
    expect(r).toEqual({ n: 1, co: B.id })
  })
})

describe('R2: check_purchase_price — firma materialdan', () => {
  it('super_admin B materiali: narx og`ishi aniqlanadi (avval — doim ok); A admini B materiali — ok', async () => {
    const r = await as('super_admin', async (tx) => {
      const mat = await system(tx, async () => {
        const m = await newMat(tx, B.id)
        for (const at of [ago(4), ago(3), ago(2)]) await purchase(tx, B, { mat: m, qty: '100', total: '10000', at })
        return m
      })
      return {
        high: await scalar<string>(tx, `select public.check_purchase_price($1, 200)`, [mat.id]),
        ok: await scalar<string>(tx, `select public.check_purchase_price($1, 100)`, [mat.id]),
        mat,
      }
    })
    expect({ high: r.high, ok: r.ok }).toEqual({ high: 'high', ok: 'ok' })
    // Boshqa firma (A) admini B materialini ko'rmaydi — 'ok' (narx haqida ma'lumot oshkor qilinmaydi)
    const cross = await as('admin', async (tx) => {
      const m = await system(tx, async () => {
        const x = await newMat(tx, B.id)
        for (const at of [ago(4), ago(3), ago(2)]) await purchase(tx, B, { mat: x, qty: '100', total: '10000', at })
        return x
      })
      const other = await scalar<string>(tx, `select public.check_purchase_price($1, 200)`, [m.id])
      await switchUid(tx, B.users.admin.authUid)
      const own = await scalar<string>(tx, `select public.check_purchase_price($1, 200)`, [m.id])
      return { other, own }
    })
    expect(cross).toEqual({ other: 'ok', own: 'high' })
  })
})

// ============================================================================
// R3 — create_company: telefon boshqa firmada
// ============================================================================
describe('R3: create_company — admin telefoni boshqa firmada', () => {
  const call = `select public.create_company($1, $2, $3) as r`

  it('tirik profil telefoni — 23505 phone_in_other_company (mahalliy formatda ham); firma yaratilmaydi', async () => {
    const phone = await scalar<string>(db, `select phone from public.profiles where id = $1`, [P('prorab', B)])
    const r = await as('super_admin', async (tx) => ({
      e164: await res(tx, call, ['R3 firma', 'Ism', phone]),
      local: await res(tx, call, ['R3 firma', 'Ism', phone.slice(4)]),
      companies: await scalar<number>(tx, `select count(*)::int from public.companies where name = 'R3 firma'`),
    }))
    expect(r).toEqual({ e164: '23505:phone_in_other_company', local: '23505:phone_in_other_company', companies: 0 })
  })

  it('o`chirilgan, auth akkauntsiz profil telefoni — ruxsat; auth bog`langan o`chirilgan — rad', async () => {
    const r = await as('super_admin', async (tx) => {
      const phone = await scalar<string>(tx, `select phone from public.profiles where id = $1`, [P('direktor', B)])
      await sys(tx, () => tx.query(`update public.profiles set deleted_at = now() where id = $1`, [P('direktor', B)]))
      const linked = await res(tx, call, ['R3 firma 2', 'Ism', phone])
      await sys(tx, () => tx.query(`update public.profiles set auth_user_id = null, login_kind = 'none' where id = $1`, [P('direktor', B)]))
      const unlinked = await res(tx, call, ['R3 firma 2', 'Ism', phone])
      return { linked, unlinked }
    })
    expect(r).toEqual({ linked: '23505:phone_in_other_company', unlinked: 'OK:1' })
  })
})

// ============================================================================
// R4 — takroriy yozuv: ikki tomonlama
// ============================================================================
describe('R4: evaluate_duplicate — keyingi yozuv oldin commit bo`lgan holat', () => {
  it('keyinroq yaratilgan (created_at katta) yozuv birinchi baholangan bo`lsa — eskisi baholanganda belgi KEYINGISIGA', async () => {
    const r = await as('omborchi', async (tx) => {
      const mat = await sys(tx, () => newMat(tx, A.id))
      // "B" tranzaksiya: keyinroq boshlangan, lekin birinchi commit bo'lgan — eski yozuvni ko'rmagan
      const later = await kirim(tx, A.ids.obj1!, mat, '7')
      await raw(tx, `update public.movements set created_at = now() + interval '1 minute' where id = $1`, [later])
      // "A" tranzaksiya: oldinroq yaratilgan, endi baholanadi
      const earlier = await kirim(tx, A.ids.obj1!, mat, '7')
      const alerts = await sys(tx, () =>
        rows<{ movement_id: string; details: Row }>(
          tx,
          `select movement_id, details from public.alerts where type = 'takroriy_yozuv' and material_id = $1 and deleted_at is null`,
          [mat.id],
        ),
      )
      return { later, earlier, alerts }
    })
    expect(r.alerts).toHaveLength(1)
    expect(r.alerts[0]!.movement_id).toBe(r.later)
    expect(r.alerts[0]!.details).toMatchObject({ kind: 'record', record_id: r.later, first_id: r.earlier })
  })

  it('odatiy tartib: ikkinchisi belgilanadi, birinchisi emas; oynadan tashqari — belgi yo`q', async () => {
    const r = await as('omborchi', async (tx) => {
      const mat = await sys(tx, () => newMat(tx, A.id))
      const first = await kirim(tx, A.ids.obj1!, mat, '5')
      await raw(tx, `update public.movements set created_at = now() - interval '1 minute' where id = $1`, [first])
      const second = await kirim(tx, A.ids.obj1!, mat, '5')
      const mat2 = await sys(tx, () => newMat(tx, A.id))
      const far = await kirim(tx, A.ids.obj1!, mat2, '5')
      await raw(tx, `update public.movements set created_at = now() + interval '11 minutes' where id = $1`, [far])
      await kirim(tx, A.ids.obj1!, mat2, '5')
      const q = (m: string) =>
        sys(tx, () =>
          rows<{ record_id: string }>(
            tx,
            `select details ->> 'record_id' as record_id from public.alerts where type = 'takroriy_yozuv' and material_id = $1`,
            [m],
          ),
        )
      return { second, a: await q(mat.id), far: await q(mat2.id) }
    })
    expect(r.a).toEqual([{ record_id: r.second }])
    expect(r.far).toEqual([])
  })
})

// ============================================================================
// R10 — hisobot va tarix: faol firma
// ============================================================================
describe('R10: hisobot / tarix RPC`lari — p_company_id faqat super_admin uchun', () => {
  const countPurchases = (tx: Queryable, co: string): Promise<number> =>
    scalar<number>(
      tx,
      `select count(*)::int from public.purchases where company_id = $1 and deleted_at is null
          and purchased_at >= ((now() at time zone 'Asia/Tashkent')::date - 30)::timestamp at time zone 'Asia/Tashkent'
          and purchased_at < ((now() at time zone 'Asia/Tashkent')::date + 1)::timestamp at time zone 'Asia/Tashkent'`,
      [co],
    )

  it('dashboard_summary / dashboard_daily / spend_breakdown / norm_overview — B firma bo`yicha', async () => {
    const r = await as('super_admin', async (tx) => {
      const mat = await system(tx, async () => {
        const m = await newMat(tx, B.id)
        await purchase(tx, B, { mat: m, qty: '3', total: '777000' })
        return m
      })
      const want = await sys(tx, () => countPurchases(tx, B.id))
      const sumB = await scalar<Row>(tx, `select public.dashboard_summary((now() at time zone 'Asia/Tashkent')::date - 30, (now() at time zone 'Asia/Tashkent')::date, null, $1)`, [B.id])
      const sumOwn = await scalar<Row>(tx, `select public.dashboard_summary((now() at time zone 'Asia/Tashkent')::date - 30, (now() at time zone 'Asia/Tashkent')::date)`)
      const wantOwn = await sys(tx, () => countPurchases(tx, A.id))
      const objB = await scalar<Row>(tx, `select public.dashboard_summary((now() at time zone 'Asia/Tashkent')::date - 30, (now() at time zone 'Asia/Tashkent')::date, $2, $1)`, [B.id, B.ids.obj1])
      const objMismatch = await scalar<Row>(tx, `select public.dashboard_summary((now() at time zone 'Asia/Tashkent')::date - 30, (now() at time zone 'Asia/Tashkent')::date, $2, $1)`, [B.id, A.ids.obj1])
      const daily = await scalar<string>(
        tx,
        `select coalesce(sum(purchases_sum::numeric), 0)::text from public.dashboard_daily((now() at time zone 'Asia/Tashkent')::date, (now() at time zone 'Asia/Tashkent')::date, null, $1)`,
        [B.id],
      )
      const spend = await rows<{ key: string }>(tx, `select key from public.spend_breakdown((now() at time zone 'Asia/Tashkent')::date, (now() at time zone 'Asia/Tashkent')::date, null, 'material', $1)`, [B.id])
      const norm = await rows<{ object_id: string }>(tx, `select object_id from public.norm_overview(null, $1)`, [B.id])
      const bObjects = await sys(tx, async () =>
        (await rows<{ id: string }>(tx, `select id from public.objects where company_id = $1`, [B.id])).map((x) => x.id),
      )
      return { sumB, sumOwn, want, wantOwn, objB, objMismatch, daily, spend, mat, norm, bObjects }
    })
    expect(r.sumB.purchases_count).toBe(r.want)
    expect(r.sumOwn.purchases_count).toBe(r.wantOwn)
    expect(r.objB.purchases_count).toBeGreaterThanOrEqual(1)
    expect(r.objMismatch.purchases_count).toBe(0)
    expect(Number(r.daily)).toBeGreaterThanOrEqual(777000)
    expect(r.spend.map((x) => x.key)).toContain(r.mat.id)
    expect(r.norm.every((x) => r.bObjects.includes(x.object_id))).toBe(true)
  })

  it('admin boshqa firma id sini bersa — e`tiborsiz (o`z firmasi)', async () => {
    const r = await as('admin', async (tx) => ({
      withB: await scalar<Row>(tx, `select public.dashboard_summary((now() at time zone 'Asia/Tashkent')::date - 30, (now() at time zone 'Asia/Tashkent')::date, null, $1)`, [B.id]),
      plain: await scalar<Row>(tx, `select public.dashboard_summary((now() at time zone 'Asia/Tashkent')::date - 30, (now() at time zone 'Asia/Tashkent')::date)`),
      health: await scalar<Row>(tx, `select public.notification_health($1)`, [B.id]),
      healthOwn: await scalar<Row>(tx, `select public.notification_health()`),
      feed: await rows<{ c: string }>(
        tx,
        `select distinct a.company_id::text as c
           from public.audit_feed((now() at time zone 'Asia/Tashkent')::date - 30, (now() at time zone 'Asia/Tashkent')::date, p_limit => 200, p_company_id => $1) f
           join public.audit_log a on a.id = f.id`,
        [B.id],
      ),
    }))
    expect(r.withB).toEqual(r.plain)
    expect(r.health).toEqual(r.healthOwn)
    expect(r.feed.every((x) => x.c === A.id)).toBe(true)
  })

  it('notification_health / audit_feed / deleted_records — super_admin B firma tanlasa faqat B', async () => {
    const r = await as('super_admin', async (tx) => {
      await sys(tx, async () => {
        await tx.query(`update public.profiles set telegram_blocked_at = now() where id = $1`, [P('prorab', B)])
        await tx.query(`update public.materials set deleted_at = now() where id = $1`, [B.ids.m2])
        await tx.query(`update public.materials set deleted_at = now() where id = $1`, [A.ids.m2])
      })
      const health = await scalar<{ blocked_profiles: { profile_id: string }[] }>(tx, `select public.notification_health($1)`, [B.id])
      const feedB = await rows<{ c: string }>(
        tx,
        `select distinct a.company_id::text as c
           from public.audit_feed((now() at time zone 'Asia/Tashkent')::date - 1, (now() at time zone 'Asia/Tashkent')::date, p_limit => 200, p_company_id => $1) f
           join public.audit_log a on a.id = f.id`,
        [B.id],
      )
      const feedAll = await rows<{ c: string }>(
        tx,
        `select distinct a.company_id::text as c
           from public.audit_feed((now() at time zone 'Asia/Tashkent')::date - 1, (now() at time zone 'Asia/Tashkent')::date, p_limit => 200) f
           join public.audit_log a on a.id = f.id`,
      )
      const delB = await rows<{ record_id: string }>(
        tx,
        `select record_id from public.deleted_records((now() at time zone 'Asia/Tashkent')::date, (now() at time zone 'Asia/Tashkent')::date, 'materials', 200, 0, $1)`,
        [B.id],
      )
      const delAll = await rows<{ record_id: string }>(tx, `select record_id from public.deleted_records((now() at time zone 'Asia/Tashkent')::date, (now() at time zone 'Asia/Tashkent')::date, 'materials', 200, 0)`)
      return { health, feedB, feedAll, delB, delAll }
    })
    expect(r.health.blocked_profiles.map((x) => x.profile_id)).toEqual([P('prorab', B)])
    expect(r.feedB.length).toBeGreaterThan(0)
    expect(r.feedB.every((x) => x.c === B.id)).toBe(true)
    expect(new Set(r.feedAll.map((x) => x.c)).size).toBeGreaterThan(1)
    expect(r.delB.map((x) => x.record_id)).toEqual([B.ids.m2])
    expect(r.delAll.map((x) => x.record_id).sort()).toEqual([A.ids.m2, B.ids.m2].sort())
  })

  it('yangi imzolar: anon execute yo`q, authenticated bor; eski imzolar o`chirilgan', async () => {
    const sigs = [
      'public.dashboard_summary(date, date, uuid, uuid)',
      'public.dashboard_daily(date, date, uuid, uuid)',
      'public.spend_breakdown(date, date, uuid, text, uuid)',
      'public.norm_overview(uuid, uuid)',
      'public.notification_health(uuid)',
      'public.audit_feed(date, date, text, text, uuid, text, uuid, bigint, int, uuid)',
      'public.deleted_records(date, date, text, int, int, uuid)',
      'public.estimate_create_materials(jsonb, uuid)',
    ]
    for (const s of sigs) {
      const f = await one<{ anon: boolean; auth: boolean }>(
        db,
        `select has_function_privilege('anon', $1::regprocedure, 'execute') as anon,
                has_function_privilege('authenticated', $1::regprocedure, 'execute') as auth`,
        [s],
      )
      expect(f, s).toEqual({ anon: false, auth: true })
    }
    for (const old of [
      'public.dashboard_summary(date, date, uuid)',
      'public.notification_health()',
      'public.audit_feed(date, date, text, text, uuid, text, uuid, bigint, int)',
      'public.estimate_create_materials(jsonb)',
    ]) {
      expect(await scalar<string | null>(db, `select to_regprocedure($1)::text`, [old]), old).toBeNull()
    }
  })
})

// ============================================================================
// E9 — svc_use_init_data
// ============================================================================
describe('E9: svc_use_init_data — umumiy initData replay himoyasi', () => {
  const USE = `select public.svc_use_init_data($1, $2::timestamptz, $3)`
  const future = (): string => new Date(Date.now() + 3600e3).toISOString()
  /** service_role tranzaksiyasida postgres sifatida (private jadval), keyin yana service_role. */
  const pg = async <T>(tx: Tx, fn: () => Promise<T>): Promise<T> => {
    await tx.exec('reset role')
    try {
      return await fn()
    } finally {
      await tx.exec('set local role service_role')
    }
  }

  it('yangi — true; grace ichida takror — true; grace o`tgach — false; muddati tugagan — qayta true', async () => {
    const h = 'ab'.repeat(32)
    const r = await asService(db, async (tx) => {
      const first = await scalar<boolean>(tx, USE, [h, future(), 30000])
      const again = await scalar<boolean>(tx, USE, [h, future(), 30000])
      await pg(tx, () => tx.query(`update private.used_init_data set first_seen_at = now() - interval '1 minute' where hash = $1`, [h]))
      const replay = await scalar<boolean>(tx, USE, [h, future(), 30000])
      await pg(tx, () => tx.query(`update private.used_init_data set expires_at = now() - interval '1 second' where hash = $1`, [h]))
      const renewed = await scalar<boolean>(tx, USE, [h, future(), 30000])
      const purged = await pg(tx, async () => {
        await tx.query(`update private.used_init_data set expires_at = now() - interval '2 hours' where hash = $1`, [h])
        return scalar<number>(tx, `select private.purge_used_init_data()`)
      })
      return { first, again, replay, renewed, purged }
    })
    expect(r).toEqual({ first: true, again: true, replay: false, renewed: true, purged: 1 })
  })

  it('noto`g`ri xesh — 22023 init_data_invalid; authenticated / anon — ruxsat yo`q; cron jobi bor', async () => {
    expect(await asService(db, (tx) => res(tx, USE, ['not-hex', future(), 1000]))).toBe('22023:init_data_invalid')
    expect(await as('admin', (tx) => res(tx, USE, ['cd'.repeat(32), future(), 1000]))).toBe('42501:')
    expect(
      await scalar<boolean>(db, `select has_function_privilege('anon', 'public.svc_use_init_data(text, timestamptz, integer)', 'execute')`),
    ).toBe(false)
    expect(await scalar<number>(db, `select count(*)::int from cron.job where jobname = 'terron-used-init-data-purge'`)).toBe(1)
  })
})
