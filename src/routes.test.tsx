import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import * as authRepo from '@/data/authRepo'
import type { Profile } from '@/data/types'
import { guides } from '@/i18n/guides.uz'
import { makeProfile } from '@/test/fixtures'
import { t } from './i18n'
import { routes } from './routes'

const config = vi.hoisted(() => ({ configured: true }))

vi.mock('@/data/systemRepo', () => ({
  isConfigured: () => config.configured,
  getSystemStatus: () => ({ supabaseConfigured: config.configured }),
}))

vi.mock('@/data/authRepo', () => ({
  getSession: vi.fn(),
  onAuthChange: vi.fn(() => () => undefined),
  getMyProfile: vi.fn(),
  signOut: vi.fn(),
  signInWithPassword: vi.fn(),
  telegramSignIn: vi.fn(),
  clearLocalSession: vi.fn(async () => undefined),
  changePassword: vi.fn(),
  MIN_PASSWORD_LENGTH: 10,
}))

vi.mock('@/data/profilesRepo', () => ({ listProfiles: vi.fn(async () => []), setProfileActive: vi.fn() }))
vi.mock('@/data/objectsRepo', () => ({ listObjects: vi.fn(async () => []) }))
vi.mock('@/data/reportsRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/reportsRepo')>()),
  getDashboardSummary: vi.fn(async () => (await import('@/data/reportsRepo')).normalizeSummary({})),
  getDashboardDaily: vi.fn(async () => []),
  getSpendBreakdown: vi.fn(async () => []),
  getNormOverview: vi.fn(async () => []),
}))
vi.mock('@/data/alertsRepo', () => ({ listRecentAlerts: vi.fn(async () => []) }))
vi.mock('@/data/cashRepo', () => ({ listBalances: vi.fn(async () => []) }))
vi.mock('@/data/objectMembersRepo', () => ({ listObjectMembers: vi.fn(async () => []) }))
vi.mock('@/data/companiesRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/companiesRepo')>()),
  getCompanySettings: vi.fn(async () => (await import('@/data/companiesRepo')).DEFAULT_COMPANY_SETTINGS),
}))

const repo = vi.mocked(authRepo)

function signedInAs(profile: Profile | null) {
  repo.getSession.mockResolvedValue({ userId: 'u1', email: 'a@b.uz', mustChangePassword: false })
  repo.getMyProfile.mockResolvedValue(profile)
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}

async function sideNav() {
  return within(await screen.findByRole('navigation', { name: t.app.name }))
}

beforeEach(() => {
  config.configured = true
  vi.clearAllMocks()
  repo.onAuthChange.mockReturnValue(() => undefined)
  repo.signOut.mockResolvedValue(undefined)
  repo.getSession.mockResolvedValue(null)
  repo.getMyProfile.mockResolvedValue(null)
})

describe('himoyalangan routelar', () => {
  it('sessiyasiz / → /login', async () => {
    const router = renderAt('/')
    expect(await screen.findByRole('heading', { name: t.auth.title })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })

  it('sessiyasiz /users → /login', async () => {
    const router = renderAt('/users')
    await screen.findByRole('heading', { name: t.auth.title })
    expect(router.state.location.pathname).toBe('/login')
  })

  it('kirgan foydalanuvchi /login ga kirsa — bosh sahifaga', async () => {
    signedInAs(makeProfile('admin'))
    const router = renderAt('/login')
    expect(await screen.findByRole('heading', { name: t.reports.title })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })

  it('profil topilmasa — sessiya yopiladi va "Kirish huquqi yo‘q"', async () => {
    signedInAs(null)
    renderAt('/')
    expect(await screen.findByText(t.auth.noAccess)).toBeInTheDocument()
    expect(repo.signOut).toHaveBeenCalled()
  })

  it('Supabase sozlanmagan — login sahifasida xabar, ilova yiqilmaydi', async () => {
    config.configured = false
    renderAt('/')
    expect(await screen.findByText(t.auth.notConfigured)).toBeInTheDocument()
    expect(repo.getSession).not.toHaveBeenCalled()
  })
})

describe('rolga qarab menyu', () => {
  it('admin — hamma bo‘limlar, Foydalanuvchilar va Obyektlar', async () => {
    signedInAs(makeProfile('admin'))
    renderAt('/')
    const nav = await sideNav()
    for (const label of [t.web.nav.dashboard, t.web.nav.materials, t.web.nav.history, t.web.nav.users, t.web.nav.objects]) {
      expect(nav.getByRole('link', { name: label })).toBeInTheDocument()
    }
    expect(screen.getByText('Test admin')).toBeInTheDocument()
    expect(screen.getByText(t.roles.admin)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.common.signOut })).toBeInTheDocument()
  })

  it('prorab — Bosh, Ombor, So‘rovlar; Foydalanuvchilar yo‘q', async () => {
    signedInAs(makeProfile('prorab'))
    renderAt('/')
    const nav = await sideNav()
    expect(nav.getAllByRole('link').map((a) => a.textContent)).toEqual([
      t.web.nav.dashboard,
      t.web.nav.movements,
      t.web.nav.estimates,
      t.web.nav.requests,
    ])
  })

  it('prorab /users ga kirsa — "Ruxsat yo‘q"', async () => {
    signedInAs(makeProfile('prorab'))
    renderAt('/users')
    expect(await screen.findByText(t.forbidden.title)).toBeInTheDocument()
  })

  it('haydovchi — veb menyu bo‘sh, Telegram’ga yo‘naltiriladi', async () => {
    signedInAs(makeProfile('haydovchi'))
    renderAt('/')
    expect(await screen.findByText(t.forbidden.noWeb)).toBeInTheDocument()
    const nav = await sideNav()
    expect(nav.queryAllByRole('link')).toHaveLength(0)
  })

  it('admin /users — sahifa ochiladi', async () => {
    signedInAs(makeProfile('admin'))
    renderAt('/users')
    expect(await screen.findByRole('heading', { name: t.users.title })).toBeInTheDocument()
  })
})

