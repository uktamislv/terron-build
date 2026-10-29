// Audit 3 (veb panel): firmalar (super_admin), faol firma tanlagichi, firma nomi, ta'minotchi podotcheti,
// podotchet tarixi (xarajat yorlig'i, davr, chegara), xaridni bekor qilish, tab filtrlari, tiklash xatosi.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import * as adminUsersRepo from '@/data/adminUsersRepo'
import * as alertsRepo from '@/data/alertsRepo'
import * as authRepo from '@/data/authRepo'
import * as cashRepo from '@/data/cashRepo'
import * as companiesRepo from '@/data/companiesRepo'
import { getCompanyScope, setCompanyScope } from '@/data/companyScope'
import * as correctionsRepo from '@/data/correctionsRepo'
import * as materialsRepo from '@/data/materialsRepo'
import * as profilesRepo from '@/data/profilesRepo'
import * as purchasesRepo from '@/data/purchasesRepo'
import { toRepoError } from '@/data/errors'
import type { CashHistoryEntry } from '@/data/cashRepo'
import type { Alert, Purchase } from '@/data/types'
import type { Role } from '@/domain/roles'
import { t } from '@/i18n'
import { routes } from '@/routes'
import { COMPANY_ID, makeMaterial, makeObject, makeProfile } from '@/test/fixtures'

const OTHER_ID = '00000000-0000-0000-0000-00000000c002'

vi.mock('@/data/systemRepo', () => ({ isConfigured: () => true, getSystemStatus: () => ({ supabaseConfigured: true }) }))
vi.mock('@/data/authRepo', () => ({
  getSession: vi.fn(async () => ({ userId: 'u-admin', email: 'admin@firma.uz', mustChangePassword: false })),
  onAuthChange: vi.fn(() => () => undefined),
  getMyProfile: vi.fn(),
  signOut: vi.fn(async () => undefined),
  signInWithPassword: vi.fn(),
  telegramSignIn: vi.fn(),
  clearLocalSession: vi.fn(async () => undefined),
  changePassword: vi.fn(),
  MIN_PASSWORD_LENGTH: 8,
}))
vi.mock('@/data/companiesRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/companiesRepo')>()),
  listCompanies: vi.fn(),
  createCompany: vi.fn(),
  renameCompany: vi.fn(async () => undefined),
  setCompanyActive: vi.fn(async () => undefined),
  getCompanyName: vi.fn(async () => 'Firma A'),
  getCompanySettings: vi.fn(async () => (await import('@/data/companiesRepo')).DEFAULT_COMPANY_SETTINGS),
}))
vi.mock('@/data/materialsRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/materialsRepo')>()),
  listMaterials: vi.fn(),
  createMaterial: vi.fn(),
}))
vi.mock('@/data/objectsRepo', () => ({ listObjects: vi.fn(async () => [makeObject('o-a', 'Obyekt A')]) }))
vi.mock('@/data/profilesRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/profilesRepo')>()),
  getProfile: vi.fn(),
  listProfiles: vi.fn(async () => []),
}))
vi.mock('@/data/objectMembersRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/objectMembersRepo')>()),
  listObjectMembers: vi.fn(async () => []),
}))
vi.mock('@/data/adminUsersRepo', async (orig) => ({ ...(await orig<typeof import('@/data/adminUsersRepo')>()), setLogin: vi.fn() }))
vi.mock('@/data/profileDirectory', async (orig) => ({
  ...(await orig<typeof import('@/data/profileDirectory')>()),
  listDirectory: vi.fn(async () => [makeProfile('haydovchi', { full_name: 'Ali haydovchi' })]),
  listActiveDirectory: vi.fn(async () => [makeProfile('haydovchi', { full_name: 'Ali haydovchi' })]),
}))
vi.mock('@/data/cashRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/cashRepo')>()),
  listBalances: vi.fn(async () => []),
  listCashHistory: vi.fn(async () => []),
  listAllCashHistory: vi.fn(async () => []),
}))
vi.mock('@/data/purchasesRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/purchasesRepo')>()),
  listPurchases: vi.fn(),
  softDeletePurchase: vi.fn(async () => undefined),
  restorePurchase: vi.fn(async () => undefined),
}))
vi.mock('@/data/expensesRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/expensesRepo')>()),
  listExpenses: vi.fn(async () => ({ rows: [], total: 0 })),
}))
vi.mock('@/data/expenseCategoriesRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/expenseCategoriesRepo')>()),
  listExpenseCategories: vi.fn(async () => []),
}))
vi.mock('@/data/correctionsRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/correctionsRepo')>()),
  cancelOwnEntry: vi.fn(async () => undefined),
}))
vi.mock('@/data/movementsRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/movementsRepo')>()),
  listMovements: vi.fn(async () => ({ rows: [], total: 0 })),
}))
vi.mock('@/data/alertsRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/alertsRepo')>()),
  listAlerts: vi.fn(async () => ({ rows: [], total: 0 })),
  markAlertSeen: vi.fn(async () => undefined),
}))
vi.mock('@/data/suppliersRepo', async (orig) => ({ ...(await orig<typeof import('@/data/suppliersRepo')>()), listSuppliers: vi.fn(async () => []) }))
vi.mock('@/data/photosRepo', () => ({ signedPhotoUrl: vi.fn(), uploadPhoto: vi.fn() }))

