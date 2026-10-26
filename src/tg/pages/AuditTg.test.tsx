// Audit tuzatishlari — Telegram ilovasi ekranlari: "Yozuvlarim" (tuzatish, qabul holati, sanash, pul,
// xatolik xabarlari, o'tkazmani bekor qilish, ish xabarlari), "Qoldiq", so'rovlarni tasdiqlash,
// sana chiplari, "Qo'limda" tarixi, obyekt ogohlantirishlari.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import * as alertsRepo from '@/data/alertsRepo'
import * as authRepo from '@/data/authRepo'
import * as bugReportsRepo from '@/data/bugReportsRepo'
import * as cashRepo from '@/data/cashRepo'
import * as correctionsRepo from '@/data/correctionsRepo'
import * as forecastRepo from '@/data/forecastRepo'
import * as inventoryRepo from '@/data/inventoryRepo'
import * as materialsRepo from '@/data/materialsRepo'
import * as movementsRepo from '@/data/movementsRepo'
import * as objectsRepo from '@/data/objectsRepo'
import * as profilesRepo from '@/data/profilesRepo'
import * as purchasesRepo from '@/data/purchasesRepo'
import * as requestsRepo from '@/data/requestsRepo'
import * as stockRepo from '@/data/stockRepo'
import * as transfersRepo from '@/data/transfersRepo'
import type { Alert, CashAdvance, InventoryCount, MaterialRequest, Movement, Purchase, Transfer } from '@/data/types'
import { t } from '@/i18n'
import { routes } from '@/routes'
import { makeMaterial, makeObject, makeProfile, makeUnit } from '@/test/fixtures'

vi.mock('@/data/systemRepo', () => ({ isConfigured: () => true, getSystemStatus: () => ({ supabaseConfigured: true }) }))
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
  closeApp: vi.fn(),
  stripLaunchParamsFromUrl: vi.fn(),
  haptic: { tap: vi.fn(), success: vi.fn(), error: vi.fn(), select: vi.fn() },
}))
vi.mock('@/data/objectsRepo', () => ({ listObjects: vi.fn() }))
vi.mock('@/data/materialsRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/materialsRepo')>()),
  listMaterials: vi.fn(),
  getMaterial: vi.fn(),
}))
vi.mock('@/data/movementsRepo', () => ({ createMovement: vi.fn(), listMyMovements: vi.fn(async () => []), MOVEMENTS_PAGE_SIZE: 50 }))
vi.mock('@/data/purchasesRepo', () => ({ listMyPurchases: vi.fn(async () => []), createPurchase: vi.fn(), checkPurchasePrice: vi.fn(async () => 'ok') }))
vi.mock('@/data/requestsRepo', () => ({
  listMyRequests: vi.fn(async () => []),
  listRequests: vi.fn(async () => ({ rows: [], total: 0 })),
  listApprovedRequests: vi.fn(async () => []),
  approveRequest: vi.fn(async () => undefined),
  rejectRequest: vi.fn(async () => undefined),
  DECISION_NOTE_MAX: 500,
}))
vi.mock('@/data/transfersRepo', () => ({
  listMyTransfers: vi.fn(async () => []),
  listIncomingTransfers: vi.fn(async () => []),
  cancelTransfer: vi.fn(async () => undefined),
  CANCEL_REASON_MAX: 500,
}))
vi.mock('@/data/inventoryRepo', () => ({ listCounts: vi.fn(async () => ({ rows: [], total: 0 })) }))
vi.mock('@/data/cashRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/cashRepo')>()),
  listMyAdvances: vi.fn(async () => []),
  listCashHistory: vi.fn(async () => []),
  getMyBalance: vi.fn(),
}))
vi.mock('@/data/bugReportsRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/bugReportsRepo')>()),
  listMyBugReports: vi.fn(async () => []),
}))
vi.mock('@/data/correctionsRepo', async (orig) => ({ ...(await orig<typeof import('@/data/correctionsRepo')>()), correctEntry: vi.fn(async () => undefined) }))
vi.mock('@/data/profilesRepo', async (orig) => ({ ...(await orig<typeof import('@/data/profilesRepo')>()), setMyNotifyWorkflow: vi.fn(async () => undefined) }))
vi.mock('@/data/stockRepo', () => ({ getStock: vi.fn(async () => '0'), listStock: vi.fn(async () => []) }))
vi.mock('@/data/forecastRepo', () => ({ getStockForecast: vi.fn(async () => []) }))
vi.mock('@/data/alertsRepo', () => ({ getAlertById: vi.fn(async () => null), listRecentAlerts: vi.fn(async () => []), listSiteAlerts: vi.fn(async () => []) }))
vi.mock('@/data/usageRepo', () => ({ getMyMaterialUsage: vi.fn(async () => []) }))
vi.mock('@/data/openPurchasesRepo', () => ({ listOpenPurchases: vi.fn(async () => []) }))
vi.mock('@/data/suppliersRepo', async (orig) => ({ ...(await orig<typeof import('@/data/suppliersRepo')>()), listSuppliers: vi.fn(async () => []) }))
vi.mock('@/data/companiesRepo', async (orig) => {
  const actual = await orig<typeof import('@/data/companiesRepo')>()
  return { ...actual, getCompanySettings: vi.fn(async () => actual.DEFAULT_COMPANY_SETTINGS) }
})
vi.mock('@/data/reportsRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/reportsRepo')>()),
  getDashboardSummary: vi.fn(async () => null),
  getNormOverview: vi.fn(async () => []),
}))

