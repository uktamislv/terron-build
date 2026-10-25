import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import * as authRepo from '@/data/authRepo'
import type { AuthSession } from '@/data/types'
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
    const links = screen.getAllByRole('link')
    expect(links.map((a) => a.textContent)).toEqual([t.tg.nav.purchase, t.tg.nav.mine])
    expect(links[0]?.parentElement).toHaveStyle({ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' })
    // Navigate redirect havolalar chizilgandan keyin bajarilishi mumkin
    await waitFor(() => expect(router.state.location.pathname).toBe('/tg/purchase'))
  })

  it('prorab — Bosh, Kirim/chiqim, Xarid, So‘rov, Yozuvlarim', async () => {
    await openAs('prorab')
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual([
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