const tc = t.companies

const COMPANIES = [
  { id: COMPANY_ID, name: 'Firma A', is_active: true, created_at: '2026-10-01T00:00:00Z' },
  { id: OTHER_ID, name: 'Firma B', is_active: true, created_at: '2026-10-05T00:00:00Z' },
]

function open(role: Role, path: string, overrides: Parameters<typeof makeProfile>[1] = {}) {
  vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile(role, overrides))
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}

function purchase(overrides: Partial<Purchase> = {}): Purchase {
  return {
    id: '7d1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b',
    company_id: COMPANY_ID,
    buyer_id: 'p-taminotchi',
    object_id: 'o-a',
    material_id: 'm-sem',
    supplier_id: null,
    unit_id: 'u-qop',
    qty_input: '3',
    unit_input: 'qop',
    unit_variant: null,
    qty_base: '150',
    total_amount: '1250000',
    unit_price: '416666.67',
    price_per_base: '8333.3333',
    receipt_photo_path: null,
    purchased_at: new Date().toISOString(),
    note: null,
    created_by: 'p-taminotchi',
    created_at: new Date().toISOString(),
    deleted_at: null,
    object_name: 'Obyekt A',
    material_name: 'Sement',
    base_unit: 'kg',
    buyer_name: 'Test taminotchi',
    supplier_name: null,
    receipt: { received_qty_base: '0', remaining_qty_base: '150', receipt_count: 0, last_received_at: null },
    alert_types: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  setCompanyScope(null)
  vi.mocked(companiesRepo.listCompanies).mockResolvedValue(COMPANIES)
  // Ro'yxat faol firma filtri bo'yicha (repo'dagi scopeCompany o'rnida)
  vi.mocked(materialsRepo.listMaterials).mockImplementation(async () => {
    const scope = getCompanyScope()
    const a = makeMaterial('m-a', 'Material A', 'kg')
    const b = { ...makeMaterial('m-b', 'Material B', 'kg'), company_id: OTHER_ID }
    return scope === null ? [a, b] : [a, b].filter((m) => m.company_id === scope)
  })
  vi.mocked(purchasesRepo.listPurchases).mockResolvedValue({ rows: [], total: 0 })
})

afterAll(() => setCompanyScope(null))

