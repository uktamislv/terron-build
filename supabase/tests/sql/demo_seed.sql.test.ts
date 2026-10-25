// Batch 11 — supabase/seed/demo.sql: alohida "Demo qurilish" firmasi (30 kun).
// Tekshiruv: ikki marta qo'llash (idempotent), qatorlar soni mantiqiy, bir necha turdagi
// ogohlantirishlar tabiiy hosil bo'lgan, boshqa firmalar (namuna seed + fixture) va
// auth.users o'zgarmagan, vaqtinchalik auth bog'lanishlari olib tashlangan.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, one, rows, scalar, SUPABASE_DIR, type Db } from './_harness'
import { buildCompany } from './_fixtures'

const DEMO = 'de300000-0000-4000-8000-000000000001'
const DEMO_SQL = readFileSync(join(SUPABASE_DIR, 'seed', 'demo.sql'), 'utf8')

let db: Db
let before: Record<string, string>
let afterFirst: Record<string, number>
let afterSecond: Record<string, number>

/** company_id ustuni bor public jadvallar. */
async function companyTables(): Promise<string[]> {
  const r = await rows<{ t: string }>(
    db,
    `select c.table_name as t from information_schema.columns c
       join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name
      where c.table_schema = 'public' and c.column_name = 'company_id' and x.table_type = 'BASE TABLE'
      order by 1`,
  )
  return r.map((x) => x.t)
}

/** Boshqa firmalar qatorlari izi (soni + md5), companies, auth.users, storage, cron. */
async function othersSnapshot(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const t of await companyTables()) {
    out[t] = await scalar<string>(
      db,
      `select count(*) || ':' || md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by to_jsonb(x)::text), ''))
         from public.${t} x where company_id <> $1`,
      [DEMO],
    )
  }
  out.companies = await scalar<string>(
    db,
    `select count(*) || ':' || md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), ''))
       from public.companies x where id <> $1`,
    [DEMO],
  )
  out['auth.users'] = await scalar<string>(
    db,
    `select count(*) || ':' || md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from auth.users x`,
  )
  out['storage.objects'] = await scalar<string>(db, `select count(*)::text from storage.objects`)
  out['cron.job'] = await scalar<string>(
    db,
    `select md5(coalesce(string_agg(jobname || schedule, '|' order by jobname), '')) from cron.job`,
  )
  return out
}

/** Demo firma bo'yicha qatorlar soni (audit_log va outbox ham). */
async function demoCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const t of await companyTables()) {
    out[t] = await scalar<number>(db, `select count(*)::int from public.${t} where company_id = $1`, [DEMO])
  }
  return out
}

beforeAll(async () => {
  // Boshqa firmalar: supabase/seed.sql (namuna firma) va to'liq fixture firma
  db = await createDb({ seed: true })
  await buildCompany(db, 'Boshqa')
  before = await othersSnapshot()
  await db.exec(DEMO_SQL)
  afterFirst = await demoCounts()
  await db.exec(DEMO_SQL)
  afterSecond = await demoCounts()
})
afterAll(async () => {
  await db?.close()
})

