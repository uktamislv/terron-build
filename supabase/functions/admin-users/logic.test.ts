// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { handleAdminUsers, type AdminUsersDeps, type CallerProfile, type TargetProfile } from './logic.ts'
import type {
  AuthEvent,
  AuthUserInfo,
  CreateAuthUserInput,
  CreateAuthUserResult,
  LoginKind,
  UpdateAuthUserInput,
  UpdateAuthUserResult,
} from '../_shared/authUsers.ts'

const PASSWORD = 'Sir-Parol-12345'
const TARGET_ID = '11111111-2222-4333-8444-555555555555'
const AUTH = 'Bearer caller.jwt.token'
const PHONE_EMAIL = 'p998901234567@phone.terron-build.invalid'

const admin: CallerProfile = { id: 'admin-a', company_id: 'company-a', role: 'admin' }
const superAdmin: CallerProfile = { id: 'sa', company_id: 'company-x', role: 'super_admin' }

function target(over: Partial<TargetProfile> = {}): TargetProfile {
  return {
    id: TARGET_ID,
    company_id: 'company-a',
    role: 'prorab',
    phone: '+998901234567',
    auth_user_id: null,
    ...over,
  }
}

function fake(
  opts: {
    caller?: CallerProfile | null
    callerAuthId?: string | null
    target?: TargetProfile | null
    createResults?: CreateAuthUserResult[]
    updateResults?: UpdateAuthUserResult[]
    existingByEmail?: AuthUserInfo | null
    linkedProfileOf?: Record<string, string>
    linkResult?: boolean
  } = {},
) {
  const calls = {
    jwt: [] as string[],
    create: [] as CreateAuthUserInput[],
    update: [] as { id: string; input: UpdateAuthUserInput }[],
    link: [] as { profileId: string; authUserId: string; kind: LoginKind }[],
    loginKind: [] as { profileId: string; kind: LoginKind }[],
    deleted: [] as string[],
    audit: [] as AuthEvent[],
    logs: [] as unknown[],
  }
  const creates = [...(opts.createResults ?? [])]
  const updates = [...(opts.updateResults ?? [])]
  const deps: AdminUsersDeps = {
    getAuthUserIdFromJwt: async (jwt) => {
      calls.jwt.push(jwt)
      return opts.callerAuthId === undefined ? 'caller-auth' : opts.callerAuthId
    },
    getActiveProfileByAuthUserId: async () => (opts.caller === undefined ? admin : opts.caller),
    getProfileById: async (id) => (id === TARGET_ID ? (opts.target === undefined ? target() : opts.target) : null),
    createAuthUser: async (input) => {
      calls.create.push(input)
      return creates.shift() ?? { ok: true, id: `auth-new-${calls.create.length}` }
    },
    updateAuthUser: async (id, input) => {
      calls.update.push({ id, input })
      return updates.shift() ?? { ok: true }
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
    setLoginKind: async (profileId, kind) => {
      calls.loginKind.push({ profileId, kind })
    },
    logAuthEvent: async (e) => {
      calls.audit.push(e)
    },
    log: (...args) => calls.logs.push(args),
  }
  return { deps, calls }
}

const body = (over: Record<string, unknown> = {}) => ({
  action: 'set_login',
  profile_id: TARGET_ID,
  password: PASSWORD,
  ...over,
})

const exists = { ok: false as const, reason: 'email_exists' as const }

describe('admin-users: kirish validatsiyasi (xato kodlari)', () => {
  it.each([
    ['body yo\'q', null, 'invalid_request'],
    ['massiv', [], 'invalid_request'],
    ['noma\'lum action', body({ action: 'delete_user' }), 'invalid_request'],
    ['profile_id uuid emas', body({ profile_id: 'abc' }), 'invalid_request'],
    ['parol yo\'q', body({ password: undefined }), 'invalid_request'],
    ['parol son', body({ password: 12345678 }), 'invalid_request'],
    ['email turi noto\'g\'ri', body({ email: 5 }), 'invalid_request'],
    ['qisqa parol (7)', body({ password: '1234567' }), 'weak_password'],
    ['juda uzun parol (73 bayt)', body({ password: 'x'.repeat(73) }), 'password_too_long'],
    ['uzun parol (multibayt, 37 belgi = 74 bayt)', body({ password: 'ş'.repeat(37) }), 'password_too_long'],
    ['email formati noto\'g\'ri', body({ email: 'not-an-email' }), 'email_invalid'],
    ['sintetik tg email', body({ email: 'tg123@tg.terron-build.invalid' }), 'email_reserved'],
    ['sintetik telefon email', body({ email: PHONE_EMAIL }), 'email_reserved'],
  ])('%s → 400 %s', async (_name, b, codeExpected) => {
    const f = fake()
    const r = await handleAdminUsers(AUTH, b, f.deps)
    expect(r).toEqual({ status: 400, body: { error: codeExpected } })
    expect(f.calls.create).toHaveLength(0)
    expect(f.calls.update).toHaveLength(0)
  })

  it('parol aynan 8 belgi — qabul qilinadi', async () => {
    expect((await handleAdminUsers(AUTH, body({ password: '12345678' }), fake().deps)).status).toBe(200)
  })
})

describe('admin-users: chaqiruvchi va huquq', () => {
  it('Authorization yo\'q → 401 unauthorized', async () => {
    expect(await handleAdminUsers(null, body(), fake().deps)).toEqual({ status: 401, body: { error: 'unauthorized' } })
  })

  it('JWT yaroqsiz → 401', async () => {
    expect((await handleAdminUsers(AUTH, body(), fake({ callerAuthId: null }).deps)).status).toBe(401)
  })

  it('JWT Bearer\'dan ajratiladi', async () => {
    const f = fake()
    await handleAdminUsers(AUTH, body(), f.deps)
    expect(f.calls.jwt).toEqual(['caller.jwt.token'])
  })

  it('profil yo\'q / nofaol → 403', async () => {
    expect(await handleAdminUsers(AUTH, body(), fake({ caller: null }).deps)).toEqual({
      status: 403,
      body: { error: 'forbidden' },
    })
  })

  it.each(['direktor', 'buxgalter', 'prorab', 'haydovchi'])('%s → 403', async (role) => {
    const f = fake({ caller: { ...admin, role } })
    expect((await handleAdminUsers(AUTH, body(), f.deps)).status).toBe(403)
    expect(f.calls.create).toHaveLength(0)
  })

  it('admin boshqa firma profiliga → 403', async () => {
    const f = fake({ target: target({ company_id: 'company-b' }) })
    expect(await handleAdminUsers(AUTH, body(), f.deps)).toEqual({ status: 403, body: { error: 'forbidden' } })
    expect(f.calls.create).toHaveLength(0)
    expect(f.calls.update).toHaveLength(0)
  })

  it('admin super_admin profiliga (o\'z firmasida ham) → 403', async () => {
    const f = fake({ target: target({ role: 'super_admin', auth_user_id: 'auth-sa' }) })
    expect((await handleAdminUsers(AUTH, body(), f.deps)).status).toBe(403)
    expect(f.calls.update).toHaveLength(0)
  })

  it('admin boshqa admin profiliga → 403', async () => {
    const f = fake({ target: target({ role: 'admin', auth_user_id: 'auth-a2' }) })
    expect((await handleAdminUsers(AUTH, body(), f.deps)).status).toBe(403)
    expect(f.calls.update).toHaveLength(0)
  })

  it('admin o\'z loginini o\'zgartira oladi', async () => {
    const f = fake({ target: target({ id: TARGET_ID, role: 'admin', auth_user_id: 'auth-me' }), caller: { ...admin, id: TARGET_ID } })
    expect((await handleAdminUsers(AUTH, body(), f.deps)).status).toBe(200)
  })

  it('super_admin boshqa firmadagi adminga → 200', async () => {
    const f = fake({ caller: superAdmin, target: target({ company_id: 'company-b', role: 'admin' }) })
    expect((await handleAdminUsers(AUTH, body(), f.deps)).status).toBe(200)
  })

  it('mavjud bo\'lmagan profil → 404 not_found', async () => {
    expect(await handleAdminUsers(AUTH, body(), fake({ target: null }).deps)).toEqual({
      status: 404,
      body: { error: 'not_found' },
    })
  })
})

describe('admin-users: set_login', () => {
  it('auth user yo\'q, email yo\'q → telefondan sintetik email, must_change_password, login_kind web, audit', async () => {
    const f = fake()
    const r = await handleAdminUsers(AUTH, body(), f.deps)
    expect(r).toEqual({ status: 200, body: { ok: true, login: '+998901234567', login_kind: 'web' } })
    expect(f.calls.create).toEqual([
      {
        email: PHONE_EMAIL,
        password: PASSWORD,
        appMetadata: { kind: 'web' },
        userMetadata: { must_change_password: true },
      },
    ])
    expect(f.calls.link).toEqual([{ profileId: TARGET_ID, authUserId: 'auth-new-1', kind: 'web' }])
    expect(f.calls.audit).toEqual([
      {
        company_id: 'company-a',
        actor_profile_id: 'admin-a',
        target_profile_id: TARGET_ID,
        action: 'SET_LOGIN',
        details: { login: '+998901234567', login_type: 'phone', created: true },
      },
    ])
  })

  it('email berilsa → shu email (kichik harf), login = email', async () => {
    const f = fake()
    const r = await handleAdminUsers(AUTH, body({ email: '  Ali@Example.COM ' }), f.deps)
    expect(r).toEqual({ status: 200, body: { ok: true, login: 'ali@example.com', login_kind: 'web' } })
    expect(f.calls.create[0]?.email).toBe('ali@example.com')
  })

  it('bo\'sh email → telefondan', async () => {
    const f = fake()
    await handleAdminUsers(AUTH, body({ email: '' }), f.deps)
    expect(f.calls.create[0]?.email).toBe(PHONE_EMAIL)
  })

  it('mavjud auth user → email, parol, must_change_password yangilanadi; login_kind web; yaratilmaydi', async () => {
    const f = fake({ target: target({ auth_user_id: 'auth-old' }) })
    const r = await handleAdminUsers(AUTH, body({ email: 'new@example.com' }), f.deps)
    expect(r.status).toBe(200)
    expect(f.calls.update).toEqual([
      {
        id: 'auth-old',
        input: { email: 'new@example.com', password: PASSWORD, userMetadata: { must_change_password: true } },
      },
    ])
    expect(f.calls.loginKind).toEqual([{ profileId: TARGET_ID, kind: 'web' }])
    expect(f.calls.create).toHaveLength(0)
    expect(f.calls.link).toHaveLength(0)
    expect(f.calls.audit[0]?.details).toMatchObject({ created: false, login_type: 'email' })
  })

  it('email band, egasi yetim (hech kimga bog\'lanmagan) → o\'chiriladi va qayta yaratiladi', async () => {
    const f = fake({
      createResults: [exists],
      existingByEmail: { id: 'auth-orphan', email: PHONE_EMAIL, app_metadata: {} },
    })
    const r = await handleAdminUsers(AUTH, body(), f.deps)
    expect(r.status).toBe(200)
    expect(f.calls.deleted).toEqual(['auth-orphan'])
    expect(f.calls.create).toHaveLength(2)
    expect(f.calls.link[0]?.authUserId).toBe('auth-new-2')
  })

  it('email band, boshqa profilga bog\'langan → 409 login_taken, hech narsa o\'chirilmaydi', async () => {
    const f = fake({
      createResults: [exists],
      existingByEmail: { id: 'auth-busy', email: PHONE_EMAIL, app_metadata: {} },
      linkedProfileOf: { 'auth-busy': 'p-other' },
    })
    expect(await handleAdminUsers(AUTH, body(), f.deps)).toEqual({ status: 409, body: { error: 'login_taken' } })
    expect(f.calls.deleted).toHaveLength(0)
    expect(f.calls.link).toHaveLength(0)
  })

  it('yangilashda email band, egasi yetim → o\'chirib qayta yangilanadi', async () => {
    const f = fake({
      target: target({ auth_user_id: 'auth-me' }),
      updateResults: [exists],
      existingByEmail: { id: 'auth-orphan', email: 'x@example.com', app_metadata: {} },
    })
    const r = await handleAdminUsers(AUTH, body({ email: 'x@example.com' }), f.deps)
    expect(r.status).toBe(200)
    expect(f.calls.deleted).toEqual(['auth-orphan'])
    expect(f.calls.update).toHaveLength(2)
  })

  it('yangilashda email boshqa profilniki → 409 login_taken', async () => {
    const f = fake({
      target: target({ auth_user_id: 'auth-me' }),
      updateResults: [exists],
      existingByEmail: { id: 'auth-busy', email: 'x@example.com', app_metadata: {} },
      linkedProfileOf: { 'auth-busy': 'p-other' },
    })
    expect((await handleAdminUsers(AUTH, body({ email: 'x@example.com' }), f.deps)).body).toEqual({
      error: 'login_taken',
    })
    expect(f.calls.loginKind).toHaveLength(0)
  })

  it('qayta yaratish ham band (poyga) → 409 conflict', async () => {
    const f = fake({
      createResults: [exists, exists],
      existingByEmail: { id: 'auth-orphan', email: PHONE_EMAIL, app_metadata: {} },
    })
    expect(await handleAdminUsers(AUTH, body(), f.deps)).toEqual({ status: 409, body: { error: 'conflict' } })
  })

  it('bog\'lash poygasi → yaratilgan user o\'chiriladi, 409 conflict', async () => {
    const f = fake({ linkResult: false })
    expect(await handleAdminUsers(AUTH, body(), f.deps)).toEqual({ status: 409, body: { error: 'conflict' } })
    expect(f.calls.deleted).toEqual(['auth-new-1'])
    expect(f.calls.audit).toHaveLength(0)
  })

  it('GoTrue parol siyosati rad etsa → 400 weak_password', async () => {
    const f = fake({ createResults: [{ ok: false, reason: 'weak_password' }] })
    expect(await handleAdminUsers(AUTH, body(), f.deps)).toEqual({ status: 400, body: { error: 'weak_password' } })
  })

  it('ichki xato → 500', async () => {
    const f = fake()
    f.deps.createAuthUser = async () => {
      throw new Error('auth down')
    }
    expect(await handleAdminUsers(AUTH, body(), f.deps)).toEqual({ status: 500, body: { error: 'internal' } })
  })

  it('parol hech qachon javobda, logda va auditda yo\'q (barcha natijalarda)', async () => {
    const scenarios = [
      fake(),
      fake({ target: target({ auth_user_id: 'a' }) }),
      fake({ createResults: [exists], existingByEmail: { id: 'o', email: PHONE_EMAIL, app_metadata: {} } }),
      fake({ createResults: [exists], existingByEmail: { id: 'b', email: PHONE_EMAIL, app_metadata: {} }, linkedProfileOf: { b: 'x' } }),
      fake({ linkResult: false }),
      fake({ target: target({ company_id: 'other' }) }),
    ]
    for (const f of scenarios) {
      const r = await handleAdminUsers(AUTH, body(), f.deps)
      expect(JSON.stringify(r)).not.toContain(PASSWORD)
      expect(JSON.stringify(f.calls.logs)).not.toContain(PASSWORD)
      expect(JSON.stringify(f.calls.audit)).not.toContain(PASSWORD)
    }
    const short = await handleAdminUsers(AUTH, body({ password: 'abc1234' }), fake().deps)
    expect(JSON.stringify(short)).not.toContain('abc1234')
  })
})
