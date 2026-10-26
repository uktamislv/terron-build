// Batch 12 — Mini App bosh ekrani: "Tugayotganlar" (K) → so'rov formasi to'ldiriladi;
// Telegram "Ochish" havolasi `?alert=<id>` (J); so'rov ekranida materiallar tartibi (L).
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import * as alertsRepo from '@/data/alertsRepo'
import * as authRepo from '@/data/authRepo'
import * as forecastRepo from '@/data/forecastRepo'
import * as materialsRepo from '@/data/materialsRepo'
import * as objectsRepo from '@/data/objectsRepo'
import * as requestsRepo from '@/data/requestsRepo'
import type { Alert, MaterialRequest } from '@/data/types'
import * as usageRepo from '@/data/usageRepo'
import { t } from '@/i18n'
import { routes } from '@/routes'
import { makeMaterial, makeObject, makeProfile } from '@/test/fixtures'
import { alertIdFrom, alertLinkMode } from './alertLink'

vi.mock('@/data/systemRepo', () => ({
  isConfigured: () => true,
  getSystemStatus: () => ({ supabaseConfigured: true }),
}))
vi.mock('@/data/authRepo', () => ({
  getSession: vi.fn(async () => ({ userId: 'u1', email: null, mustChangePassword: false })),
  onAuthChange: vi.fn(() => () => undefined),
  getMyProfile: vi.fn(),
  signOut: vi.fn(async () => undefined),
  signInWithPassword: vi.fn(),
  telegramSignIn: vi.fn(async () => 'ok'),
  clearLocalSession: vi.fn(async () => undefined),
}))
vi.mock('@/tg/telegram', () => ({
  isInsideTelegram: () => true,
  getWebApp: () => null,
  getInitData: () => 'init',
  requestContact: vi.fn(),
  botLink: () => 'https://t.me/x',
  initTelegram: vi.fn(),
  stripLaunchParamsFromUrl: vi.fn(),
  haptic: { tap: vi.fn(), success: vi.fn(), error: vi.fn(), select: vi.fn() },
}))
vi.mock('@/data/objectsRepo', () => ({ listObjects: vi.fn() }))
vi.mock('@/data/materialsRepo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/materialsRepo')>()),
  listMaterials: vi.fn(),
}))
vi.mock('@/data/movementsRepo', () => ({ listMyMovements: vi.fn(async () => []) }))
vi.mock('@/data/forecastRepo', () => ({ getStockForecast: vi.fn() }))
vi.mock('@/data/companiesRepo', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/data/companiesRepo')>()
  return { ...real, getCompanySettings: vi.fn(async () => real.DEFAULT_COMPANY_SETTINGS) }
})
vi.mock('@/data/normsRepo', () => ({ listNormUsage: vi.fn(async () => []) }))
vi.mock('@/data/requestsRepo', () => ({ createRequest: vi.fn(), listMyRequests: vi.fn(async () => []) }))
vi.mock('@/data/transfersRepo', () => ({ listTransferTargets: vi.fn(async () => []), listMyTransfers: vi.fn(async () => []) }))
vi.mock('@/data/usageRepo', () => ({ getMyMaterialUsage: vi.fn(async () => []) }))
vi.mock('@/data/alertsRepo', () => ({
  getAlertById: vi.fn(),
  listRecentAlerts: vi.fn(async () => []),
  listSiteAlerts: vi.fn(async () => []),
}))
vi.mock('@/data/reportsRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/reportsRepo')>()),
  getDashboardSummary: vi.fn(async () => null),
  getNormOverview: vi.fn(async () => []),
}))

const ta = t.tg.auto
const tm = t.tg.movement
const tr = t.tg.request

const sement = makeMaterial('m-sem', 'Sement', 'kg')
const qum = makeMaterial('m-qum', 'Qum', 'm³')
const objA = makeObject('o-a', 'Obyekt A')
const ALERT_ID = '11111111-2222-4333-8444-555555555555'

