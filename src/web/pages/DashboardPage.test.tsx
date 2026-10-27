import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import * as authRepo from '@/data/authRepo'
import * as reportsRepo from '@/data/reportsRepo'
import type { Role } from '@/domain/roles'
import { t } from '@/i18n'
import * as excel from '@/lib/excelExport'
import { routes } from '@/routes'
import { makeObject, makeProfile } from '@/test/fixtures'

vi.mock('@/data/systemRepo', () => ({
  isConfigured: () => true,
  getSystemStatus: () => ({ supabaseConfigured: true }),
}))

vi.mock('@/data/authRepo', () => ({
  getSession: vi.fn(async () => ({ userId: 'u1', email: 'a@b.uz', mustChangePassword: false })),
  onAuthChange: vi.fn(() => () => undefined),
  getMyProfile: vi.fn(),
  signOut: vi.fn(),
  signInWithPassword: vi.fn(),
  telegramSignIn: vi.fn(),
  clearLocalSession: vi.fn(),
  changePassword: vi.fn(),
  MIN_PASSWORD_LENGTH: 8,
}))

vi.mock('@/data/reportsRepo', async (orig) => {
  const real = await orig<typeof import('@/data/reportsRepo')>()
  return {
    ...real,
    getDashboardSummary: vi.fn(async () =>
      real.normalizeSummary({ kirim_count: 12, chiqim_count: 4, purchases_count: 2, purchases_sum: '1500000', alerts_open: 3, alerts_serious_open: 1 }),
    ),
    getDashboardDaily: vi.fn(async (r: { from: string }) => [
      { day: r.from, kirim_count: 5, chiqim_count: 1, purchases_sum: '1500000', alerts_count: 0 },
    ]),
    getSpendBreakdown: vi.fn(async () => [
      { key: 'm1', label: 'Sement', purchases_sum: '1500000', purchases_count: 2, expenses_sum: '0', expenses_count: 0, total_sum: '1500000' },
    ]),
    getEstimateVsSpend: vi.fn(async () => []),
    getNormOverview: vi.fn(async () => []),
  }
})

vi.mock('@/data/alertsRepo', () => ({
  listRecentAlerts: vi.fn(async () => [
    {
      id: 'a1',
      company_id: 'c',
      type: 'narx_ogishi',
      status: 'yangi',
      severity: 'jiddiy',
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
    },
  ]),
}))
vi.mock('@/data/cashRepo', () => ({ listBalances: vi.fn(async () => []) }))
vi.mock('@/data/profilesRepo', () => ({ listProfiles: vi.fn(async () => []) }))
vi.mock('@/data/objectsRepo', () => ({ listObjects: vi.fn(async () => [makeObject('3f2b8c1e-1d2a-4b5c-9d8e-0f1a2b3c4d5e', 'Obyekt A')]) }))

vi.mock('@/lib/excelExport', async (orig) => ({
  ...(await orig<typeof import('@/lib/excelExport')>()),
  exportWorkbook: vi.fn(async () => undefined),
}))

// Recharts mock: diagramma qatorlari data-rows atributida tekshiriladi
vi.mock('recharts', () => {
  const Chart = ({ data, children }: { data: unknown[]; children?: ReactNode }) => {
    // Diagramma xatosini sinash uchun
    if (data.some((d) => (d as { label?: string }).label === 'BOOM')) throw new Error('chart crashed')
    return (
      <div data-testid="chart" data-rows={JSON.stringify(data)}>
        {children}
      </div>
    )
  }
  const Nothing = () => null
  return {
    ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    ComposedChart: Chart,
    BarChart: Chart,
    Bar: Nothing,
    Line: Nothing,
    Cell: Nothing,
    CartesianGrid: Nothing,
    Legend: Nothing,
    Tooltip: Nothing,
    XAxis: Nothing,
    YAxis: Nothing,
  }
})

const reports = vi.mocked(reportsRepo)