const tm = t.tg.mine
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const sement = makeMaterial('m-s', 'Sement', 'kg', { units: [makeUnit('u-qop', 'm-s', 'qop', '50')] })
const objA = makeObject('o-a', 'Obyekt A')

function movement(over: Partial<Movement> = {}): Movement {
  return {
    id: 'mv1',
    company_id: 'c',
    type: 'kirim',
    object_id: 'o-a',
    material_id: 'm-s',
    unit_id: 'u-qop',
    qty_input: '3',
    unit_input: 'qop',
    unit_variant: null,
    qty_base: '150',
    purchase_id: null,
    photo_path: null,
    occurred_at: minutesAgo(5),
    note: null,
    created_by: makeProfile('prorab').id,
    created_at: minutesAgo(5),
    deleted_at: null,
    object_name: 'Obyekt A',
    material_name: 'Sement',
    base_unit: 'kg',
    created_by_name: null,
    ...over,
  }
}

function purchase(over: Partial<Purchase> = {}): Purchase {
  return {
    ...(movement() as unknown as Purchase),
    id: 'pu1',
    buyer_id: makeProfile('prorab').id,
    supplier_id: null,
    total_amount: '150000',
    unit_price: '50000',
    price_per_base: '1000',
    receipt_photo_path: null,
    purchased_at: minutesAgo(90),
    created_at: minutesAgo(90),
    buyer_name: null,
    supplier_name: null,
    receipt: { received_qty_base: '75', remaining_qty_base: '75', receipt_count: 1, last_received_at: null },
    alert_types: [],
    ...over,
  }
}