function alertRow(): Alert {
  return {
    id: ALERT_ID,
    company_id: 'c',
    type: 'manfiy_qoldiq',
    status: 'yangi',
    severity: 'ogohlantirish',
    object_id: 'o-a',
    material_id: 'm-sem',
    purchase_id: null,
    movement_id: null,
    details: { stock_after: '-20', qty_base: '50', unit: 'kg' },
    closed_by: null,
    closed_at: null,
    close_note: null,
    created_at: '2026-10-25T05:00:00Z',
    deleted_at: null,
    object_name: 'Obyekt A',
    material_name: 'Sement',
    base_unit: 'kg',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile('prorab'))
  vi.mocked(objectsRepo.listObjects).mockResolvedValue([objA])
  vi.mocked(materialsRepo.listMaterials).mockResolvedValue([sement, qum])
  vi.mocked(forecastRepo.getStockForecast).mockResolvedValue([
    {
      objectId: 'o-a',
      materialId: 'm-sem',
      stockQtyBase: '20',
      avgDailyOut: '10',
      daysLeft: '2',
      otherStockQtyBase: '100',
      estimateRemainingQtyBase: '50',
    },
    {
      objectId: 'o-a',
      materialId: 'm-qum',
      stockQtyBase: '80',
      avgDailyOut: '1',
      daysLeft: '80',
      otherStockQtyBase: '0',
      estimateRemainingQtyBase: null,
    },
  ])
  vi.mocked(requestsRepo.createRequest).mockResolvedValue({ qty_input: '50', unit_input: 'kg', unit_variant: null, material_name: 'Sement' } as MaterialRequest)
})

function open(path = '/tg') {
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />)
}

describe('Batch 12 (K) — Tugayotganlar', () => {
  it('faqat days_left ≤ 3 ko‘rsatiladi; "So‘rov yuborish" — 7 kunlik sarf, smeta qoldig‘i bilan cheklangan', async () => {
    open()
    const items = await screen.findAllByTestId('running-low')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('Sement')
    expect(items[0]).toHaveTextContent(ta.daysLeft('2'))
    expect(items[0]).toHaveTextContent(ta.otherStock('100', 'kg'))
    fireEvent.click(within(items[0] as HTMLElement).getByRole('button', { name: new RegExp(ta.sendRequest) }))
    // So'rov formasi: material, asosiy birlik va 50 kg (min(10×7, 50)) to'ldirilgan
    expect(await screen.findByText(ta.prefilled)).toBeInTheDocument()
    expect(screen.getByLabelText(tm.qty)).toHaveValue('50')
    fireEvent.click(screen.getByRole('button', { name: tr.save }))
    await waitFor(() => expect(requestsRepo.createRequest).toHaveBeenCalled())
    expect(vi.mocked(requestsRepo.createRequest).mock.calls[0]?.[0]).toMatchObject({
      objectId: 'o-a',
      materialId: 'm-sem',
      unitId: 'm-sem-base',
      qtyInput: '50',
    })
  })

  it('"O‘tkazma so‘rash" — izohda boshqa obyektdagi qoldiq', async () => {
    open()
    const item = (await screen.findAllByTestId('running-low'))[0] as HTMLElement
    fireEvent.click(within(item).getByRole('button', { name: ta.askTransfer }))
    await screen.findByText(ta.prefilled)
    fireEvent.click(screen.getByRole('button', { name: tr.save }))
    await waitFor(() => expect(requestsRepo.createRequest).toHaveBeenCalled())
    expect(vi.mocked(requestsRepo.createRequest).mock.calls[0]?.[0].note).toBe(ta.transferNote('100', 'kg'))
  })

  it('omborchi ko‘radi, lekin tugmalar yo‘q', async () => {
    vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile('omborchi'))
    open()
    const item = (await screen.findAllByTestId('running-low'))[0] as HTMLElement
    expect(within(item).queryByRole('button')).not.toBeInTheDocument()
  })

  it('direktor bosh ekranida ham ko‘rinadi', async () => {
    vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile('direktor'))
    open()
    expect(await screen.findAllByTestId('running-low')).toHaveLength(1)
  })
})

