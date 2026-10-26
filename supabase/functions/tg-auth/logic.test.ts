// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  handleTgAuth,
  InitDataReplayGuard,
  REPLAY_GRACE_MS,
  TG_AUTH_MAX_AGE_SEC,
  type TgAuthDeps,
  type TgProfile,
} from './logic.ts'
import { signInitDataForTest } from '../_shared/telegramAuth.testing.ts'
import type { AuthEvent, AuthUserInfo, CreateAuthUserInput, LoginKind } from '../_shared/authUsers.ts'

const TOKEN = '123456789:AAFakeBotTokenForTests_tgauth'
const NOW_SEC = 1_760_000_000
const TG_ID = 555000111
const TG_EMAIL = `tg${TG_ID}@tg.terron-build.invalid`

async function initDataFor(userId = TG_ID, authDate = NOW_SEC - 60, token = TOKEN): Promise<string> {
  return signInitDataForTest(
    { auth_date: String(authDate), query_id: 'AAE', user: JSON.stringify({ id: userId, first_name: 'Ali' }) },
    token,
  )
}

function profile(over: Partial<TgProfile> = {}): TgProfile {
  return {
    id: 'p-1',
    company_id: 'c-1',
    role: 'prorab',
    full_name: 'Ali Valiyev',
    auth_user_id: null,
    is_active: true,
    company_active: true,
    ...over,
  }
}

interface FakeOpts {
  profile?: TgProfile | null
  authEmails?: Record<string, string>
  /** Ketma-ket createAuthUser natijalari (tugasa — muvaffaqiyat). */
  createResults?: ({ ok: true; id: string } | { ok: false; reason: 'email_exists' | 'weak_password' })[]
  existingByEmail?: AuthUserInfo | null
  linkedProfileOf?: Record<string, string>
  linkResult?: boolean
  afterFailedLink?: TgProfile | null
  botToken?: string | undefined
  throwOnFind?: boolean
  jwtUser?: Record<string, string>
  auditThrows?: boolean
  replayGuard?: InitDataReplayGuard
  /** Soat (ms) — standart NOW_SEC * 1000. */
  nowMs?: () => number
}

function fake(opts: FakeOpts = {}) {
  const calls = {
    create: [] as CreateAuthUserInput[],
    deleted: [] as string[],
    link: [] as { profileId: string; authUserId: string; kind: LoginKind }[],
    session: [] as string[],
    audit: [] as AuthEvent[],
    logs: [] as { level: string; message: string; extra?: Record<string, unknown> }[],
  }
  const results = [...(opts.createResults ?? [])]
  let findCount = 0
  let createCount = 0
  const deps: TgAuthDeps = {
    env: { botToken: 'botToken' in opts ? opts.botToken : TOKEN },
    now: opts.nowMs ?? (() => NOW_SEC * 1000),
    ...(opts.replayGuard ? { replayGuard: opts.replayGuard } : {}),
    findProfileByTelegramId: async (id) => {
      if (opts.throwOnFind) throw new Error('db down')
      findCount++
      if (findCount > 1 && opts.afterFailedLink !== undefined) return opts.afterFailedLink
      return id === TG_ID ? (opts.profile === undefined ? profile() : opts.profile) : null
    },
    getAuthUserEmail: async (id) => opts.authEmails?.[id] ?? null,
    getAuthUserIdFromJwt: async (jwt) => opts.jwtUser?.[jwt] ?? null,
    createAuthUser: async (input) => {
      calls.create.push(input)
      createCount++
      return results.shift() ?? { ok: true, id: `auth-new-${createCount}` }
    },
    findAuthUserByEmail: async () => opts.existingByEmail ?? null,
    findProfileIdByAuthUserId: async (id) => opts.linkedProfileOf?.[id] ?? null,
    deleteAuthUser: async (id) => {
      calls.deleted.push(id)
    },
    linkAuthUser: async (profileId, authUserId, kind) => {
      calls.link.push({ profileId, authUserId, kind })
      return opts.linkResult ?? true
    },
    createSession: async (email) => {
      calls.session.push(email)
      return { access_token: 'at', refresh_token: 'rt', expires_at: NOW_SEC + 3600 }
    },
    logAuthEvent: async (e) => {
      if (opts.auditThrows) throw new Error('audit down')
      calls.audit.push(e)
    },
    log: (level, message, extra) => calls.logs.push({ level, message, extra }),
  }
  return { deps, calls }
}

