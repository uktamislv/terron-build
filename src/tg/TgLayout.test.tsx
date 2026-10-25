import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import * as authRepo from '@/data/authRepo'
import * as bugReportsRepo from '@/data/bugReportsRepo'
import { RepoError } from '@/data/errors'
import type { AuthSession } from '@/data/types'
import { guides } from '@/i18n/guides.uz'
import type { Role } from '@/domain/roles'
import { t } from '@/i18n'
import { routes } from '@/routes'
import { makeProfile } from '@/test/fixtures'

const auth = vi.hoisted(() => ({
  cb: null as null | ((s: AuthSession | null) => void),
  session: null as AuthSession | null,
}))

vi.mock('@/data/systemRepo', () => ({
  isConfigured: () => true,
  getSystemStatus: () => ({ supabaseConfigured: true }),
}))

vi.mock('@/data/authRepo', () => ({
  getSession: vi.fn(async () => auth.session),
  onAuthChange: vi.fn((cb: (s: AuthSession | null) => void) => {
    auth.cb = cb
    return () => undefined
  }),
  getMyProfile: vi.fn(),
  signOut: vi.fn(async () => undefined),
  signInWithPassword: vi.fn(),
  telegramSignIn: vi.fn(async () => {
    auth.session = { userId: 'u1', email: null, mustChangePassword: false }
    auth.cb?.(auth.session)
    return 'ok'
  }),
}))

// Direktor bosh ekrani ma'lumoti (tarmoqqa chiqmasin)
vi.mock('@/data/reportsRepo', () => ({
  getDashboardSummary: vi.fn(() => new Promise(() => undefined)),
  getNormOverview: vi.fn(async () => []),
}))
vi.mock('@/data/alertsRepo', () => ({ listRecentAlerts: vi.fn(async () => []) }))

vi.mock('@/data/bugReportsRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/bugReportsRepo')>()),
  createBugReport: vi.fn(async () => undefined),
}))

vi.mock('./telegram', () => ({
  isInsideTelegram: () => true,
  getWebApp: () => null,
  getInitData: () => 'init',
  requestContact: vi.fn(),
  botLink: () => 'https://t.me/x',
  initTelegram: vi.fn(),
  stripLaunchParamsFromUrl: vi.fn(),
  haptic: { tap: vi.fn(), success: vi.fn(), error: vi.fn(), select: vi.fn() },
}))

const bottomNav = () => screen.getByRole('navigation', { name: t.app.name })

async function openAs(role: Role, path = '/tg') {
  vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile(role))
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  await screen.findAllByRole('link')
  return router
}