describe('Faol firma (super_admin)', () => {
  it('ikki firma: faqat faol firmaning qatorlari; almashtirilsa ro‘yxat o‘zgaradi va tanlov saqlanadi; yangi material — faol firmaga', async () => {
    vi.mocked(materialsRepo.createMaterial).mockResolvedValue({ ...makeMaterial('m-new', 'Gips', 'kg'), company_id: OTHER_ID })
    open('super_admin', '/materials')
    expect(await screen.findByText('Material A')).toBeInTheDocument()
    expect(screen.queryByText('Material B')).not.toBeInTheDocument()

    const select = await screen.findByLabelText(tc.switcher)
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(2))
    fireEvent.change(select, { target: { value: OTHER_ID } })
    expect(await screen.findByText('Material B')).toBeInTheDocument()
    expect(screen.queryByText('Material A')).not.toBeInTheDocument()
    expect(getCompanyScope()).toBe(OTHER_ID)
    expect(Object.values({ ...window.localStorage })).toContain(OTHER_ID)

    fireEvent.click(screen.getByRole('button', { name: t.materials.add }))
    const dialog = within(await screen.findByRole('dialog'))
    fireEvent.change(dialog.getByLabelText(t.materials.name), { target: { value: 'Gips' } })
    fireEvent.click(dialog.getByRole('button', { name: 'kg' }))
    fireEvent.click(dialog.getByRole('button', { name: t.common.save }))
    await waitFor(() => expect(materialsRepo.createMaterial).toHaveBeenCalledWith(expect.objectContaining({ companyId: OTHER_ID, name: 'Gips' })))
  })

  it('saqlangan tanlov keyingi ochilishda qo‘llanadi; ro‘yxatda yo‘q firma — o‘z firmasi', async () => {
    window.localStorage.setItem('terron.activeCompany:p-super_admin', OTHER_ID)
    open('super_admin', '/materials')
    expect(await screen.findByText('Material B')).toBeInTheDocument()
    expect(screen.queryByText('Material A')).not.toBeInTheDocument()
  })

  it('admin: tanlagich yo‘q, filtr qo‘yilmaydi (RLS o‘zi bitta firma beradi)', async () => {
    open('admin', '/materials')
    expect(await screen.findByText('Material A')).toBeInTheDocument()
    expect(screen.queryByLabelText(tc.switcher)).not.toBeInTheDocument()
    expect(getCompanyScope()).toBeNull()
    expect(companiesRepo.listCompanies).not.toHaveBeenCalled()
  })
})