const OK_PROFILE = { id: 'p-1', role: 'prorab', company_id: 'c-1', full_name: 'Ali Valiyev' }

describe('tg-auth: kirish validatsiyasi', () => {
  it.each([
    null,
    'str',
    [],
    {},
    { initData: 1 },
    { initData: '' },
    { initData: 'x'.repeat(9000) },
    { initData: 'a=1', access_token: 5 },
  ])('noto\'g\'ri body → 400 (%#)', async (body) => {
    const r = await handleTgAuth(body, fake().deps)
    expect(r.status).toBe(400)
    expect(r.body).toEqual({ error: 'bad_request' })
  })

  it('bot tokeni sozlanmagan → 500', async () => {
    const f = fake({ botToken: undefined })
    const r = await handleTgAuth({ initData: await initDataFor() }, f.deps)
    expect(r).toEqual({ status: 500, body: { error: 'server_misconfigured' } })
    expect(f.calls.logs.some((l) => l.level === 'error')).toBe(true)
  })
})

describe('tg-auth: initData', () => {
  it('soxta imzo (boshqa token) → 401 invalid_init_data', async () => {
    const f = fake()
    const r = await handleTgAuth({ initData: await initDataFor(TG_ID, NOW_SEC - 60, '999:OTHER') }, f.deps)
    expect(r).toEqual({ status: 401, body: { error: 'invalid_init_data' } })
    expect(f.calls.session).toHaveLength(0)
  })

  it('o\'zgartirilgan user id → 401', async () => {
    const good = await initDataFor()
    const tampered = good.replace(String(TG_ID), '777')
    expect(tampered).not.toBe(good)
    expect((await handleTgAuth({ initData: tampered }, fake().deps)).status).toBe(401)
  })

  it('muddat 15 daqiqa: 14 daqiqalik — OK, 15 daqiqadan eski — 401', async () => {
    expect(TG_AUTH_MAX_AGE_SEC).toBe(900)
    const fresh = await handleTgAuth({ initData: await initDataFor(TG_ID, NOW_SEC - 840) }, fake().deps)
    expect(fresh.status).toBe(200)
    const old = await handleTgAuth({ initData: await initDataFor(TG_ID, NOW_SEC - 900 - 10) }, fake().deps)
    expect(old).toEqual({ status: 401, body: { error: 'invalid_init_data' } })
  })

  it('imzosiz satr → 401', async () => {
    const r = await handleTgAuth({ initData: 'user=%7B%22id%22%3A1%7D&auth_date=1' }, fake().deps)
    expect(r.status).toBe(401)
  })
})

describe('tg-auth: profil holatlari', () => {
  it('profil yo\'q → 200 need_contact, sessiya yo\'q', async () => {
    const f = fake({ profile: null })
    const r = await handleTgAuth({ initData: await initDataFor() }, f.deps)
    expect(r).toEqual({ status: 200, body: { status: 'need_contact' } })
    expect(f.calls.session).toHaveLength(0)
    expect(f.calls.create).toHaveLength(0)
  })

  it('profil nofaol → 403 inactive', async () => {
    const f = fake({ profile: profile({ is_active: false }) })
    expect(await handleTgAuth({ initData: await initDataFor() }, f.deps)).toEqual({
      status: 403,
      body: { error: 'inactive' },
    })
    expect(f.calls.session).toHaveLength(0)
  })

  it('firma nofaol → 403 inactive', async () => {
    const f = fake({ profile: profile({ company_active: false }) })
    expect((await handleTgAuth({ initData: await initDataFor() }, f.deps)).status).toBe(403)
  })
})

