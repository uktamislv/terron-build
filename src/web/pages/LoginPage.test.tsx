import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import * as authRepo from '@/data/authRepo'
import { t } from '@/i18n'
import { routes } from '@/routes'

vi.mock('@/data/systemRepo', () => ({
  isConfigured: () => true,
  getSystemStatus: () => ({ supabaseConfigured: true }),
}))

vi.mock('@/data/authRepo', () => ({
  getSession: vi.fn(async () => null),
  onAuthChange: vi.fn(() => () => undefined),
  getMyProfile: vi.fn(async () => null),
  signOut: vi.fn(async () => undefined),
  signInWithPassword: vi.fn(),
  telegramSignIn: vi.fn(),
  clearLocalSession: vi.fn(async () => undefined),
  changePassword: vi.fn(),
  MIN_PASSWORD_LENGTH: 8,
}))

const repo = vi.mocked(authRepo)

async function renderLogin() {
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/login'] })} />)
  await screen.findByRole('heading', { name: t.auth.title })
}

function fill(login: string, password: string) {
  fireEvent.change(screen.getByLabelText(t.auth.loginLabel), { target: { value: login } })
  fireEvent.change(screen.getByLabelText(t.auth.passwordLabel), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: t.auth.submit }))
}

beforeEach(() => {
  repo.signInWithPassword.mockReset()
})

describe('LoginPage', () => {
  it('login maydoni — inputMode "text" (telefon raqamini ham qulay kiritish uchun)', async () => {
    await renderLogin()
    expect(screen.getByLabelText(t.auth.loginLabel)).toHaveAttribute('inputmode', 'text')
  })

  it('email bilan kirish — repo email va parol bilan chaqiriladi', async () => {
    repo.signInWithPassword.mockResolvedValue({ ok: true })
    await renderLogin()
    fill('admin@firma.uz', 'maxfiy-parol')
    await waitFor(() => expect(repo.signInWithPassword).toHaveBeenCalledWith('admin@firma.uz', 'maxfiy-parol'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('telefon bilan kirish — kiritilgan qiymat repo ga beriladi (konvertatsiya repo ichida)', async () => {
    repo.signInWithPassword.mockResolvedValue({ ok: true })
    await renderLogin()
    fill('90 123 45 67', 'maxfiy-parol')
    await waitFor(() => expect(repo.signInWithPassword).toHaveBeenCalledWith('90 123 45 67', 'maxfiy-parol'))
  })

  it('noto‘g‘ri parol — xato xabari', async () => {
    repo.signInWithPassword.mockResolvedValue({ ok: false, error: 'invalid_credentials' })
    await renderLogin()
    fill('admin@firma.uz', 'xato')
    expect(await screen.findByText(t.auth.invalidCredentials)).toBeInTheDocument()
  })

  it('noto‘g‘ri login formati — xato xabari', async () => {
    repo.signInWithPassword.mockResolvedValue({ ok: false, error: 'invalid_login' })
    await renderLogin()
    fill('abc', 'parol1234')
    expect(await screen.findByText(t.auth.invalidLogin)).toBeInTheDocument()
  })

  it('bo‘sh forma — repo chaqirilmaydi', async () => {
    await renderLogin()
    fill('', '')
    expect(await screen.findByText(t.auth.required)).toBeInTheDocument()
    expect(repo.signInWithPassword).not.toHaveBeenCalled()
  })
})