function openAs(role: Role, path = '/') {
  vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile(role))
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-25T07:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DashboardPage', () => {
  it('standart 7 kun; kartochkalar va havolalar filtr bilan; diagramma qatorlari', async () => {
    openAs('direktor')
    const kirim = await screen.findByTestId('card-kirim')
    expect(reports.getDashboardSummary).toHaveBeenCalledWith({ from: '2026-10-19', to: '2026-10-25', objectId: null })
    expect(within(kirim).getByText('12 ta')).toBeInTheDocument()
    expect(within(kirim).getByRole('link')).toHaveAttribute('href', '/movements?type=kirim&from=2026-10-19&to=2026-10-25')
    expect(screen.getByTestId('card-alertsOpen')).toHaveAttribute('data-tone', 'danger')
    expect(within(screen.getByTestId('card-alertsOpen')).getByText(t.reports.now)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.reports.presets.last7 })).toHaveAttribute('aria-pressed', 'true')

    const charts = await screen.findAllByTestId('chart')
    const daily = JSON.parse(charts[0]?.getAttribute('data-rows') ?? '[]') as { day: string; kirim: number }[]
    expect(daily).toHaveLength(7)
    expect(daily[0]).toMatchObject({ day: '2026-10-19', kirim: 5 })
    // Norma bo'sh — "Ma'lumot yo'q"
    expect(within(screen.getByRole('region', { name: t.reports.charts.norm })).getByText(t.reports.noData)).toBeInTheDocument()
    expect(await screen.findByTestId('recent-alert')).toHaveTextContent('Obyekt A')
  })

  it('davr tugmasi va obyekt — URL yangilanadi, so‘rov qayta yuboriladi', async () => {
    const router = openAs('admin')
    await screen.findByTestId('card-kirim')
    fireEvent.click(screen.getByRole('button', { name: t.reports.presets.thisMonth }))
    await waitFor(() => expect(router.state.location.search).toBe('?from=2026-10-01&to=2026-10-25'))
    await waitFor(() =>
      expect(reports.getDashboardSummary).toHaveBeenLastCalledWith({ from: '2026-10-01', to: '2026-10-25', objectId: null }),
    )
    await screen.findByRole('option', { name: 'Obyekt A' })
    fireEvent.change(screen.getByLabelText(t.reports.object), { target: { value: '3f2b8c1e-1d2a-4b5c-9d8e-0f1a2b3c4d5e' } })
    await waitFor(() => expect(router.state.location.search).toBe('?from=2026-10-01&to=2026-10-25&object=3f2b8c1e-1d2a-4b5c-9d8e-0f1a2b3c4d5e'))
    expect(within(await screen.findByTestId('card-purchases')).getByRole('link')).toHaveAttribute(
      'href',
      '/purchases?from=2026-10-01&to=2026-10-25&object=3f2b8c1e-1d2a-4b5c-9d8e-0f1a2b3c4d5e',
    )
  })

  it('URL dan ixtiyoriy davr; noto‘g‘ri kiritish — xato, URL o‘zgarmaydi', async () => {
    const router = openAs('admin', '/?from=2026-09-03&to=2026-09-10')
    await screen.findByTestId('card-kirim')
    expect(reports.getDashboardSummary).toHaveBeenCalledWith({ from: '2026-09-03', to: '2026-09-10', objectId: null })
    expect(screen.getByRole('button', { name: t.reports.custom })).toHaveAttribute('aria-pressed', 'true')
    // DateField: 'Dan' ≤ 'Gacha' (min/max bog'langan) — noto'g'ri sana maydon ostida ko'rsatiladi
    fireEvent.change(screen.getByLabelText(t.reports.from), { target: { value: '15.09.2026' } })
    expect(await screen.findByText(t.ui.dateOutOfRange)).toBeInTheDocument()
    expect(screen.getByLabelText(t.reports.from)).toHaveAttribute('aria-invalid', 'true')
    // Davr 366 kundan uzun — xato guruh ostida (role=alert), URL o'zgarmaydi
    fireEvent.change(screen.getByLabelText(t.reports.from), { target: { value: '01.01.2025' } })
    fireEvent.click(screen.getByRole('button', { name: t.reports.apply }))
    expect(await screen.findByRole('alert')).toHaveTextContent(t.reports.rangeErrors.too_long)
    expect(router.state.location.search).toBe('?from=2026-09-03&to=2026-09-10')
    fireEvent.change(screen.getByLabelText(t.reports.from), { target: { value: '01.09.2026' } })
    fireEvent.click(screen.getByRole('button', { name: t.reports.apply }))
    await waitFor(() => expect(router.state.location.search).toBe('?from=2026-09-01&to=2026-09-10'))
  })

  it('URL dagi obyekt ro‘yxatda yo‘q — "Hammasi" bilan so‘raladi', async () => {
    openAs('admin', '/?object=11111111-2222-4333-8444-555555555555')
    await screen.findByTestId('card-kirim')
    expect(reports.getDashboardSummary).toHaveBeenCalledTimes(1)
    expect(reports.getDashboardSummary).toHaveBeenCalledWith({ from: '2026-10-19', to: '2026-10-25', objectId: null })
  })

  it('diagramma yiqilsa — faqat uning kartochkasida xabar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    reports.getSpendBreakdown.mockResolvedValueOnce([{ key: 'm1', label: 'BOOM', purchases_sum: '10', purchases_count: 1, expenses_sum: '0', expenses_count: 0, total_sum: '10' }])
    openAs('direktor')
    const spend = await screen.findByRole('region', { name: t.reports.charts.spend })
    expect(await within(spend).findByText(t.appError.chart)).toBeInTheDocument()
    expect(screen.getByTestId('card-kirim')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: t.reports.charts.daily })).queryByText(t.appError.chart)).not.toBeInTheDocument()
  })

  it('xarajat guruhi tugmalari — RPC guruh bilan', async () => {
    openAs('direktor')
    await screen.findByTestId('card-kirim')
    fireEvent.click(screen.getByRole('button', { name: t.reports.charts.spendGroups.supplier }))
    await waitFor(() => expect(reports.getSpendBreakdown).toHaveBeenLastCalledWith(expect.anything(), 'supplier'))
  })

  it('omborchi — faqat kirim/chiqim; ogohlantirishlar va podotchet yo‘q', async () => {
    openAs('omborchi')
    await screen.findByTestId('card-kirim')
    expect(screen.queryByTestId('card-purchases')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: t.reports.recentAlerts })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: t.reports.charts.cash })).not.toBeInTheDocument()
  })

  it('tekshiruvchi — kartochkalarsiz izoh, RPC chaqirilmaydi', async () => {
    openAs('tekshiruvchi')
    expect(await screen.findByText(t.reports.inspectorNote)).toBeInTheDocument()
    expect(reports.getDashboardSummary).not.toHaveBeenCalled()
  })

  it('Excel — xulosa va kunlik varaqlar, fayl nomi', async () => {
    openAs('admin')
    await screen.findByTestId('card-kirim')
    fireEvent.click(screen.getByRole('button', { name: t.excel.button }))
    await waitFor(() => expect(excel.exportWorkbook).toHaveBeenCalled())
    const arg = vi.mocked(excel.exportWorkbook).mock.calls[0]?.[0]
    expect(arg?.fileName).toBe('terron-bosh-sahifa-25.10.2026.xlsx')
    expect(arg?.sheets.map((s) => s.sheetName)).toEqual([t.excel.sheets.summary, t.excel.sheets.daily])
    expect(arg?.sheets[0]?.rows).toContainEqual({ indicator: t.reports.cards.kirim, value: '12' })
    expect(arg?.sheets[1]?.rows).toHaveLength(7)
  })
})
