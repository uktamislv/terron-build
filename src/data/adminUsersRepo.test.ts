import { FunctionsHttpError } from '@supabase/supabase-js'
import { t } from '@/i18n'
import { errorText } from '@/i18n/errorText'
import { setLogin, setLoginErrorCode } from './adminUsersRepo'

const fake = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('./supabaseClient', () => ({
  isSupabaseConfigured: () => true,
  getSupabase: () => ({ functions: { invoke: fake.invoke } }),
}))

function httpError(status: number, body: unknown) {
  return { data: null, error: new FunctionsHttpError(new Response(JSON.stringify(body), { status })) }
}

beforeEach(() => vi.clearAllMocks())

describe('setLoginErrorCode — shartnoma xaritasi', () => {
  it.each([
    [400, 'invalid_request', 'invalid_request'],
    [400, 'weak_password', 'weak_password'],
    [400, 'password_too_long', 'password_too_long'],
    [400, 'email_invalid', 'email_invalid'],
    [400, 'email_reserved', 'email_reserved'],
    [401, 'unauthorized', 'session_expired'],
    [401, undefined, 'session_expired'],
    [403, 'forbidden', 'forbidden'],
    [404, 'not_found', 'not_found'],
    [409, 'login_taken', 'login_taken'],
    [409, 'conflict', 'conflict'],
    [409, undefined, 'conflict'],
    [500, 'boom', 'unknown'],
  ] as const)('%i %s → %s', (status, body, code) => {
    expect(setLoginErrorCode(status, body)).toBe(code)
  })

  it('har bir kodga o‘zbekcha xabar bor; conflict → "Qayta urinib ko‘ring"', () => {
    expect(t.errors.conflict).toMatch(/Qayta urinib ko‘ring/)
    expect(t.errors.session_expired).toMatch(/qayta kiring/i)
  })
})

describe('setLogin', () => {
  it('muvaffaqiyat — login va login_kind', async () => {
    fake.invoke.mockResolvedValue({ data: { ok: true, login: '+998901234567', login_kind: 'web' }, error: null })
    await expect(setLogin({ profileId: 'p1', email: ' ', password: 'parol-12345' })).resolves.toEqual({
      login: '+998901234567',
      loginKind: 'web',
      existingLoginReplaced: false,
    })
    expect(fake.invoke).toHaveBeenCalledWith('admin-users', {
      body: { action: 'set_login', profile_id: 'p1', password: 'parol-12345' },
    })
  })

  it('401 → sessiya tugagan (forbidden emas)', async () => {
    fake.invoke.mockResolvedValue(httpError(401, { error: 'unauthorized' }))
    const err = await setLogin({ profileId: 'p1', password: 'parol-12345' }).catch((e: unknown) => e)
    expect(errorText(err)).toBe(t.errors.session_expired)
  })

  it('existing_login_replaced — natijada belgi (egasiga xabar boradi)', async () => {
    fake.invoke.mockResolvedValue({ data: { ok: true, login: 'a@b.uz', login_kind: 'web', existing_login_replaced: true }, error: null })
    await expect(setLogin({ profileId: 'p1', email: 'a@b.uz', password: 'parol-12345' })).resolves.toMatchObject({
      existingLoginReplaced: true,
    })
  })

  it('403 forbidden_target — boshqa firma / himoyalangan profil', async () => {
    fake.invoke.mockResolvedValue(httpError(403, { error: 'forbidden_target' }))
    const err = await setLogin({ profileId: 'p1', password: 'parol-12345' }).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'forbidden_target' })
    expect(errorText(err)).toBe(t.errors.forbidden_target)
  })

  it('409 login_taken', async () => {
    fake.invoke.mockResolvedValue(httpError(409, { error: 'login_taken' }))
    await expect(setLogin({ profileId: 'p1', password: 'parol-12345' })).rejects.toMatchObject({ code: 'login_taken' })
  })
})