function open(path: string, role: Parameters<typeof makeProfile>[0] = 'prorab') {
  vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile(role))
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  vi.mocked(objectsRepo.listObjects).mockResolvedValue([objA])
  vi.mocked(materialsRepo.listMaterials).mockResolvedValue([sement])
  vi.mocked(materialsRepo.getMaterial).mockResolvedValue(sement)
  vi.mocked(cashRepo.getMyBalance).mockResolvedValue({ ...cashRepo.emptyBalance('c', 'p'), balance: '500000' })
  // clearAllMocks javoblarni tozalamaydi — har test toza ro'yxatlardan boshlanadi
  vi.mocked(movementsRepo.listMyMovements).mockResolvedValue([])
  vi.mocked(purchasesRepo.listMyPurchases).mockResolvedValue([])
  vi.mocked(transfersRepo.listMyTransfers).mockResolvedValue([])
  vi.mocked(inventoryRepo.listCounts).mockResolvedValue({ rows: [], total: 0 })
  vi.mocked(cashRepo.listMyAdvances).mockResolvedValue([])
  vi.mocked(cashRepo.listCashHistory).mockResolvedValue([])
  vi.mocked(bugReportsRepo.listMyBugReports).mockResolvedValue([])
  vi.mocked(requestsRepo.listRequests).mockResolvedValue({ rows: [], total: 0 })
  vi.mocked(alertsRepo.listSiteAlerts).mockResolvedValue([])
  vi.mocked(alertsRepo.getAlertById).mockResolvedValue(null)
  vi.mocked(stockRepo.listStock).mockResolvedValue([])
  vi.mocked(forecastRepo.getStockForecast).mockResolvedValue([])
})

describe('"Yozuvlarim" — tuzatish (correct_entry)', () => {
  it('30 daqiqa ichidagi o‘z kirimi — "Tuzatish", qolgan vaqt; sabab majburiy; RPC chaqiriladi', async () => {
    vi.mocked(movementsRepo.listMyMovements).mockResolvedValue([movement()])
    open('/tg/mine')
    const row = await screen.findByText('Sement')
    expect(screen.getByText(/qoldi$/)).toBeInTheDocument()
    fireEvent.click(row)
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(t.correction.action) }))
    const sheet = within(await screen.findByRole('dialog', { name: t.correction.title }))
    expect(sheet.getByTestId('correction-remaining')).toHaveTextContent(/2[45]:\d{2}/)
    fireEvent.change(sheet.getByLabelText(t.correction.qty), { target: { value: '5' } })
    fireEvent.click(sheet.getByRole('button', { name: t.correction.save }))
    expect(await sheet.findByText(t.correction.errNote)).toBeInTheDocument()
    expect(correctionsRepo.correctEntry).not.toHaveBeenCalled()
    fireEvent.change(sheet.getByLabelText(t.correction.note), { target: { value: '5 qop edi' } })
    fireEvent.click(sheet.getByRole('button', { name: t.correction.save }))
    await waitFor(() =>
      expect(correctionsRepo.correctEntry).toHaveBeenCalledWith({
        table: 'movements',
        id: 'mv1',
        qtyInput: '5',
        unitId: null,
        totalAmount: null,
        note: '5 qop edi',
      }),
    )
    expect(await screen.findByText(t.correction.saved)).toBeInTheDocument()
  })

  it('30 daqiqadan eski yoki xaridga bog‘langan — "Tuzatish" yo‘q', async () => {
    vi.mocked(movementsRepo.listMyMovements).mockResolvedValue([
      movement({ id: 'old', created_at: minutesAgo(45), material_name: 'Eski' }),
      movement({ id: 'linked', purchase_id: 'pu', material_name: 'Bog‘langan' }),
    ])
    open('/tg/mine')
    fireEvent.click(await screen.findByText('Eski'))
    await screen.findByRole('article')
    expect(screen.queryByRole('button', { name: new RegExp(t.correction.action) })).not.toBeInTheDocument()
  })

  it('xarid tuzatishda summa maydoni bor', async () => {
    vi.mocked(purchasesRepo.listMyPurchases).mockResolvedValue([
      purchase({ created_at: minutesAgo(3), receipt: { received_qty_base: '0', remaining_qty_base: '150', receipt_count: 0, last_received_at: null } }),
    ])
    open('/tg/mine')
    fireEvent.click(await screen.findByText('Sement'))
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(t.correction.action) }))
    const sheet = within(await screen.findByRole('dialog', { name: t.correction.title }))
    expect(sheet.getByLabelText(t.correction.total)).toHaveValue('150 000')
  })
})