describe('/companies (super_admin)', () => {
  it('ro‘yxat; firma qo‘shish → create_company; administratorga veb login; firmaga o‘tish', async () => {
    vi.mocked(companiesRepo.createCompany).mockResolvedValue({ companyId: 'c-new', adminProfileId: 'p-new' })
    vi.mocked(profilesRepo.getProfile).mockResolvedValue(makeProfile('admin', { id: 'p-new', full_name: 'Yangi admin', company_id: 'c-new' }))
    const router = open('super_admin', '/companies')
    const rows = await screen.findAllByTestId('company-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent(tc.current)

    fireEvent.click(screen.getByRole('button', { name: tc.add }))
    const dialog = within(await screen.findByRole('dialog', { name: tc.addTitle }))
    fireEvent.click(dialog.getByRole('button', { name: t.common.save }))
    expect(dialog.getByText(tc.errName)).toBeInTheDocument()
    expect(dialog.getByText(tc.errAdminName)).toBeInTheDocument()
    expect(dialog.getByText(tc.errPhone)).toBeInTheDocument()
    expect(companiesRepo.createCompany).not.toHaveBeenCalled()
    fireEvent.change(dialog.getByLabelText(tc.name), { target: { value: 'Yangi qurilish' } })
    fireEvent.change(dialog.getByLabelText(tc.adminName), { target: { value: 'Yangi admin' } })
    fireEvent.change(dialog.getByLabelText(tc.adminPhone), { target: { value: '90 111 22 33' } })
    // Saqlangach ro'yxat (va yon menyudagi tanlagich) qayta yuklanadi — yangi firma unda bor
    vi.mocked(companiesRepo.listCompanies).mockResolvedValue([...COMPANIES, { id: 'c-new', name: 'Yangi qurilish', is_active: true, created_at: '2026-11-10T00:00:00Z' }])
    fireEvent.click(dialog.getByRole('button', { name: t.common.save }))
    await waitFor(() =>
      expect(companiesRepo.createCompany).toHaveBeenCalledWith({ name: 'Yangi qurilish', adminFullName: 'Yangi admin', adminPhone: '90 111 22 33' }),
    )
    const created = await screen.findByTestId('company-created')
    expect(created).toHaveTextContent(tc.created('Yangi qurilish'))

    fireEvent.click(within(created).getByRole('button', { name: tc.setAdminLogin }))
    expect(await screen.findByRole('dialog', { name: `${t.login.title} — Yangi admin` })).toBeInTheDocument()
    expect(profilesRepo.getProfile).toHaveBeenCalledWith('p-new')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(within(created).getByRole('button', { name: tc.openUsers }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/users'))
    expect(getCompanyScope()).toBe('c-new')
    expect(adminUsersRepo.setLogin).not.toHaveBeenCalled()
  })

  it('nomini o‘zgartirish va nofaol qilish', async () => {
    open('super_admin', '/companies')
    const rows = await screen.findAllByTestId('company-row')
    fireEvent.click(within(rows[1] as HTMLElement).getByRole('button', { name: tc.rename }))
    const dialog = within(await screen.findByRole('dialog', { name: tc.renameTitle }))
    fireEvent.change(dialog.getByLabelText(tc.name), { target: { value: 'Firma B2' } })
    fireEvent.click(dialog.getByRole('button', { name: t.common.save }))
    await waitFor(() => expect(companiesRepo.renameCompany).toHaveBeenCalledWith(OTHER_ID, 'Firma B2'))

    fireEvent.click(within((await screen.findAllByTestId('company-row'))[1] as HTMLElement).getByRole('button', { name: tc.deactivate }))
    const confirm = within(await screen.findByRole('dialog', { name: tc.deactivate }))
    fireEvent.click(confirm.getByRole('button', { name: t.common.yes }))
    await waitFor(() => expect(companiesRepo.setCompanyActive).toHaveBeenCalledWith(OTHER_ID, false))
  })

  it('admin: menyuda yo‘q va sahifa ochilmaydi', async () => {
    open('admin', '/companies')
    expect(await screen.findByText(t.forbidden.title)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: t.web.nav.companies })).not.toBeInTheDocument()
  })
})

describe('Sozlamalar → Firma nomi', () => {
  it('admin o‘z firmasi nomini o‘zgartiradi', async () => {
    open('admin', '/settings')
    const field = await screen.findByRole('textbox', { name: t.settings.companyName })
    expect(field).toHaveValue('Firma A')
    fireEvent.change(field, { target: { value: '  ' } })
    fireEvent.click(within(screen.getByRole('form', { name: t.settings.companyName })).getByRole('button', { name: t.common.save }))
    expect(await screen.findByText(t.settings.errCompanyName)).toBeInTheDocument()
    fireEvent.change(field, { target: { value: 'Firma A+' } })
    fireEvent.click(within(screen.getByRole('form', { name: t.settings.companyName })).getByRole('button', { name: t.common.save }))
    await waitFor(() => expect(companiesRepo.renameCompany).toHaveBeenCalledWith(COMPANY_ID, 'Firma A+'))
    expect(await screen.findByText(t.settings.companyNameSaved)).toBeInTheDocument()
  })
})

function spentExpense(overrides: Partial<Extract<CashHistoryEntry, { kind: 'spent' }>> = {}): CashHistoryEntry {
  return {
    kind: 'spent',
    source: 'expense',
    id: 'e1',
    profileId: 'p-haydovchi',
    profileName: 'Ali haydovchi',
    amount: '41000',
    at: '2026-11-02T05:00:00Z',
    note: null,
    materialName: 'Oziq-ovqat',
    objectName: null,
    deletedAt: null,
    ...overrides,
  }
}

describe('/cash', () => {
  it('ta’minotchi: menyuda bor, faqat o‘z tarixi (profileId = o‘zi), odam filtri yo‘q', async () => {
    open('taminotchi', '/cash')
    await waitFor(() => expect(cashRepo.listCashHistory).toHaveBeenCalled())
    expect(vi.mocked(cashRepo.listCashHistory).mock.calls[0]?.[0]).toMatchObject({ profileId: 'p-taminotchi' })
    expect(screen.getByRole('link', { name: t.web.nav.cash })).toBeInTheDocument()
    expect(screen.queryByLabelText(t.cash.filterPerson)).not.toBeInTheDocument()
    const rows = await screen.findAllByTestId('balance-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('Test taminotchi')
    expect(screen.queryByRole('button', { name: t.cash.issue })).not.toBeInTheDocument()
  })

  it('xarajatdan sarf: tafsilotda "Xarajat", xarajat turi va "Umumiy"', async () => {
    vi.mocked(cashRepo.listCashHistory).mockResolvedValue([spentExpense()])
    open('buxgalter', '/cash')
    fireEvent.click(within((await screen.findAllByTestId('cash-history-row'))[0] as HTMLElement).getByRole('button'))
    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByText(t.expenses.cashKind)).toBeInTheDocument()
    expect(dialog.getByText(t.cash.expenseCategory)).toBeInTheDocument()
    expect(dialog.getByText('Oziq-ovqat')).toBeInTheDocument()
    expect(dialog.getByText(t.expenses.general)).toBeInTheDocument()
    expect(dialog.queryByText(t.cash.kinds.spent)).not.toBeInTheDocument()
  })

  it('chegaraga yetsa — izoh va "Ko‘proq ko‘rsatish"; davr filtri so‘rovga tushadi', async () => {
    vi.mocked(cashRepo.listCashHistory).mockImplementation(async (opts = {}) =>
      Array.from({ length: opts.limit ?? cashRepo.CASH_HISTORY_LIMIT }, (_, i) => spentExpense({ id: `e${i}` })),
    )
    open('buxgalter', '/cash')
    expect(await screen.findByText(t.cash.limitHint(cashRepo.CASH_HISTORY_LIMIT))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t.cash.more }))
    await waitFor(() => expect(cashRepo.listCashHistory).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 2 * cashRepo.CASH_HISTORY_LIMIT })))

    const filters = within(screen.getByRole('form', { name: t.ombor.filters }))
    fireEvent.change(filters.getByLabelText(t.ombor.filterFrom), { target: { value: '2026-11-01' } })
    await waitFor(() =>
      expect(cashRepo.listCashHistory).toHaveBeenLastCalledWith(
        // Toshkent kuni boshi (UTC+5); davr o'zgarsa — yana birinchi 200 ta
        expect.objectContaining({ from: '2026-10-31T19:00:00.000Z', limit: cashRepo.CASH_HISTORY_LIMIT }),
      ),
    )
  })
})