describe('tg-auth: yangi auth user', () => {
  it('yaratiladi (app_metadata tg_user_id), login_kind tg bilan bog\'lanadi, audit, sessiya', async () => {
    const f = fake()
    const r = await handleTgAuth({ initData: await initDataFor() }, f.deps)
    expect(r).toEqual({
      status: 200,
      body: {
        status: 'ok',
        session: { access_token: 'at', refresh_token: 'rt', expires_at: NOW_SEC + 3600 },
        profile: OK_PROFILE,
      },
    })
    expect(f.calls.create).toHaveLength(1)
    expect(f.calls.create[0]?.email).toBe(TG_EMAIL)
    expect(f.calls.create[0]?.appMetadata).toEqual({ tg_user_id: TG_ID, kind: 'tg' })
    expect(f.calls.link).toEqual([{ profileId: 'p-1', authUserId: 'auth-new-1', kind: 'tg' }])
    expect(f.calls.session).toEqual([TG_EMAIL])
    expect(f.calls.audit).toEqual([
      {
        company_id: 'c-1',
        actor_profile_id: 'p-1',
        target_profile_id: 'p-1',
        action: 'TG_AUTH_USER_CREATED',
        details: { telegram_user_id: TG_ID, auth_user_id: 'auth-new-1' },
      },
    ])
  })

  it('kuchli tasodifiy parol: ≥ 32 belgi, 4 xil belgi turi, har safar boshqa', async () => {
    const f = fake()
    await handleTgAuth({ initData: await initDataFor() }, f.deps)
    await handleTgAuth({ initData: await initDataFor() }, f.deps)
    const [a, b] = f.calls.create.map((c) => c.password)
    for (const p of [a, b]) {
      expect(p?.length).toBeGreaterThanOrEqual(32)
      expect(p).toMatch(/[A-Z]/)
      expect(p).toMatch(/[a-z]/)
      expect(p).toMatch(/[0-9]/)
      expect(p).toMatch(/[^A-Za-z0-9]/)
    }
    expect(a).not.toBe(b)
  })

  it('audit xatosi sessiyani to\'xtatmaydi (log)', async () => {
    const f = fake({ auditThrows: true })
    const r = await handleTgAuth({ initData: await initDataFor() }, f.deps)
    expect(r.status).toBe(200)
    expect(f.calls.logs.some((l) => l.level === 'error' && l.message.includes('audit'))).toBe(true)
  })

  it('GoTrue weak_password → 500, bog\'lanmaydi', async () => {
    const f = fake({ createResults: [{ ok: false, reason: 'weak_password' }] })
    const r = await handleTgAuth({ initData: await initDataFor() }, f.deps)
    expect(r.status).toBe(500)
    expect(f.calls.link).toHaveLength(0)
  })
})

describe('tg-auth: email band (akkaunt egallashdan himoya)', () => {
  const exists = { ok: false as const, reason: 'email_exists' as const }

  it('yetim, o\'zimiz yaratgan (tg_user_id mos) → o\'chirib qayta yaratiladi', async () => {
    const f = fake({
      createResults: [exists],
      existingByEmail: { id: 'auth-orphan', email: TG_EMAIL, app_metadata: { tg_user_id: TG_ID, kind: 'tg' } },
    })
    const r = await handleTgAuth({ initData: await initDataFor() }, f.deps)
    expect(r.status).toBe(200)
    expect(f.calls.deleted).toEqual(['auth-orphan'])
    expect(f.calls.create).toHaveLength(2)
    expect(f.calls.link[0]?.authUserId).toBe('auth-new-2')
  })

  it('begona (app_metadata.tg_user_id yo\'q — masalan ochiq signup) → 500, o\'chirilmaydi, qayta ishlatilmaydi', async () => {
    const f = fake({
      createResults: [exists],
      existingByEmail: { id: 'auth-foreign', email: TG_EMAIL, app_metadata: {} },
    })
    const r = await handleTgAuth({ initData: await initDataFor() }, f.deps)
    expect(r).toEqual({ status: 500, body: { error: 'internal' } })
    expect(f.calls.deleted).toHaveLength(0)
    expect(f.calls.link).toHaveLength(0)
    expect(f.calls.session).toHaveLength(0)
  })

  it('boshqa profilga bog\'langan → 500, o\'chirilmaydi', async () => {
    const f = fake({
      createResults: [exists],
      existingByEmail: { id: 'auth-x', email: TG_EMAIL, app_metadata: { tg_user_id: TG_ID } },
      linkedProfileOf: { 'auth-x': 'p-other' },
    })
    const r = await handleTgAuth({ initData: await initDataFor() }, f.deps)
    expect(r.status).toBe(500)
    expect(f.calls.deleted).toHaveLength(0)
    expect(f.calls.session).toHaveLength(0)
  })

  it('shu profilga bog\'langan (parallel so\'rov) → o\'sha akkaunt, qayta bog\'lanmaydi', async () => {
    const f = fake({
      createResults: [exists],
      existingByEmail: { id: 'auth-race', email: TG_EMAIL, app_metadata: { tg_user_id: TG_ID } },
      linkedProfileOf: { 'auth-race': 'p-1' },
    })
    const r = await handleTgAuth({ initData: await initDataFor() }, f.deps)
    expect(r.status).toBe(200)
    expect(f.calls.link).toHaveLength(0)
    expect(f.calls.deleted).toHaveLength(0)
    expect(f.calls.session).toEqual([TG_EMAIL])
  })
})

