// @vitest-environment node
// supabaseAdmin.ts (Deno, service_role) — Telegram / auth bog'lash so'rovlarining xavfsizlik
// filtrlari. service_role RLS'ni chetlab o'tadi, shuning uchun har filtr (telefon, faollik,
// bog'lanmaganlik, o'chirilmaganlik, firma faolligi) aynan shu kodda bo'lishi shart.
// Soxta PostgREST builder har chaqiruvni (.from/.select/.update/.eq/.is/.in) yozib boradi.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type Call = [string, ...unknown[]]
interface Query {
  table: string
  calls: Call[]
}

const fake = vi.hoisted(() => ({
  queries: [] as { table: string; calls: [string, ...unknown[]][] }[],
  /** Har `from()` uchun navbatdagi natija ({ data, error }). */
  results: [] as { data: unknown; error: unknown }[],
}))

vi.mock('npm:@supabase/supabase-js@2.118.0', () => ({
  createClient: () => ({
    from: (table: string) => {
      const q = { table, calls: [] as [string, ...unknown[]][] }
      fake.queries.push(q)
      const result = fake.results.shift() ?? { data: [], error: null }
      const builder: unknown = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (prop === 'then') {
              return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
                Promise.resolve(result).then(resolve, reject)
            }
            return (...args: unknown[]) => {
              q.calls.push([prop, ...args])
              return builder
            }
          },
        },
      )
      return builder
    },
  }),
}))

interface AdminModule {
  linkTelegram(profileId: string, telegramUserId: number, chatId: number, e164: string): Promise<boolean>
  linkableProfilesByPhone(e164: string): Promise<{ id: string; company_id: string }[]>
  linkAuthUser(profileId: string, authUserId: string, kind: string): Promise<boolean>
}

let mod: AdminModule