describe('demo seed', () => {
  it('idempotent: ikkinchi qo`llash hech narsa qo`shmaydi', () => {
    expect(afterSecond).toEqual(afterFirst)
    expect(afterFirst.movements).toBeGreaterThan(0)
    expect(afterFirst.audit_log).toBeGreaterThan(0)
  })

  it('boshqa firmalar, auth.users, storage, cron — o`zgarmagan', async () => {
    expect(await othersSnapshot()).toEqual(before)
    expect(await scalar<number>(db, `select count(*)::int from auth.users where email like '%@demo-seed.invalid'`)).toBe(0)
  })

  it('JWT claims seed`dan keyin qolmagan (tranzaksiya-lokal)', async () => {
    const r = await one(
      db,
      `select coalesce(current_setting('request.jwt.claim.sub', true), '') as sub,
              coalesce(current_setting('request.jwt.claims', true), '') as claims, auth.uid() as uid`,
    )
    expect(r).toEqual({ sub: '', claims: '', uid: null })
  })

  it('firma, xodimlar (auth akkauntsiz), obyektlar (koordinatali), katalog, smetalar', async () => {
    expect(await one(db, `select name, is_active from public.companies where id = $1`, [DEMO])).toEqual({
      name: 'Demo qurilish',
      is_active: true,
    })
    const prof = await rows(
      db,
      `select role::text, count(*)::int as n from public.profiles where company_id = $1 group by 1 order by 1`,
      [DEMO],
    )
    expect(prof).toEqual([
      { role: 'admin', n: 1 },
      { role: 'buxgalter', n: 1 },
      { role: 'direktor', n: 1 },
      { role: 'haydovchi', n: 1 },
      { role: 'omborchi', n: 2 },
      { role: 'prorab', n: 2 },
      { role: 'taminotchi', n: 1 },
      { role: 'tekshiruvchi', n: 1 },
    ])
    expect(
      await scalar<number>(
        db,
        `select count(*)::int from public.profiles
          where company_id = $1
            and (auth_user_id is not null or login_kind <> 'none' or telegram_user_id is not null
                 or telegram_chat_id is not null or not is_active)`,
        [DEMO],
      ),
    ).toBe(0)
    expect(
      await scalar<number>(
        db,
        `select count(*)::int from public.objects where company_id = $1 and lat is not null and lng is not null`,
        [DEMO],
      ),
    ).toBe(3)
    expect(afterFirst.object_members).toBe(9)
    expect(afterFirst.materials).toBe(8) // shablon
    expect(afterFirst.suppliers).toBe(6)
    const est = await rows(
      db,
      `select o.name, e.version, e.is_current,
              (select count(*)::int from public.estimate_items i
                where i.estimate_id = e.id and i.item_type = 'material') as mats
         from public.estimates e join public.objects o on o.id = e.object_id
        where e.company_id = $1 order by o.name`,
      [DEMO],
    )
    expect(est).toEqual([
      { name: 'Chilonzor maktab binosi', version: 1, is_current: true, mats: 5 },
      { name: 'Sergeli savdo markazi', version: 1, is_current: true, mats: 5 },
      { name: 'Yunusobod 12-mavze turar-joy', version: 1, is_current: true, mats: 6 },
    ])
  })

  it('30 kunlik operatsiyalar: soni va sanalari mantiqiy', async () => {
    const mv = await rows<{ type: string; n: number }>(
      db,
      `select type::text, count(*)::int as n from public.movements where company_id = $1 group by 1 order by 1`,
      [DEMO],
    )
    const byType = Object.fromEntries(mv.map((x) => [x.type, x.n]))
    expect(byType.kirim).toBeGreaterThanOrEqual(60)
    expect(byType.chiqim).toBeGreaterThanOrEqual(150)
    expect(byType.transfer_out).toBe(3)
    expect(byType.transfer_in).toBe(2)
    expect(afterFirst.movements).toBeLessThan(600)
    expect(afterFirst.purchases).toBeGreaterThanOrEqual(60)
    expect(afterFirst.purchases).toBeLessThan(150)

    const span = await one<{ days: number; oldest: number; future: number }>(
      db,
      `select count(distinct (occurred_at at time zone 'Asia/Tashkent')::date)::int as days,
              ((now() at time zone 'Asia/Tashkent')::date
                 - min((occurred_at at time zone 'Asia/Tashkent')::date))::int as oldest,
              count(*) filter (where occurred_at > now())::int as future
         from public.movements where company_id = $1`,
      [DEMO],
    )
    expect(span.days).toBeGreaterThanOrEqual(28)
    expect(span.oldest).toBe(30)
    expect(span.future).toBe(0)
    // Har xarid ijobiy, narx trigger hisoblagan
    expect(
      await scalar<number>(
        db,
        `select count(*)::int from public.purchases where company_id = $1 and (total_amount <= 0 or price_per_base <= 0)`,
        [DEMO],
      ),
    ).toBe(0)

    const tr = await rows(
      db,
      `select status::text, count(*)::int as n from public.transfers where company_id = $1 group by 1 order by 1`,
      [DEMO],
    )
    expect(tr).toEqual([
      { status: 'qabul_qilindi', n: 2 },
      { status: 'yuborildi', n: 1 },
    ])
    const rq = await rows(
      db,
      `select status::text, count(*)::int as n from public.material_requests where company_id = $1 group by 1 order by 1`,
      [DEMO],
    )
    expect(rq).toEqual([
      { status: 'kutilmoqda', n: 2 },
      { status: 'rad', n: 1 },
      { status: 'tasdiqlandi', n: 1 },
      { status: 'xarid_qilindi', n: 1 },
    ])
    expect(await rows(db, `select status::text from public.inventory_counts where company_id = $1`, [DEMO])).toEqual([
      { status: 'submitted' },
    ])
    const cash = await rows(
      db,
      `select kind, count(*)::int as n from public.cash_advances where company_id = $1 group by 1 order by 1`,
      [DEMO],
    )
    expect(cash).toEqual([
      { kind: 'berildi', n: 5 },
      { kind: 'qaytarildi', n: 1 },
    ])
  })

  it('qoldiq: faqat Sergeli betoni manfiy (ataylab)', async () => {
    const neg = await rows(
      db,
      `select o.name as obj, m.name as mat, sb.qty_base::text as q
         from public.stock_balances sb
         join public.objects o on o.id = sb.object_id
         join public.materials m on m.id = sb.material_id
        where sb.company_id = $1 and sb.qty_base < 0`,
      [DEMO],
    )
    expect(neg).toEqual([{ obj: 'Sergeli savdo markazi', mat: 'Beton', q: '-2.000000' }])
  })

  it('ogohlantirishlar: rejadagi turlar tabiiy hosil bo`lgan, ortiqcha shovqin yo`q', async () => {
    const a = await rows<{ type: string; severity: string; n: number }>(
      db,
      `select type::text, severity::text, count(*)::int as n from public.alerts
        where company_id = $1 and deleted_at is null and status <> 'yopildi'
        group by 1, 2 order by 1, 2`,
      [DEMO],
    )
    expect(a).toEqual([
      { type: 'chek_farqi', severity: 'ogohlantirish', n: 1 },
      { type: 'inventarizatsiya_kamomadi', severity: 'ogohlantirish', n: 1 },
      { type: 'joylashuv_farqi', severity: 'belgi', n: 1 },
      { type: 'kirim_manbasiz', severity: 'belgi', n: 1 },
      { type: 'manfiy_qoldiq', severity: 'ogohlantirish', n: 1 },
      { type: 'narx_ogishi', severity: 'ogohlantirish', n: 1 },
      { type: 'normadan_oshish', severity: 'ogohlantirish', n: 1 },
      { type: 'otkazma_farqi', severity: 'ogohlantirish', n: 1 },
      { type: 'ozi_qabul_qilgan', severity: 'belgi', n: 1 },
      { type: 'smetadan_ortiq_sorov', severity: 'ogohlantirish', n: 1 },
      { type: 'sorovdan_ortiq_xarid', severity: 'belgi', n: 1 },
      { type: 'takroriy_yozuv', severity: 'belgi', n: 1 },
      { type: 'xarid_qabul_farqi', severity: 'jiddiy', n: 2 },
      { type: 'yozuv_ochirildi', severity: 'ogohlantirish', n: 1 },
    ])
    // Telegram navbati: belgi bo'lmagan har alert uchun bitta qator
    const nonBelgi = a.filter((x) => x.severity !== 'belgi').reduce((s, x) => s + x.n, 0)
    expect(
      await scalar<number>(
        db,
        `select count(*)::int from public.notification_outbox where company_id = $1 and kind = 'alert'`,
        [DEMO],
      ),
    ).toBe(nonBelgi)

    const det = await rows<{ type: string; details: Record<string, unknown> }>(
      db,
      `select type::text, details from public.alerts
        where company_id = $1 and type::text in ('narx_ogishi', 'normadan_oshish', 'manfiy_qoldiq', 'otkazma_farqi')
        order by 1`,
      [DEMO],
    )
    expect(det.map((x) => x.type)).toEqual(['manfiy_qoldiq', 'narx_ogishi', 'normadan_oshish', 'otkazma_farqi'])
    expect(det[0]!.details).toMatchObject({ stock_after: -2, unit: 'm³' })
    expect(det[1]!.details).toMatchObject({ direction: 'high', price: 1520 })
    expect(det[2]!.details).toMatchObject({ norm_qty_base: 16000, base_unit: 'dona' })
    expect(det[3]!.details).toMatchObject({ direction: 'under', sent_qty_base: 600, received_qty_base: 560 })
  })

  it('audit: demo yozuvlari tarixda (tizim / veb / mobil), aktyor — faqat demo profillari', async () => {
    const dev = await rows<{ device: string }>(
      db,
      `select distinct device from public.audit_log where company_id = $1 order by 1`,
      [DEMO],
    )
    expect(dev.map((x) => x.device)).toEqual(['mobil', 'tizim', 'veb'])
    expect(
      await scalar<number>(
        db,
        `select count(*)::int from public.audit_log a
          where a.company_id = $1 and a.actor_profile_id is not null
            and not exists (select 1 from public.profiles p where p.id = a.actor_profile_id and p.company_id = $1)`,
        [DEMO],
      ),
    ).toBe(0)
  })
})