describe('tg-auth: mavjud auth user va access_token', () => {
  it('mavjud auth user (veb login) qayta ishlatiladi — yangi user yaratilmaydi', async () => {
    const f = fake({
      profile: profile({ auth_user_id: 'auth-web' }),
      authEmails: { 'auth-web': 'p998901234567@phone.terron-build.invalid' },
    })
    const r = await handleTgAuth({ initData: await initDataFor() }, f.deps)
    expect(r.status).toBe(200)
    expect(f.calls.create).toHaveLength(0)
    expect(f.calls.link).toHaveLength(0)
    expect(f.calls.session).toEqual(['p998901234567@phone.terron-build.invalid'])
  })

  it('access_token shu akkauntniki → session: null, yangi sessiya yaratilmaydi', async () => {
    const f = fake({ profile: profile({ auth_user_id: 'auth-web' }), jwtUser: { 'jwt-ok': 'auth-web' } })
    const r = await handleTgAuth({ initData: await initDataFor(), access_token: 'jwt-ok' }, f.deps)
    expect(r).toEqual({ status: 200, body: { status: 'ok', session: null, profile: OK_PROFILE } })
    expect(f.calls.session).toHaveLength(0)
  })

  it('access_token boshqa akkauntniki → yangi sessiya', async () => {
    const f = fake({
      profile: profile({ auth_user_id: 'auth-web' }),
      authEmails: { 'auth-web': 'a@example.com' },
      jwtUser: { 'jwt-other': 'auth-someone' },
    })
    const r = await handleTgAuth({ initData: await initDataFor(), access_token: 'jwt-other' }, f.deps)
    expect(r.status).toBe(200)
    expect((r.body as { session: unknown }).session).not.toBeNull()
    expect(f.calls.session).toEqual(['a@example.com'])
  })

  it('access_token yaroqsiz → yangi sessiya', async () => {
    const f = fake({ profile: profile({ auth_user_id: 'auth-web' }), authEmails: { 'auth-web': 'a@example.com' } })
    const r = await handleTgAuth({ initData: await initDataFor(), access_token: 'expired' }, f.deps)
    expect((r.body as { session: unknown }).session).not.toBeNull()
  })

  it('profildagi auth user topilmasa → 500', async () => {
    const f = fake({ profile: profile({ auth_user_id: 'auth-missing' }) })
    expect(await handleTgAuth({ initData: await initDataFor() }, f.deps)).toEqual({
      status: 500,
      body: { error: 'internal' },
    })
    expect(f.calls.session).toHaveLength(0)
  })
})

describe('tg-auth: bog\'lash poygasi va xatolar', () => {
  it('boshqa so\'rov boshqa user bilan bog\'lab ulgurgan → biznikini o\'chiramiz, o\'shanisi bilan sessiya', async () => {
    const f = fake({
      linkResult: false,
      afterFailedLink: profile({ auth_user_id: 'auth-other' }),
      authEmails: { 'auth-other': TG_EMAIL },
    })
    const r = await handleTgAuth({ initData: await initDataFor() }, f.deps)
    expect(r.status).toBe(200)
    expect(f.calls.deleted).toEqual(['auth-new-1'])
    expect(f.calls.session).toEqual([TG_EMAIL])
    expect(f.calls.audit).toHaveLength(0)
  })

  it('bog\'lash muvaffaqiyatsiz va profil hali ham bog\'lanmagan → yaratilgan user o\'chiriladi, 500', async () => {
    const f = fake({ linkResult: false, afterFailedLink: profile() })
    const r = await handleTgAuth({ initData: await initDataFor() }, f.deps)
    expect(r.status).toBe(500)
    expect(f.calls.deleted).toEqual(['auth-new-1'])
    expect(f.calls.session).toHaveLength(0)
  })

  it('bazada xato → 500 internal, initData va token logda yo\'q', async () => {
    const f = fake({ throwOnFind: true })
    const initData = await initDataFor()
    const r = await handleTgAuth({ initData }, f.deps)
    expect(r).toEqual({ status: 500, body: { error: 'internal' } })
    expect(JSON.stringify(f.calls.logs)).not.toContain(initData)
    expect(JSON.stringify(f.calls.logs)).not.toContain(TOKEN)
  })
})