describe('"Yozuvlarim" — to‘liq ro‘yxat', () => {
  it('xarid qabul holati, sanash, pul, xatolik xabari', async () => {
    vi.mocked(purchasesRepo.listMyPurchases).mockResolvedValue([purchase()])
    vi.mocked(inventoryRepo.listCounts).mockResolvedValue({
      rows: [{ id: 'c1', object_name: 'Obyekt A', status: 'submitted', applied_at: minutesAgo(1), item_count: 4, created_at: minutesAgo(2) } as InventoryCount],
      total: 1,
    })
    vi.mocked(cashRepo.listMyAdvances).mockResolvedValue([
      { id: 'a1', kind: 'berildi', amount: '1000000', issued_at: minutesAgo(10), created_at: minutesAgo(10), recipient_name: 'Prorab', created_by_name: 'Buxgalter' } as CashAdvance,
    ])
    vi.mocked(bugReportsRepo.listMyBugReports).mockResolvedValue([
      { id: 'b1', message: 'Saqlash ishlamadi', status: 'hal_qilindi', created_at: minutesAgo(20) } as bugReportsRepo.BugReport,
    ])
    open('/tg/mine')
    expect(await screen.findByText(tm.receiptStatus.partial)).toBeInTheDocument()
    // Prorab inventarizatsiya o'tkazmaydi — sanashlar so'ralmaydi
    expect(inventoryRepo.listCounts).not.toHaveBeenCalled()
    expect(screen.getAllByText(tm.cashIssued).length).toBeGreaterThan(0)
    expect(screen.getByText('Saqlash ishlamadi')).toBeInTheDocument()
    expect(screen.getByText(t.bugReports.statuses.hal_qilindi)).toBeInTheDocument()
    expect(cashRepo.listMyAdvances).toHaveBeenCalledWith(makeProfile('prorab').id, 'recipient')
  })

  it('tekshiruvchi — sanashlar holati bilan', async () => {
    vi.mocked(inventoryRepo.listCounts).mockResolvedValue({
      rows: [
        { id: 'c1', object_name: 'Obyekt A', status: 'draft', applied_at: null, item_count: 2, created_at: minutesAgo(2) } as InventoryCount,
        { id: 'c2', object_name: 'Obyekt B', status: 'submitted', applied_at: minutesAgo(1), item_count: 4, created_at: minutesAgo(3) } as InventoryCount,
      ],
      total: 2,
    })
    open('/tg/mine', 'tekshiruvchi')
    expect(await screen.findByText(t.inventory.statuses.draft)).toBeInTheDocument()
    expect(screen.getByText(tm.countApplied)).toBeInTheDocument()
    expect(inventoryRepo.listCounts).toHaveBeenCalledWith({ createdBy: makeProfile('tekshiruvchi').id })
    fireEvent.click(screen.getAllByText('Obyekt A')[0] as HTMLElement)
    expect(await screen.findByRole('link', { name: tm.countContinue })).toHaveAttribute('href', '/tg/inventory')
  })

  it('buxgalter — o‘zi bergan pul', async () => {
    vi.mocked(cashRepo.listMyAdvances).mockResolvedValue([
      { id: 'a1', kind: 'qaytarildi', amount: '20000', issued_at: minutesAgo(10), created_at: minutesAgo(10), recipient_name: 'Ali' } as CashAdvance,
    ])
    open('/tg/mine', 'buxgalter')
    expect(await screen.findByText(tm.cashFrom('Ali'))).toBeInTheDocument()
    expect(cashRepo.listMyAdvances).toHaveBeenCalledWith(makeProfile('buxgalter').id, 'creator')
  })

  it('o‘z o‘tkazmasi "Yuborildi" — bekor qilish sabab bilan', async () => {
    const tr = {
      id: 't1',
      status: 'yuborildi',
      created_by: makeProfile('prorab').id,
      created_at: minutesAgo(5),
      material_name: 'Sement',
      qty_input: '2',
      unit_input: 'qop',
      unit_variant: null,
      qty_base: '100',
      base_unit: 'kg',
      from_object_name: 'Obyekt A',
      to_object_name: 'Obyekt B',
      received_qty_base: null,
      cancel_reason: null,
      note: null,
    } as Transfer
    vi.mocked(transfersRepo.listMyTransfers).mockResolvedValue([tr])
    open('/tg/mine')
    fireEvent.click(await screen.findByText('Sement'))
    fireEvent.click(await screen.findByRole('button', { name: tm.cancelTransfer }))
    const sheet = within(await screen.findByRole('dialog', { name: tm.cancelTitle }))
    fireEvent.click(sheet.getByRole('button', { name: tm.cancelTransfer }))
    expect(await sheet.findByText(t.ombor.transfers.cancelReasonRequired)).toBeInTheDocument()
    fireEvent.change(sheet.getByLabelText(t.ombor.transfers.cancelReason), { target: { value: 'Noto‘g‘ri obyekt' } })
    fireEvent.click(sheet.getByRole('button', { name: tm.cancelTransfer }))
    await waitFor(() => expect(transfersRepo.cancelTransfer).toHaveBeenCalledWith('t1', 'Noto‘g‘ri obyekt'))
    expect(await screen.findByText(tm.cancelled)).toBeInTheDocument()
  })

  it('asosiy ro‘yxat yuklanmasa — RetryNotice; qisman xato — yashirilmaydi', async () => {
    vi.mocked(movementsRepo.listMyMovements).mockRejectedValueOnce(new Error('network'))
    open('/tg/mine')
    expect(await screen.findByRole('button', { name: t.common.retry })).toBeInTheDocument()
  })

  it('qisman xato (xatolik xabarlari) — izoh bilan', async () => {
    vi.mocked(bugReportsRepo.listMyBugReports).mockRejectedValueOnce(new Error('x'))
    open('/tg/mine')
    expect(await screen.findByText(tm.partialError)).toBeInTheDocument()
  })

  it('"Ish xabarlari" — o‘chirish notify_workflow ni yozadi', async () => {
    open('/tg/mine')
    const toggle = await screen.findByRole('switch', { name: t.settings.notify.toggle })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(toggle)
    await waitFor(() => expect(profilesRepo.setMyNotifyWorkflow).toHaveBeenCalledWith(makeProfile('prorab').id, false))
    expect(await screen.findByText(t.settings.notify.saved(false))).toBeInTheDocument()
  })
})