describe('/purchases', () => {
  it('muallif (30 daqiqa): "Bekor qilish" — sabab bilan cancel_own_entry', async () => {
    vi.mocked(purchasesRepo.listPurchases).mockResolvedValue({ rows: [purchase()], total: 1 })
    open('taminotchi', '/purchases')
    const row = await screen.findByTestId('purchase-row')
    fireEvent.click(within(row).getByRole('button', { name: t.ui.actions }))
    fireEvent.click(await screen.findByRole('menuitem', { name: t.purchases.open }))
    fireEvent.click(await screen.findByRole('button', { name: t.correction.cancelAction }))
    const dialog = within(await screen.findByRole('dialog', { name: t.correction.cancelTitle }))
    fireEvent.change(dialog.getByLabelText(t.correction.cancelReason), { target: { value: 'ikki marta' } })
    fireEvent.click(dialog.getByRole('button', { name: t.correction.cancelConfirm }))
    await waitFor(() => expect(correctionsRepo.cancelOwnEntry).toHaveBeenCalledWith('purchases', purchase().id, 'ikki marta'))
    expect(await screen.findByText(t.correction.cancelled)).toBeInTheDocument()
  })

  it('tab almashganda davr va obyekt filtri URL da qoladi', async () => {
    const objectId = '1a2b3c4d-1111-4222-8333-444455556666'
    const router = open('admin', `/purchases?from=2026-11-01&to=2026-11-30&object=${objectId}`)
    fireEvent.click(await screen.findByRole('tab', { name: t.expenses.tabExpenses }))
    await waitFor(() => expect(router.state.location.search).toContain('tab=expenses'))
    const params = new URLSearchParams(router.state.location.search)
    expect(params.get('from')).toBe('2026-11-01')
    expect(params.get('to')).toBe('2026-11-30')
    expect(params.get('object')).toBe(objectId)
  })

  it('tiklash rad etilsa — xato tafsilot ichida ko‘rinadi', async () => {
    vi.mocked(purchasesRepo.listPurchases).mockResolvedValue({ rows: [purchase({ deleted_at: '2026-11-01T00:00:00Z' })], total: 1 })
    vi.mocked(purchasesRepo.restorePurchase).mockRejectedValue(toRepoError({ code: 'P0001', message: 'x', hint: 'restore_conflict' }))
    open('admin', '/purchases')
    const row = await screen.findByTestId('purchase-row')
    fireEvent.click(within(row).getByRole('button', { name: t.ui.actions }))
    fireEvent.click(await screen.findByRole('menuitem', { name: t.purchases.open }))
    const detail = await screen.findByRole('dialog', { name: t.purchases.detailTitle })
    fireEvent.click(within(detail).getByRole('button', { name: t.ombor.restore }))
    expect(await within(detail).findByText(t.errors.restore_conflict)).toBeInTheDocument()
  })
})