describe('tg-auth: audit — super_admin va initData takrori', () => {
  it('super_admin → 403 role_web_only, sessiya berilmaydi', async () => {
    const f = fake({ profile: profile({ role: 'super_admin', auth_user_id: 'au-1' }), authEmails: { 'au-1': 'a@x.uz' } })
    const r = await handleTgAuth({ initData: await initDataFor() }, f.deps)
    expect(r).toEqual({ status: 403, body: { error: 'role_web_only' } })
    expect(f.calls.session).toHaveLength(0)
    expect(f.calls.create).toHaveLength(0)
  })

  it('admin, direktor — ruxsat', async () => {
    for (const role of ['admin', 'direktor']) {
      const r = await handleTgAuth({ initData: await initDataFor() }, fake({ profile: profile({ role }) }).deps)
      expect(r.status).toBe(200)
    }
  })

  it('bir xil initData: grace ichida takror — OK; graceʼdan keyin — 401 init_data_replayed', async () => {
    const guard = new InitDataReplayGuard()
    let now = NOW_SEC * 1000
    const initData = await initDataFor()
    const first = await handleTgAuth({ initData }, fake({ replayGuard: guard, nowMs: () => now }).deps)
    expect(first.status).toBe(200)
    now += REPLAY_GRACE_MS - 1
    expect((await handleTgAuth({ initData }, fake({ replayGuard: guard, nowMs: () => now }).deps)).status).toBe(200)
    now += 2
    const f = fake({ replayGuard: guard, nowMs: () => now })
    const replay = await handleTgAuth({ initData }, f.deps)
    expect(replay).toEqual({ status: 401, body: { error: 'init_data_replayed' } })
    expect(f.calls.session).toHaveLength(0)
    expect(f.calls.create).toHaveLength(0)
  })

  it('takror, lekin shu akkauntning amaldagi sessiyasi bilan — rad etilmaydi (yangi sessiya yo’q)', async () => {
    const guard = new InitDataReplayGuard()
    let now = NOW_SEC * 1000
    const initData = await initDataFor()
    const opts = { profile: profile({ auth_user_id: 'au-1' }), authEmails: { 'au-1': 'a@x.uz' }, jwtUser: { tok: 'au-1' } }
    expect((await handleTgAuth({ initData }, fake({ ...opts, replayGuard: guard, nowMs: () => now }).deps)).status).toBe(200)
    now += 60_000
    const r = await handleTgAuth({ initData, access_token: 'tok' }, fake({ ...opts, replayGuard: guard, nowMs: () => now }).deps)
    expect(r.status).toBe(200)
    expect((r.body as { session: unknown }).session).toBeNull()
  })

  it('boshqa initData (yangi hash) — ruxsat; need_contact guardʼni band qilmaydi', async () => {
    const guard = new InitDataReplayGuard()
    const a = await handleTgAuth({ initData: await initDataFor(TG_ID, NOW_SEC - 60) }, fake({ replayGuard: guard }).deps)
    const b = await handleTgAuth({ initData: await initDataFor(TG_ID, NOW_SEC - 30) }, fake({ replayGuard: guard }).deps)
    expect([a.status, b.status]).toEqual([200, 200])
    await handleTgAuth({ initData: await initDataFor(TG_ID, NOW_SEC - 20) }, fake({ replayGuard: guard, profile: null }).deps)
    expect(guard.size).toBe(2)
  })

  it('InitDataReplayGuard: muddati o‘tgan yozuv qayta ishlatiladi; LRU chegarasi', () => {
    const g = new InitDataReplayGuard(3)
    expect(g.use('a', 0, 1000)).toBe(true)
    expect(g.use('a', 20_000, 100_000)).toBe(true) // avvalgisi muddati o'tgan — yangi yozuv
    expect(g.use('a', 40_000, 100_000)).toBe(false) // muddat ichida, grace'dan keyin — takror
    for (const k of ['b', 'c', 'd', 'e']) g.use(k, 0, 10_000_000)
    expect(g.size).toBe(3)
  })
})