describe('"Qoldiq" (bosh ekrandan)', () => {
  it('prorab: bosh ekranda havola; qoldiq va tugayotganlar, qidiruv', async () => {
    vi.mocked(stockRepo.listStock).mockResolvedValue([
      { company_id: 'c', object_id: 'o-a', material_id: 'm-s', qty_base: '40', last_movement_at: null },
      { company_id: 'c', object_id: 'o-a', material_id: 'm-q', qty_base: '3', last_movement_at: null },
    ])
    vi.mocked(materialsRepo.listMaterials).mockResolvedValue([sement, makeMaterial('m-q', 'Qum', 'm3')])
    vi.mocked(forecastRepo.getStockForecast).mockResolvedValue([
      { objectId: 'o-a', materialId: 'm-s', stockQtyBase: '40', avgDailyOut: '20', daysLeft: '2', otherStockQtyBase: '0', estimateRemainingQtyBase: null },
    ])
    open('/tg')
    fireEvent.click(await screen.findByRole('link', { name: new RegExp(t.tg.stock.title) }))
    const items = await screen.findAllByTestId('stock-item')
    expect(items[0]).toHaveTextContent('Sement')
    expect(items[0]).toHaveAttribute('data-kind', 'warn')
    expect(screen.getByText(t.tg.stock.lowCount(1))).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(t.tg.movement.search), { target: { value: 'qum' } })
    await waitFor(() => expect(screen.getAllByTestId('stock-item')).toHaveLength(1))
    expect(stockRepo.listStock).toHaveBeenCalledWith({ objectId: 'o-a' })
  })

  it('tekshiruvchi — "Ruxsat yo‘q" (ko‘r-ko‘rona sanash)', async () => {
    open('/tg/stock', 'tekshiruvchi')
    expect(await screen.findByText(t.forbidden.title)).toBeInTheDocument()
  })
})