beforeAll(async () => {
  // Deno.env — Edge Function muhiti taqlidi
  ;(globalThis as unknown as { Deno: unknown }).Deno = {
    env: { get: (k: string) => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc' })[k] },
  }
  // Deno moduli tsc (tsconfig.node) tekshiruvidan tashqarida — yo'l o'zgaruvchida
  const path = './supabaseAdmin.ts'
  mod = (await import(/* @vite-ignore */ path)) as AdminModule
})

afterAll(() => {
  delete (globalThis as unknown as { Deno?: unknown }).Deno
})

beforeEach(() => {
  fake.queries.length = 0
  fake.results.length = 0
})

const q = (i: number): Query => {
  const x = fake.queries[i]
  if (!x) throw new Error(`so'rov #${i} yo'q`)
  return x
}
const filters = (x: Query): Call[] => x.calls.filter((c) => c[0] === 'eq' || c[0] === 'is' || c[0] === 'in')

describe('linkTelegram', () => {
  it('faqat: shu id, shu telefon, faol, telegram bog`lanmagan, o`chirilmagan — update + select(id)', async () => {
    fake.results.push({ data: [{ id: 'p1' }], error: null })
    expect(await mod.linkTelegram('p1', 777, 888, '+998901234567')).toBe(true)
    expect(fake.queries).toHaveLength(1)
    const x = q(0)
    expect(x.table).toBe('profiles')
    expect(x.calls[0]).toEqual(['update', { telegram_user_id: 777, telegram_chat_id: 888 }])
    expect(filters(x)).toEqual(
      expect.arrayContaining([
        ['eq', 'id', 'p1'],
        ['eq', 'phone', '+998901234567'],
        ['eq', 'is_active', true],
        ['is', 'telegram_user_id', null],
        ['is', 'deleted_at', null],
      ]),
    )
    expect(filters(x)).toHaveLength(5)
    expect(x.calls).toContainEqual(['select', 'id'])
  })

  it('hech qator yangilanmasa (shart o`zgargan) — false; 23505 — false; boshqa xato — throw', async () => {
    fake.results.push({ data: [], error: null })
    expect(await mod.linkTelegram('p1', 1, 1, '+998901234567')).toBe(false)
    fake.results.push({ data: null, error: { code: '23505', message: 'dup' } })
    expect(await mod.linkTelegram('p1', 1, 1, '+998901234567')).toBe(false)
    fake.results.push({ data: null, error: { code: '42501', message: 'x' } })
    await expect(mod.linkTelegram('p1', 1, 1, '+998901234567')).rejects.toThrow(/link tg/)
  })
})

describe('linkableProfilesByPhone', () => {
  it('profiles: telefon, faol, o`chirilmagan, telegram bog`lanmagan; so`ng firmalar: faol va o`chirilmagan', async () => {
    fake.results.push({
      data: [
        { id: 'p1', company_id: 'c1' },
        { id: 'p2', company_id: 'c2' },
        { id: 'p3', company_id: 'c1' },
      ],
      error: null,
    })
    fake.results.push({ data: [{ id: 'c1' }], error: null })
    const r = await mod.linkableProfilesByPhone('+998901234567')
    // Faol bo'lmagan firma (c2) profili chiqarib tashlanadi
    expect(r).toEqual([
      { id: 'p1', company_id: 'c1' },
      { id: 'p3', company_id: 'c1' },
    ])
    const p = q(0)
    expect(p.table).toBe('profiles')
    expect(p.calls).toContainEqual(['select', 'id, company_id'])
    expect(filters(p)).toEqual(
      expect.arrayContaining([
        ['eq', 'phone', '+998901234567'],
        ['eq', 'is_active', true],
        ['is', 'deleted_at', null],
        ['is', 'telegram_user_id', null],
      ]),
    )
    expect(filters(p)).toHaveLength(4)
    const c = q(1)
    expect(c.table).toBe('companies')
    expect(filters(c)).toEqual(
      expect.arrayContaining([
        ['in', 'id', ['c1', 'c2']],
        ['eq', 'is_active', true],
        ['is', 'deleted_at', null],
      ]),
    )
    expect(filters(c)).toHaveLength(3)
  })

  it('profil topilmasa — firma so`rovi yo`q, bo`sh ro`yxat; xato — throw', async () => {
    fake.results.push({ data: [], error: null })
    expect(await mod.linkableProfilesByPhone('+998901234567')).toEqual([])
    expect(fake.queries.map((x) => x.table)).toEqual(['profiles'])
    fake.results.push({ data: null, error: { message: 'boom' } })
    await expect(mod.linkableProfilesByPhone('+998901234567')).rejects.toThrow(/profiles\(phone\)/)
  })

  it('firma so`rovi xato bersa — throw (filtrsiz natija qaytmaydi)', async () => {
    fake.results.push({ data: [{ id: 'p1', company_id: 'c1' }], error: null })
    fake.results.push({ data: null, error: { message: 'boom' } })
    await expect(mod.linkableProfilesByPhone('+998901234567')).rejects.toThrow(/companies/)
  })
})

describe('linkAuthUser', () => {
  it('faqat: shu id, auth_user_id bo`sh, o`chirilmagan — update(auth_user_id, login_kind) + select(id)', async () => {
    fake.results.push({ data: [{ id: 'p1' }], error: null })
    expect(await mod.linkAuthUser('p1', 'auth-1', 'tg')).toBe(true)
    const x = q(0)
    expect(x.table).toBe('profiles')
    expect(x.calls[0]).toEqual(['update', { auth_user_id: 'auth-1', login_kind: 'tg' }])
    expect(filters(x)).toEqual(
      expect.arrayContaining([
        ['eq', 'id', 'p1'],
        ['is', 'auth_user_id', null],
        ['is', 'deleted_at', null],
      ]),
    )
    expect(filters(x)).toHaveLength(3)
    expect(x.calls).toContainEqual(['select', 'id'])
  })

  it('0 qator — false; 23505 — false; boshqa xato — throw', async () => {
    fake.results.push({ data: [], error: null })
    expect(await mod.linkAuthUser('p1', 'a', 'web')).toBe(false)
    fake.results.push({ data: null, error: { code: '23505', message: 'dup' } })
    expect(await mod.linkAuthUser('p1', 'a', 'web')).toBe(false)
    fake.results.push({ data: null, error: { code: 'XX000', message: 'x' } })
    await expect(mod.linkAuthUser('p1', 'a', 'web')).rejects.toThrow(/link auth/)
  })
})
