import { FunctionsHttpError } from '@supabase/supabase-js'
import { loginEmailFromPhone } from '@shared/loginEmail'
import { changePassword, resolveLoginEmail, signInWithPassword, telegramSignIn } from './authRepo'

const fake = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  setSession: vi.fn(),
  getSession: vi.fn(),
  updateUser: vi.fn(),
  invoke: vi.fn(),
}))

vi.mock('./supabaseClient', () => ({
  isSupabaseConfigured: () => true,
  getSupabase: () => ({
    auth: {
      signInWithPassword: fake.signInWithPassword,
      setSession: fake.setSession,
      getSession: fake.getSession,
      updateUser: fake.updateUser,
    },
    functions: { invoke: fake.invoke },
  }),
}))

function httpError(status: number, body: unknown) {
  return new FunctionsHttpError(new Response(JSON.stringify(body), { status }))
}

beforeEach(() => {
  vi.clearAllMocks()
  fake.getSession.mockResolvedValue({ data: { session: null }, error: null })
})

describe('resolveLoginEmail', () => {
  it('telefon → sintetik email', () => {
    expect(resolveLoginEmail('+998 90 123 45 67')).toBe(loginEmailFromPhone('+998901234567'))
  })
  it('email → kichik harf', () => {
    expect(resolveLoginEmail(' Admin@Firma.UZ ')).toBe('admin@firma.uz')
  })
  it('na email, na telefon → null', () => {
    expect(resolveLoginEmail('salom')).toBeNull()
    expect(resolveLoginEmail('')).toBeNull()
  })
})

describe('signInWithPassword', () => {
  it('telefon kiritilsa, Supabase sintetik email bilan chaqiriladi', async () => {
    fake.signInWithPassword.mockResolvedValue({ error: null })
    const result = await signInWithPassword('901234567', 'parol1234')
    expect(result).toEqual({ ok: true })
    expect(fake.signInWithPassword).toHaveBeenCalledWith({
      email: loginEmailFromPhone('+998901234567'),
      password: 'parol1234',
    })
  })

  it('noto‘g‘ri login — Supabase chaqirilmaydi', async () => {
    expect(await signInWithPassword('salom', 'parol1234')).toEqual({ ok: false, error: 'invalid_login' })
    expect(fake.signInWithPassword).not.toHaveBeenCalled()
  })

  it('400 → invalid_credentials', async () => {
    fake.signInWithPassword.mockResolvedValue({ error: { status: 400, code: 'invalid_credentials' } })
    expect(await signInWithPassword('a@b.uz', 'x')).toEqual({ ok: false, error: 'invalid_credentials' })
  })
})

describe('telegramSignIn', () => {
  it('ok → setSession chaqiriladi', async () => {
    fake.invoke.mockResolvedValue({
      data: { status: 'ok', session: { access_token: 'a', refresh_token: 'r', expires_at: 1 }, profile: {} },
      error: null,
    })
    fake.setSession.mockResolvedValue({ error: null })
    expect(await telegramSignIn('init')).toBe('ok')
    expect(fake.invoke).toHaveBeenCalledWith('tg-auth', { body: { initData: 'init' } })
    expect(fake.setSession).toHaveBeenCalledWith({ access_token: 'a', refresh_token: 'r' })
  })

  it('mavjud sessiya bo‘lsa access_token yuboriladi; session: null — setSession chaqirilmaydi', async () => {
    fake.getSession.mockResolvedValue({ data: { session: { access_token: 'eski-token' } }, error: null })
    fake.invoke.mockResolvedValue({ data: { status: 'ok', session: null, profile: {} }, error: null })
    expect(await telegramSignIn('init')).toBe('ok')
    expect(fake.invoke).toHaveBeenCalledWith('tg-auth', { body: { initData: 'init', access_token: 'eski-token' } })
    expect(fake.setSession).not.toHaveBeenCalled()
  })

  it('need_contact', async () => {
    fake.invoke.mockResolvedValue({ data: { status: 'need_contact' }, error: null })
    expect(await telegramSignIn('init')).toBe('need_contact')
    expect(fake.setSession).not.toHaveBeenCalled()
  })

  it('403 → inactive, 401 → invalid', async () => {
    fake.invoke.mockResolvedValueOnce({ data: null, error: httpError(403, { error: 'inactive' }) })
    expect(await telegramSignIn('init')).toBe('inactive')
    fake.invoke.mockResolvedValueOnce({ data: null, error: httpError(401, { error: 'unauthorized' }) })
    expect(await telegramSignIn('init')).toBe('invalid')
  })

  it('invalid_init_data / init_data_replayed → reopen; role_web_only → web_only', async () => {
    fake.invoke.mockResolvedValueOnce({ data: null, error: httpError(401, { error: 'invalid_init_data' }) })
    expect(await telegramSignIn('init')).toBe('reopen')
    fake.invoke.mockResolvedValueOnce({ data: null, error: httpError(401, { error: 'init_data_replayed' }) })
    expect(await telegramSignIn('init')).toBe('reopen')
    fake.invoke.mockResolvedValueOnce({ data: null, error: httpError(403, { error: 'role_web_only' }) })
    expect(await telegramSignIn('init')).toBe('web_only')
  })

  it('bo‘sh initData → invalid, server chaqirilmaydi', async () => {
    expect(await telegramSignIn('')).toBe('invalid')
    expect(fake.invoke).not.toHaveBeenCalled()
  })
})

describe('changePassword', () => {
  it('parol va must_change_password: false yuboriladi', async () => {
    fake.updateUser.mockResolvedValue({ error: null })
    await changePassword('yangi-parol-1')
    expect(fake.updateUser).toHaveBeenCalledWith({ password: 'yangi-parol-1', data: { must_change_password: false } })
  })
  it('qisqa parol — server chaqirilmaydi', async () => {
    await expect(changePassword('123')).rejects.toMatchObject({ code: 'weak_password' })
    expect(fake.updateUser).not.toHaveBeenCalled()
  })
})