describe('admin: so‘rovlarni tasdiqlash (Telegram ilovasi)', () => {
  const req = {
    id: 'r1',
    status: 'kutilmoqda',
    material_name: 'Sement',
    object_name: 'Obyekt A',
    created_by_name: 'Prorab Ali',
    qty_input: '10',
    unit_input: 'qop',
    unit_variant: null,
    qty_base: '500',
    base_unit: 'kg',
    created_at: minutesAgo(30),
    needed_by: null,
    note: null,
  } as MaterialRequest

  it('rad etishda izoh majburiy; tasdiqlash — ixtiyoriy izoh bilan', async () => {
    vi.mocked(requestsRepo.listRequests).mockResolvedValue({ rows: [req], total: 1 })
    open('/tg/approvals', 'admin')
    const row = await screen.findByTestId('approval-row')
    fireEvent.click(within(row).getByRole('button'))
    const sheet = within(await screen.findByRole('dialog', { name: t.tg.approvals.decideTitle }))
    fireEvent.click(sheet.getByRole('button', { name: t.requestsPage.reject }))
    expect(await sheet.findByText(t.requestsPage.rejectReasonRequired)).toBeInTheDocument()
    expect(requestsRepo.rejectRequest).not.toHaveBeenCalled()
    fireEvent.change(sheet.getByLabelText(t.tg.approvals.note), { target: { value: 'ertaga' } })
    fireEvent.click(sheet.getByRole('button', { name: t.requestsPage.approve }))
    await waitFor(() => expect(requestsRepo.approveRequest).toHaveBeenCalledWith('r1', 'ertaga'))
    expect(await screen.findByText(t.tg.approvals.approved('Sement'))).toBeInTheDocument()
    expect(requestsRepo.listRequests).toHaveBeenCalledWith({ statuses: ['kutilmoqda'] })
  })

  it('admin bosh ekrani: Qoldiq, Tasdiqlash va Sanash havolalari; pastki menyu 5 band', async () => {
    open('/tg', 'admin')
    expect(await screen.findByRole('link', { name: new RegExp(t.tg.approvals.title) })).toHaveAttribute('href', '/tg/approvals')
    expect(screen.getByRole('link', { name: new RegExp(t.tg.nav.inventory) })).toHaveAttribute('href', '/tg/inventory')
    const nav = screen.getByRole('navigation', { name: t.app.name })
    expect(within(nav).getAllByRole('link')).toHaveLength(5)
    expect(within(nav).getByRole('link', { name: new RegExp(t.tg.nav.request) })).toBeInTheDocument()
  })

  it('prorab /tg/approvals — "Ruxsat yo‘q"', async () => {
    open('/tg/approvals')
    expect(await screen.findByText(t.forbidden.title)).toBeInTheDocument()
  })
})