describe('boshqa', () => {
  it('noma’lum yo‘l — 404', async () => {
    signedInAs(makeProfile('admin'))
    renderAt('/yoq-sahifa')
    expect(await screen.findByText(t.notFound.title)).toBeInTheDocument()
  })

  it('/tg brauzerda — "Ilovani Telegram orqali oching"', async () => {
    renderAt('/tg')
    expect(await screen.findByText(t.tg.gate.outsideTitle)).toBeInTheDocument()
    await waitFor(() => expect(repo.telegramSignIn).not.toHaveBeenCalled())
  })
})

describe('profil yuklash xatosi', () => {
  it('tarmoq xatosi — sessiya yopilmaydi, "Aloqa yo‘q" va qayta urinish', async () => {
    repo.getSession.mockResolvedValue({ userId: 'u1', email: 'a@b.uz', mustChangePassword: false })
    repo.getMyProfile.mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue(makeProfile('admin'))
    renderAt('/')
    expect(await screen.findByText(t.auth.offlineText)).toBeInTheDocument()
    expect(repo.signOut).not.toHaveBeenCalled()
    expect(screen.queryByText(t.auth.noAccess)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t.common.retry }))
    expect(await screen.findByRole('heading', { name: t.reports.title })).toBeInTheDocument()
  })
})

describe('majburiy parol o‘zgartirish', () => {
  beforeEach(() => {
    repo.getSession.mockResolvedValue({ userId: 'u1', email: 'a@b.uz', mustChangePassword: true })
    repo.getMyProfile.mockResolvedValue(makeProfile('admin'))
  })

  it('must_change_password — boshqa sahifalar o‘rniga "Parolni o‘zgartiring"', async () => {
    renderAt('/users')
    expect(await screen.findByRole('heading', { name: t.password.forcedTitle })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: t.users.title })).not.toBeInTheDocument()
  })

  it('parollar mos kelmasa — xato; mos kelsa — changePassword va panel ochiladi', async () => {
    repo.changePassword.mockResolvedValue(undefined)
    renderAt('/')
    await screen.findByRole('heading', { name: t.password.forcedTitle })
    fireEvent.change(screen.getByLabelText(t.password.newPassword), { target: { value: 'yangi-parol-1' } })
    fireEvent.change(screen.getByLabelText(t.password.repeatPassword), { target: { value: 'boshqa-parol' } })
    fireEvent.click(screen.getByRole('button', { name: t.password.submit }))
    expect(await screen.findByText(t.password.errMismatch)).toBeInTheDocument()
    expect(repo.changePassword).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(t.password.repeatPassword), { target: { value: 'yangi-parol-1' } })
    repo.getSession.mockResolvedValue({ userId: 'u1', email: 'a@b.uz', mustChangePassword: false })
    fireEvent.click(screen.getByRole('button', { name: t.password.submit }))
    await waitFor(() => expect(repo.changePassword).toHaveBeenCalledWith('yangi-parol-1'))
    expect(await screen.findByRole('heading', { name: t.reports.title })).toBeInTheDocument()
  })

  it('oddiy sessiyada header’da "Parolni o‘zgartirish" dialogi', async () => {
    repo.getSession.mockResolvedValue({ userId: 'u1', email: 'a@b.uz', mustChangePassword: false })
    renderAt('/')
    fireEvent.click(await screen.findByRole('button', { name: t.password.change }))
    expect(await screen.findByRole('dialog', { name: t.password.change })).toBeInTheDocument()
  })
})

describe('Batch 11: Sozlamalar sahifasi va Yordam', () => {
  it('admin — "Sozlamalar" yon menyuning oxirgi bandi va /settings sahifasi', async () => {
    signedInAs(makeProfile('admin'))
    const router = renderAt('/')
    const links = (await sideNav()).getAllByRole('link')
    expect(links.at(-1)).toHaveTextContent(t.web.nav.settings)
    fireEvent.click(links.at(-1) as HTMLElement)
    expect(await screen.findByRole('heading', { name: t.settings.title })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/settings')
    expect(screen.getByRole('tab', { name: t.settings.tabCompany })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: t.settings.tabBugs })).toBeInTheDocument()
  })

  it('direktor /settings — "Ruxsat yo‘q", menyuda yo‘q', async () => {
    signedInAs(makeProfile('direktor'))
    renderAt('/settings')
    expect(await screen.findByText(t.forbidden.title)).toBeInTheDocument()
    expect((await sideNav()).queryByRole('link', { name: t.web.nav.settings })).not.toBeInTheDocument()
  })

  it('prorab — yon menyuda "Yordam" → /help, o‘z roli qo‘llanmasi', async () => {
    signedInAs(makeProfile('prorab'))
    const router = renderAt('/')
    fireEvent.click(await screen.findByRole('link', { name: t.help.open }))
    expect(await screen.findByRole('heading', { name: guides.prorab.title })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/help')
  })

  it('/help: "Chop etish" — window.print; haydovchi ham ochadi', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    signedInAs(makeProfile('haydovchi'))
    renderAt('/help')
    expect(await screen.findByRole('heading', { name: guides.haydovchi.title })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t.help.print }))
    expect(print).toHaveBeenCalledTimes(1)
    print.mockRestore()
  })
})