describe('Oxirgi sahifadagi yagona qator ketsa — oldingi sahifa (bo‘sh sahifa qolmaydi)', () => {
  it('xaridni o‘chirish', async () => {
    vi.mocked(purchasesRepo.listPurchases).mockImplementation(async (_f, page = 0) => ({
      rows: [purchase({ id: page === 1 ? 'p-last' : 'p-first', material_name: page === 1 ? 'Oxirgi' : 'Birinchi' })],
      total: 51,
    }))
    open('admin', '/purchases')
    await screen.findByText('Birinchi')
    fireEvent.click(screen.getByRole('button', { name: t.ombor.next }))
    const row = await screen.findByText('Oxirgi')
    fireEvent.click(within(row.closest('[data-testid="purchase-row"]') as HTMLElement).getByRole('button', { name: t.ui.actions }))
    fireEvent.click(await screen.findByRole('menuitem', { name: t.ombor.delete }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: t.ombor.delete })).getByRole('button', { name: t.common.yes }))
    await waitFor(() => expect(purchasesRepo.softDeletePurchase).toHaveBeenCalledWith('p-last'))
    await waitFor(() => expect(purchasesRepo.listPurchases).toHaveBeenLastCalledWith(expect.anything(), 0))
  })

  it('ogohlantirish "Ko‘rildi" — "Yangi" filtrida ro‘yxatdan chiqadi', async () => {
    const a = (id: string): Alert => ({
      id,
      company_id: COMPANY_ID,
      type: 'narx_ogishi',
      status: 'yangi',
      severity: 'ogohlantirish',
      object_id: null,
      material_id: null,
      purchase_id: null,
      movement_id: null,
      details: {},
      closed_by: null,
      closed_at: null,
      close_note: null,
      created_at: '2026-11-01T00:00:00Z',
      deleted_at: null,
      object_name: null,
      material_name: id,
      base_unit: null,
    })
    vi.mocked(alertsRepo.listAlerts).mockImplementation(async (_f, page = 0) => ({ rows: [a(page === 1 ? 'a-last' : 'a-first')], total: 51 }))
    open('admin', '/alerts?status=yangi')
    await waitFor(() => expect(alertsRepo.listAlerts).toHaveBeenCalled())
    fireEvent.click(await screen.findByRole('button', { name: t.ombor.next }))
    await waitFor(() => expect(alertsRepo.listAlerts).toHaveBeenLastCalledWith(expect.anything(), 1))
    fireEvent.click(await screen.findByRole('button', { name: t.alertsPage.markSeen }))
    await waitFor(() => expect(alertsRepo.markAlertSeen).toHaveBeenCalledWith('a-last'))
    await waitFor(() => expect(alertsRepo.listAlerts).toHaveBeenLastCalledWith(expect.anything(), 0))
  })

  it('amal natijasi filtr o‘zgarganda yo‘qoladi', async () => {
    vi.mocked(purchasesRepo.listPurchases).mockResolvedValue({ rows: [purchase()], total: 1 })
    open('taminotchi', '/purchases')
    const row = await screen.findByTestId('purchase-row')
    fireEvent.click(within(row).getByRole('button', { name: t.ui.actions }))
    fireEvent.click(await screen.findByRole('menuitem', { name: t.purchases.open }))
    fireEvent.click(await screen.findByRole('button', { name: t.correction.cancelAction }))
    const dialog = within(await screen.findByRole('dialog', { name: t.correction.cancelTitle }))
    fireEvent.change(dialog.getByLabelText(t.correction.cancelReason), { target: { value: 'xato' } })
    fireEvent.click(dialog.getByRole('button', { name: t.correction.cancelConfirm }))
    expect(await screen.findByText(t.correction.cancelled)).toBeInTheDocument()
    const filters = within(screen.getByRole('form', { name: t.ombor.filters }))
    fireEvent.change(filters.getByLabelText(t.ombor.filterFrom), { target: { value: '2026-11-01' } })
    await waitFor(() => expect(screen.queryByText(t.correction.cancelled)).not.toBeInTheDocument())
  })
})
