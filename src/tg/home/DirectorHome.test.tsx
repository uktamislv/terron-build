import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext, type AuthState } from '@/auth/authContext'
import * as reportsRepo from '@/data/reportsRepo'
import type { NormOverviewRow } from '@/data/reportsRepo'
import type { Role } from '@/domain/roles'
import { t } from '@/i18n'
import { makeProfile } from '@/test/fixtures'
import { TgHomePage } from '../pages/TgHomePage'
import { objectUsage } from './usage'

vi.mock('@/data/reportsRepo', async (orig) => {
  const real = await orig<typeof import('@/data/reportsRepo')>()
  return {
    ...real,
    getDashboardSummary: vi.fn(async () =>
      real.normalizeSummary({ kirim_count: 3, chiqim_count: 2, purchases_sum: '2500000', alerts_open: 4, alerts_serious_open: 1 }),
    ),
    getNormOverview: vi.fn(),
  }
})

vi.mock('@/data/alertsRepo', () => ({
  listSiteAlerts: vi.fn(async () => []),
  listRecentAlerts: vi.fn(async () =>
    Array.from({ length: 10 }, (_, i) => ({
      id: `a${i}`,
      company_id: 'c',
      type: 'normadan_oshish',
      status: 'yangi',
      severity: 'ogohlantirish',
      object_id: 'o1',
      material_id: null,
      purchase_id: null,
      movement_id: null,
      details: {},
      closed_by: null,
      closed_at: null,
      close_note: null,
      created_at: '2026-10-20T05:00:00Z',
      deleted_at: null,
      object_name: 'Obyekt A',
      material_name: null,
      base_unit: null,
    })),
  ),
}))

vi.mock('@/data/movementsRepo', () => ({ listMyMovements: vi.fn(async () => []) }))
vi.mock('../telegram', () => ({
  getWebApp: () => null,
  haptic: { tap: vi.fn(), success: vi.fn(), error: vi.fn(), select: vi.fn() },
}))

function norm(o: string, m: string, allowed: string, consumed: string): NormOverviewRow {
  return {
    object_id: o,
    object_name: `Obyekt ${o}`,
    material_id: m,
    material_name: `Material ${m}`,
    base_unit: 'kg',
    norm_qty_base: allowed,
    allowed_qty_base: allowed,
    consumed_qty_base: consumed,
    usage_pct: null,
  }
}

const NORMS = [norm('A', 'm1', '100', '50'), norm('A', 'm2', '100', '150'), norm('B', 'm1', '200', '20')]

function renderAs(role: Role) {
  const value = { profile: makeProfile(role) } as unknown as AuthState
  render(
    <MemoryRouter>
      <AuthContext.Provider value={value}>
        <TgHomePage />
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(reportsRepo.getNormOverview).mockResolvedValue(NORMS)
})

describe('Mini App direktor bosh ekrani', () => {
  it('bugun: kartochkalar, smeta ishlatilishi, 10 ta ogohlantirish', async () => {
    renderAs('direktor')
    expect(await screen.findByTestId('tg-kirim')).toHaveTextContent('3')
    expect(screen.getByTestId('tg-purchases')).toHaveTextContent('2 500 000 so‘m')
    expect(screen.getByTestId('tg-alerts')).toHaveTextContent(t.reports.tg.serious('1'))
    const call = vi.mocked(reportsRepo.getDashboardSummary).mock.calls[0]?.[0]
    expect(call?.from).toBe(call?.to)

    const objects = await screen.findAllByTestId('tg-object-usage')
    expect(objects.map((o) => o.textContent)).toEqual([
      expect.stringContaining('Obyekt A'),
      expect.stringContaining('Obyekt B'),
    ])
    expect(within(objects[0] as HTMLElement).getByText(t.reports.tg.overCount(1))).toBeInTheDocument()
    expect(await screen.findAllByTestId('tg-alert')).toHaveLength(10)
  })

  it('7 kun — davr o‘zgaradi', async () => {
    renderAs('admin')
    await screen.findByTestId('tg-kirim')
    fireEvent.click(screen.getByRole('button', { name: t.reports.tg.periods.last7 }))
    await waitFor(() => {
      const last = vi.mocked(reportsRepo.getDashboardSummary).mock.lastCall?.[0]
      expect(last && last.from < last.to).toBe(true)
    })
  })

  it('obyekt bosilsa — materiallar progress bilan, oshgani birinchi; orqaga', async () => {
    renderAs('direktor')
    const [first] = await screen.findAllByTestId('tg-object-usage')
    fireEvent.click(first as HTMLElement)
    const mats = await screen.findAllByTestId('tg-material-usage')
    expect(mats.map((m) => within(m).getByRole('meter').getAttribute('aria-label'))).toEqual(['Material m2', 'Material m1'])
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.reports.tg.backToObjects) }))
    expect(await screen.findAllByTestId('tg-object-usage')).toHaveLength(2)
  })

  it('boshqa rollar — oddiy salomlashish ekrani', () => {
    renderAs('prorab')
    expect(screen.getByText(`${t.tg.hello}, Test prorab!`)).toBeInTheDocument()
    // Ikki katta harakat plitkasi — kirim/chiqim ekraniga
    expect(screen.getByRole('link', { name: new RegExp(t.movements.types.kirim) })).toHaveAttribute('href', '/tg/movement')
    expect(screen.getByRole('link', { name: new RegExp(t.movements.types.chiqim) })).toHaveAttribute('href', '/tg/movement')
    expect(reportsRepo.getDashboardSummary).not.toHaveBeenCalled()
  })
})

describe('objectUsage', () => {
  it('o‘rtacha foiz va oshganlar soni', () => {
    const [a, b] = objectUsage(NORMS)
    expect(a).toMatchObject({ objectId: 'A', avgPct: '100', overCount: 1 })
    expect(b).toMatchObject({ objectId: 'B', avgPct: '10', overCount: 0 })
  })
})