describe('Batch 12 (J) — ?alert=<id>', () => {
  it('direktor — ogohlantirish tafsiloti bosh ekran tepasida; yopiladi', async () => {
    vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile('direktor'))
    vi.mocked(alertsRepo.getAlertById).mockResolvedValue(alertRow())
    open(`/tg?alert=${ALERT_ID}`)
    const panel = await screen.findByTestId('alert-deeplink')
    expect(await within(panel).findByText(t.alertTexts.types.manfiy_qoldiq)).toBeInTheDocument()
    expect(alertsRepo.getAlertById).toHaveBeenCalledWith(ALERT_ID)
    expect(panel).toHaveTextContent('Qoldiq manfiy')
    fireEvent.click(within(panel).getByRole('button', { name: ta.alertClose }))
    expect(screen.queryByTestId('alert-deeplink')).not.toBeInTheDocument()
  })

  it('ko‘rinmasa — "topilmadi" izohi', async () => {
    vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile('admin'))
    vi.mocked(alertsRepo.getAlertById).mockResolvedValue(null)
    open(`/tg?alert=${ALERT_ID}`)
    expect(await screen.findByText(ta.alertNotFound)).toBeInTheDocument()
  })

  it('prorab — obyekt alerti (RLS ko‘rsatsa) ochiladi', async () => {
    vi.mocked(alertsRepo.getAlertById).mockResolvedValue(alertRow())
    open(`/tg?alert=${ALERT_ID}`)
    const panel = await screen.findByTestId('alert-deeplink')
    expect(await within(panel).findByText(t.alertTexts.types.manfiy_qoldiq)).toBeInTheDocument()
    expect(alertsRepo.getAlertById).toHaveBeenCalledWith(ALERT_ID)
  })

  it('prorab — RLS hech narsa bermasa jimgina oddiy bosh ekran ("topilmadi" yo‘q)', async () => {
    vi.mocked(alertsRepo.getAlertById).mockResolvedValue(null)
    open(`/tg?alert=${ALERT_ID}`)
    await screen.findAllByTestId('running-low')
    await waitFor(() => expect(alertsRepo.getAlertById).toHaveBeenCalledWith(ALERT_ID))
    await waitFor(() => expect(screen.queryByTestId('alert-deeplink')).not.toBeInTheDocument())
    expect(screen.queryByText(ta.alertNotFound)).not.toBeInTheDocument()
  })

  it('omborchi — xato bo‘lsa ham jimgina; noto‘g‘ri id — so‘rov yo‘q', async () => {
    vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile('omborchi'))
    vi.mocked(alertsRepo.getAlertById).mockRejectedValue(new Error('rls'))
    open(`/tg?alert=${ALERT_ID}`)
    await screen.findAllByTestId('running-low')
    await waitFor(() => expect(screen.queryByTestId('alert-deeplink')).not.toBeInTheDocument())
    vi.mocked(alertsRepo.getAlertById).mockClear()
    open('/tg?alert=not-a-uuid')
    await screen.findAllByTestId('running-low')
    expect(alertsRepo.getAlertById).not.toHaveBeenCalled()
  })

  it('haydovchi — havola ochilmaydi', () => {
    expect(alertLinkMode('haydovchi')).toBeNull()
    expect(alertLinkMode('prorab')).toBe('site')
    expect(alertLinkMode('direktor')).toBe('full')
  })

  it('alertIdFrom: query yoki start_param', () => {
    expect(alertIdFrom(new URLSearchParams(`alert=${ALERT_ID}`), null)).toBe(ALERT_ID)
    expect(alertIdFrom(new URLSearchParams(''), `alert_${ALERT_ID}`)).toBe(ALERT_ID)
    expect(alertIdFrom(new URLSearchParams('alert=1;drop'), 'alert_x')).toBeNull()
  })
})

describe('Batch 12 (L) — so‘rov ekranida materiallar tartibi', () => {
  it('ko‘p ishlatilgan material birinchi', async () => {
    vi.mocked(usageRepo.getMyMaterialUsage).mockResolvedValue([
      { materialId: 'm-qum', useCount: 5, lastUsedAt: new Date().toISOString() },
    ])
    open('/tg/request')
    const grid = await screen.findByRole('region', { name: tm.chooseMaterial })
    await waitFor(() => {
      const tiles = within(grid).getAllByRole('button').filter((b) => /Qum|Sement/.test(b.textContent ?? ''))
      expect(tiles[0]).toHaveTextContent('Qum')
    })
  })
})