describe('obyekt ogohlantirishlari (prorab, omborchi)', () => {
  it('bosh ekranda ochiq obyekt alertlari; bosilsa — tafsilot kartochkasi', async () => {
    const alert = {
      id: '0b3c1f9e-5d6a-4c8b-9e7f-1a2b3c4d5e6f',
      company_id: 'c',
      type: 'normadan_oshish',
      status: 'yangi',
      severity: 'ogohlantirish',
      object_id: 'o-a',
      material_id: 'm-s',
      purchase_id: null,
      movement_id: null,
      details: { consumed_qty_base: 1200, allowed_qty_base: 1000, over_pct: 20, base_unit: 'kg' },
      closed_by: null,
      closed_at: null,
      close_note: null,
      created_at: minutesAgo(60),
      deleted_at: null,
      object_name: 'Obyekt A',
      material_name: 'Sement',
      base_unit: 'kg',
    } as Alert
    vi.mocked(alertsRepo.listSiteAlerts).mockResolvedValue([alert])
    vi.mocked(alertsRepo.getAlertById).mockResolvedValue(alert)
    open('/tg', 'omborchi')
    const block = await screen.findByTestId('site-alerts')
    expect(within(block).getByText(t.alertTexts.types.normadan_oshish)).toBeInTheDocument()
    fireEvent.click(within(block).getByText(t.alertTexts.types.normadan_oshish))
    expect(await screen.findByTestId('alert-deeplink')).toBeInTheDocument()
    expect(alertsRepo.getAlertById).toHaveBeenCalledWith(alert.id)
  })
})

describe('sana chiplari va "Qo‘limda" tarixi', () => {
  it('kirim: standart "Bugun" — occurredAt yuborilmaydi; "Kecha" — kechagi sana', async () => {
    vi.mocked(movementsRepo.createMovement).mockResolvedValue(movement())
    open('/tg/movement')
    const grid = await screen.findByRole('region', { name: t.tg.movement.chooseMaterial })
    fireEvent.click(within(grid).getByRole('button', { name: /Sement/ }))
    fireEvent.change(screen.getByLabelText(t.tg.movement.qty), { target: { value: '2' } })
    expect(screen.getByRole('button', { name: t.tg.date.today })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: t.tg.date.yesterday }))
    fireEvent.click(screen.getByRole('button', { name: t.tg.movement.save }))
    await waitFor(() => expect(movementsRepo.createMovement).toHaveBeenCalled())
    const arg = vi.mocked(movementsRepo.createMovement).mock.calls[0]?.[0]
    const ms = Date.parse(arg?.occurredAt ?? '')
    expect(Date.now() - ms).toBeGreaterThan(23 * 3600_000)
    expect(Date.now() - ms).toBeLessThan(25 * 3600_000)
  })

  it('"Boshqa sana" tanlanmasa — xato, saqlanmaydi', async () => {
    open('/tg/movement')
    const grid = await screen.findByRole('region', { name: t.tg.movement.chooseMaterial })
    fireEvent.click(within(grid).getByRole('button', { name: /Sement/ }))
    fireEvent.change(screen.getByLabelText(t.tg.movement.qty), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: t.tg.date.other }))
    expect(screen.getByLabelText(t.tg.date.pick)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t.tg.movement.save }))
    expect(await screen.findByText(t.tg.date.errRequired)).toBeInTheDocument()
    expect(movementsRepo.createMovement).not.toHaveBeenCalled()
  })

  it('xarid: "Qo‘limda" kartasi — pul tarixi (berilgan, sarflangan)', async () => {
    vi.mocked(cashRepo.listCashHistory).mockResolvedValue([
      { kind: 'issued', id: 'a1', profileId: 'p', profileName: 'Ali', amount: '1000000', at: minutesAgo(60), note: null, createdByName: 'Buxgalter', deletedAt: null },
      { kind: 'spent', id: 's1', profileId: 'p', profileName: 'Ali', amount: '250000', at: minutesAgo(30), note: null, materialName: 'Sement', objectName: 'Obyekt A', deletedAt: null },
    ])
    open('/tg/purchase', 'haydovchi')
    fireEvent.click(await screen.findByRole('button', { name: t.tg.cashHistory.open }))
    const history = await screen.findByTestId('cash-history')
    expect(within(history).getByText('Sement')).toBeInTheDocument()
    expect(within(history).getByText(t.tg.cashHistory.by('Buxgalter'))).toBeInTheDocument()
    expect(cashRepo.listCashHistory).toHaveBeenCalledWith({ profileId: makeProfile('haydovchi').id })
  })
})