describe('Mini App pastki menyu', () => {
  it('haydovchi — 2 ta band, 2 ustun; /tg → /tg/purchase', async () => {
    const router = await openAs('haydovchi')
    const links = within(bottomNav()).getAllByRole('link')
    expect(links.map((a) => a.textContent)).toEqual([t.tg.nav.purchase, t.tg.nav.mine])
    expect(links[0]?.parentElement).toHaveStyle({ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' })
    // Navigate redirect havolalar chizilgandan keyin bajarilishi mumkin
    await waitFor(() => expect(router.state.location.pathname).toBe('/tg/purchase'))
  })

  it('prorab — Bosh, Kirim/chiqim, Xarid, So‘rov, Yozuvlarim', async () => {
    await openAs('prorab')
    expect(within(bottomNav()).getAllByRole('link').map((a) => a.textContent)).toEqual([
      t.tg.nav.home,
      // Menyuda qisqa yorliq — bir qatorga sig'adi
      t.tg.navShort.movement,
      t.tg.nav.purchase,
      t.tg.nav.request,
      t.tg.nav.mine,
    ])
  })

  it('direktor — Bosh ekran ochiladi', async () => {
    await openAs('direktor')
    expect(await screen.findByText(`${t.tg.hello}, Test direktor!`)).toBeInTheDocument()
  })

  it('haydovchi /tg/movement ga kirsa — "Ruxsat yo‘q"', async () => {
    await openAs('haydovchi', '/tg/movement')
    expect(await screen.findByText(t.forbidden.title)).toBeInTheDocument()
  })
})

describe('Batch 11: sarlavhadagi Yordam va Xatolik haqida xabar', () => {
  beforeEach(() => {
    vi.mocked(bugReportsRepo.createBugReport).mockReset().mockResolvedValue(undefined)
  })

  it('ikki tugma sarlavhada (≥ 44 px), pastki menyuga band qo‘shilmaydi', async () => {
    await openAs('direktor')
    const help = screen.getByRole('link', { name: t.help.open })
    const bug = screen.getByRole('button', { name: t.bugReport.open })
    expect(help).toHaveClass('size-11')
    expect(bug).toHaveClass('size-11')
    expect(within(bottomNav()).getAllByRole('link').map((a) => a.textContent)).toEqual([t.tg.nav.home, t.tg.nav.mine])
    expect(within(bottomNav()).queryByRole('link', { name: t.help.open })).not.toBeInTheDocument()
  })

  it('xabar: matn majburiy; yuboriladi (ekran, qurilma, versiya) va rahmat', async () => {
    await openAs('direktor')
    fireEvent.click(screen.getByRole('button', { name: t.bugReport.open }))
    const dialog = await screen.findByRole('dialog', { name: t.bugReport.title })
    fireEvent.click(within(dialog).getByRole('button', { name: t.bugReport.send }))
    expect(await within(dialog).findByText(t.bugReport.errMessage)).toBeInTheDocument()
    expect(bugReportsRepo.createBugReport).not.toHaveBeenCalled()

    fireEvent.change(within(dialog).getByLabelText(t.bugReport.message), { target: { value: '  Saqlash ishlamadi  ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: t.bugReport.send }))
    expect(await within(dialog).findByText(t.bugReport.sent)).toBeInTheDocument()
    const arg = vi.mocked(bugReportsRepo.createBugReport).mock.calls[0]?.[0]
    expect(arg).toMatchObject({
      companyId: makeProfile('direktor').company_id,
      message: 'Saqlash ishlamadi',
      screen: '/tg',
      appVersion: '1',
      photoPath: null,
    })
    expect(arg?.client).toMatch(/^web/)
    expect(arg?.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('cheklov: "juda ko‘p xabar" matni, forma saqlanadi', async () => {
    vi.mocked(bugReportsRepo.createBugReport).mockImplementation(async () => {
      throw new RepoError('bug_report_rate_limited')
    })
    await openAs('direktor')
    fireEvent.click(screen.getByRole('button', { name: t.bugReport.open }))
    const dialog = await screen.findByRole('dialog', { name: t.bugReport.title })
    fireEvent.change(within(dialog).getByLabelText(t.bugReport.message), { target: { value: 'Xato' } })
    fireEvent.click(within(dialog).getByRole('button', { name: t.bugReport.send }))
    expect(await within(dialog).findByText(t.errors.bug_report_rate_limited)).toBeInTheDocument()
    expect(within(dialog).getByLabelText(t.bugReport.message)).toHaveValue('Xato')
    expect(within(dialog).queryByText(t.bugReport.sent)).not.toBeInTheDocument()
  })

  it('"?" → /tg/help: o‘z roli qo‘llanmasi, boshqa rolga almashtirish', async () => {
    const router = await openAs('direktor')
    fireEvent.click(screen.getByRole('link', { name: t.help.open }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/tg/help'))
    expect(await screen.findByRole('heading', { name: guides.direktor.title })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${t.roles.prorab}`) }))
    expect(await screen.findByRole('heading', { name: guides.prorab.title })).toBeInTheDocument()
  })

  it('/tg/help har qanday rolga ochiq (haydovchi)', async () => {
    await openAs('haydovchi', '/tg/help')
    expect(await screen.findByRole('heading', { name: guides.haydovchi.title })).toBeInTheDocument()
  })
})
