import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import * as authRepo from '@/data/authRepo'
import * as correctionsRepo from '@/data/correctionsRepo'
import * as expenseCategoriesRepo from '@/data/expenseCategoriesRepo'
import * as expensesRepo from '@/data/expensesRepo'
import * as reportsRepo from '@/data/reportsRepo'
import type { Expense, ExpenseCategory } from '@/data/types'
import type { Role } from '@/domain/roles'
import { t } from '@/i18n'
import { routes } from '@/routes'
import { COMPANY_ID, makeObject, makeProfile } from '@/test/fixtures'

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
vi.mock('@/data/objectsRepo', () => ({ listObjects: vi.fn(async () => [makeObject('o-a', 'Obyekt A')]) }))
vi.mock('@/data/materialsRepo', () => ({ listMaterials: vi.fn(async () => []) }))
vi.mock('@/data/profileDirectory', async (orig) => {
  const people = () => [makeProfile('haydovchi', { full_name: 'Ali haydovchi' }), makeProfile('taminotchi', { full_name: 'Vali taminotchi' })]
  return {
    ...(await orig<typeof import('@/data/profileDirectory')>()),
    listDirectory: vi.fn(async () => people()),
    listActiveDirectory: vi.fn(async () => people()),
  }
})
vi.mock('@/data/purchasesRepo', () => ({ listPurchases: vi.fn(async () => ({ rows: [], total: 0 })), PURCHASES_PAGE_SIZE: 50 }))
vi.mock('@/data/suppliersRepo', () => ({ listSuppliers: vi.fn(async () => []) }))
vi.mock('@/data/companiesRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/companiesRepo')>()),
  getCompanySettings: vi.fn(async () => ({ receiptMismatchPct: '2', priceDeviationPct: '8', priceAvgWindow: 5 })),
}))
vi.mock('@/data/expenseCategoriesRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/expenseCategoriesRepo')>()),
  listExpenseCategories: vi.fn(),
  createExpenseCategory: vi.fn(async () => ({})),
  updateExpenseCategory: vi.fn(async () => undefined),
}))
vi.mock('@/data/expensesRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/expensesRepo')>()),
  listExpenses: vi.fn(),
  listAllExpenses: vi.fn(async () => []),
  getExpenseById: vi.fn(),
  createExpense: vi.fn(),
  listMyExpenses: vi.fn(async () => []),
  getMyExpenseCategoryUsage: vi.fn(async () => []),
  softDeleteExpense: vi.fn(async () => undefined),
  restoreExpense: vi.fn(async () => undefined),
}))
vi.mock('@/data/correctionsRepo', async (orig) => ({
  ...(await orig<typeof import('@/data/correctionsRepo')>()),
  correctEntry: vi.fn(async () => undefined),
  cancelOwnEntry: vi.fn(async () => undefined),
}))
vi.mock('@/data/reportsRepo', async (orig) => ({ ...(await orig<typeof import('@/data/reportsRepo')>()), getSpendBreakdown: vi.fn() }))
vi.mock('@/data/photosRepo', () => ({ signedPhotoUrl: vi.fn(), uploadPhoto: vi.fn() }))

const te = t.expenses

function category(id: string, name: string, extra: Partial<ExpenseCategory> = {}): ExpenseCategory {
  return {
    id,
    company_id: COMPANY_ID,
    name,
    monthly_limit: null,
    photo_required: false,
    is_active: true,
    sort_order: 1,
    created_by: null,
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
    deleted_at: null,
    ...extra,
  }
}

const EXP_ID = '3f2b8c1e-1d2a-4b5c-9d8e-0f1a2b3c4d5e'
function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: EXP_ID,
    company_id: COMPANY_ID,
    category_id: 'k-food',
    object_id: null,
    amount: '41000',
    spent_at: '2026-11-02T05:00:00Z',
    payer_id: 'p-haydovchi',
    payment_source: 'podotchet',
    supplier_id: null,
    note: 'tushlik',
    receipt_photo_path: null,
    receipt_photo_sha256: null,
    receipt_fiscal_sign: null,
    receipt_terminal_id: null,
    receipt_no: null,
    receipt_verified: false,
    receipt_total: null,
    seller_tin: null,
    geo_status: 'ok',
    geo_lat: '41.3',
    geo_lng: '69.2',
    created_by: 'p-haydovchi',
    created_at: '2026-11-02T05:00:00Z',
    deleted_at: null,
    category_name: 'Oziq-ovqat',
    object_name: null,
    supplier_name: null,
    payer_name: 'Ali haydovchi',
    alert_types: ['takroriy_yozuv'],
    ...overrides,
  }
}

function open(role: Role, path: string) {
  vi.mocked(authRepo.getMyProfile).mockResolvedValue(makeProfile(role))
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(expenseCategoriesRepo.listExpenseCategories).mockResolvedValue([
    category('k-food', 'Oziq-ovqat', { monthly_limit: '100000' }),
    category('k-fuel', 'Yoqilg‘i', { sort_order: 2 }),
  ])
  vi.mocked(expensesRepo.listExpenses).mockResolvedValue({ rows: [expense()], total: 1 })
  vi.mocked(expensesRepo.getExpenseById).mockResolvedValue(expense())
  vi.mocked(reportsRepo.getSpendBreakdown).mockResolvedValue([
    { key: 'k-food', label: 'Oziq-ovqat', purchases_sum: '0', purchases_count: 0, expenses_sum: '120000', expenses_count: 3, total_sum: '120000' },
  ])
})

describe('/purchases → "Xarajatlar" tabi', () => {
  it('ro‘yxat: tur, "Umumiy", to‘lovchi, belgi; "Umumiy" filtri; tafsilot — chek, joylashuv, pul manbai', async () => {
    open('direktor', '/purchases?tab=expenses')
    const row = await screen.findByTestId('expense-row')
    expect(row).toHaveTextContent('Oziq-ovqat')
    expect(row).toHaveTextContent(te.general)
    expect(row).toHaveTextContent('Ali haydovchi')
    expect(row).toHaveTextContent(t.alertTexts.types.takroriy_yozuv)
    expect(screen.getByRole('tab', { name: te.tabExpenses })).toHaveAttribute('aria-selected', 'true')
    // Direktor — faqat ko'rish
    expect(screen.queryByRole('button', { name: te.add })).not.toBeInTheDocument()
    fireEvent.click(within(row).getByRole('button', { name: t.purchases.open }))
    const detail = await screen.findByTestId('expense-detail')
    expect(detail).toHaveTextContent(te.noReceipt)
    expect(detail).toHaveTextContent(t.purchases.paymentSources.podotchet)
    expect(detail).toHaveTextContent(t.purchases.geoStatus.ok)
  })

  it('havola ?expense=<id> — tafsilot ochiladi (javob kechiksa ham; parametr URL dan olib tashlanadi)', async () => {
    // Javob parametr olib tashlangandan keyin keladi — so'rov bekor bo'lib qolmasligi kerak
    vi.mocked(expensesRepo.getExpenseById).mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(expense()), 50)))
    open('admin', `/purchases?tab=expenses&expense=${EXP_ID}`)
    expect(await screen.findByTestId('expense-detail', {}, { timeout: 2000 })).toBeInTheDocument()
    expect(expensesRepo.getExpenseById).toHaveBeenCalledTimes(1)
    expect(expensesRepo.getExpenseById).toHaveBeenCalledWith(EXP_ID)
  })

  it('o‘chirish: oxirgi sahifadagi yagona qator — oldingi sahifaga qaytadi', async () => {
    vi.mocked(expensesRepo.listExpenses).mockImplementation(async (_f, page = 0) =>
      page === 1 ? { rows: [expense()], total: 51 } : { rows: [expense({ id: 'e-other', note: null })], total: 51 },
    )
    open('admin', '/purchases?tab=expenses')
    await screen.findByTestId('expense-row')
    fireEvent.click(screen.getByRole('button', { name: t.ombor.next }))
    await waitFor(() => expect(expensesRepo.listExpenses).toHaveBeenLastCalledWith(expect.anything(), 1))
    fireEvent.click(within(await screen.findByTestId('expense-row')).getByRole('button', { name: t.purchases.open }))
    fireEvent.click(await screen.findByRole('button', { name: t.ombor.delete }))
    const dialog = await screen.findByRole('dialog', { name: t.ombor.delete })
    fireEvent.click(within(dialog).getByRole('button', { name: t.common.yes }))
    await waitFor(() => expect(expensesRepo.softDeleteExpense).toHaveBeenCalledWith(EXP_ID))
    await waitFor(() => expect(expensesRepo.listExpenses).toHaveBeenLastCalledWith(expect.anything(), 0))
  })

  it('"Umumiy" obyekt filtri — NO_OBJECT; davr URL dan', async () => {
    open('admin', '/purchases?tab=expenses&object=none&from=2026-11-01&to=2026-11-30')
    await screen.findByTestId('expense-row')
    expect(vi.mocked(expensesRepo.listExpenses).mock.calls[0]?.[0]).toMatchObject({ objectId: 'none' })
  })

  it('admin: tuzatish — summa va izoh (obyektsiz), sabab majburiy', async () => {
    open('admin', '/purchases?tab=expenses')
    fireEvent.click(within(await screen.findByTestId('expense-row')).getByRole('button', { name: t.purchases.open }))
    fireEvent.click(await screen.findByRole('button', { name: t.correction.action }))
    const form = await screen.findByTestId('expense-correction')
    expect(within(form).queryByLabelText(te.object)).not.toBeInTheDocument()
    fireEvent.change(within(form).getByLabelText(te.amount), { target: { value: '45000' } })
    fireEvent.click(within(form).getByRole('button', { name: t.correction.save }))
    expect(await within(form).findByText(t.correction.errReason)).toBeInTheDocument()
    fireEvent.change(within(form).getByLabelText(t.correction.reason), { target: { value: 'chek bo‘yicha' } })
    fireEvent.click(within(form).getByRole('button', { name: t.correction.save }))
    await waitFor(() =>
      expect(correctionsRepo.correctEntry).toHaveBeenCalledWith({
        table: 'expenses',
        id: EXP_ID,
        qtyInput: null,
        unitId: null,
        totalAmount: '45000',
        reason: 'chek bo‘yicha',
        note: null,
        objectId: null,
      }),
    )
  })

  it('muallif (30 daqiqa): "Bekor qilish" — sabab bilan cancel_own_entry', async () => {
    vi.mocked(expensesRepo.listExpenses).mockResolvedValue({
      rows: [expense({ created_by: 'p-taminotchi', created_at: new Date().toISOString() })],
      total: 1,
    })
    open('taminotchi', '/purchases?tab=expenses')
    fireEvent.click(within(await screen.findByTestId('expense-row')).getByRole('button', { name: t.purchases.open }))
    fireEvent.click(await screen.findByRole('button', { name: t.correction.cancelAction }))
    const dialog = await screen.findByRole('dialog', { name: t.correction.cancelTitle })
    fireEvent.change(within(dialog).getByLabelText(t.correction.cancelReason), { target: { value: 'ikki marta' } })
    fireEvent.click(within(dialog).getByRole('button', { name: t.correction.cancelConfirm }))
    await waitFor(() => expect(correctionsRepo.cancelOwnEntry).toHaveBeenCalledWith('expenses', EXP_ID, 'ikki marta'))
  })

  it('"Xarajat qo‘shish" (admin): tur tugmasi, summa, Umumiy, to‘lovchi va pul manbai', async () => {
    vi.mocked(expensesRepo.createExpense).mockResolvedValue(expense())
    open('admin', '/purchases?tab=expenses')
    fireEvent.click(await screen.findByRole('button', { name: te.add }))
    const dialog = await screen.findByRole('dialog', { name: te.addTitle })
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Yoqilg‘i' }))
    fireEvent.change(within(dialog).getByLabelText(te.amount), { target: { value: '30000' } })
    // Bitta obyekt — avtomatik tanlangan; "Umumiy" ga o'tkaziladi
    expect(within(dialog).getByRole('combobox', { name: te.object })).toHaveValue('o-a')
    fireEvent.change(within(dialog).getByRole('combobox', { name: te.object }), { target: { value: '__general' } })
    fireEvent.change(within(dialog).getByRole('combobox', { name: te.payer }), { target: { value: 'p-haydovchi' } })
    fireEvent.change(within(dialog).getByRole('combobox', { name: te.paymentSource }), { target: { value: 'firma' } })
    fireEvent.click(within(dialog).getByRole('button', { name: t.common.save }))
    await waitFor(() => expect(expensesRepo.createExpense).toHaveBeenCalledTimes(1))
    expect(vi.mocked(expensesRepo.createExpense).mock.calls[0]?.[0]).toMatchObject({
      categoryId: 'k-fuel',
      objectId: null,
      amount: '30000',
      payerId: 'p-haydovchi',
      paymentSource: 'firma',
      spentAt: null,
    })
  })
})

describe('Sozlamalar → "Xarajat turlari"', () => {
  it('shu oydagi sarf limit bilan, oshgani qizil; nofaol qilish; qo‘shish', async () => {
    open('admin', '/settings?tab=expenses')
    const rows = await screen.findAllByTestId('expense-category-row')
    const plain = (el: Element | undefined) => (el?.textContent ?? '').replace(/[\u202F\u00A0]/g, ' ')
    expect(plain(rows[0])).toContain('Shu oy: 120 000 so‘m / 100 000 so‘m')
    expect(plain(rows[0])).toContain('Limitdan 20 000 so‘m oshgan')
    expect(rows[1]).toHaveTextContent(te.categories.noLimit)
    expect(reportsRepo.getSpendBreakdown).toHaveBeenCalledWith(expect.objectContaining({ from: expect.stringMatching(/-01$/) }), 'category')
    fireEvent.click(within(rows[1] as HTMLElement).getByRole('button', { name: te.categories.deactivate }))
    await waitFor(() => expect(expenseCategoriesRepo.updateExpenseCategory).toHaveBeenCalledWith('k-fuel', { isActive: false }))

    fireEvent.click(screen.getByRole('button', { name: te.categories.add }))
    const dialog = await screen.findByRole('dialog', { name: te.categories.addTitle })
    fireEvent.change(within(dialog).getByLabelText(te.categories.name), { target: { value: 'Ijara' } })
    fireEvent.change(within(dialog).getByLabelText(te.categories.monthlyLimit), { target: { value: '0' } })
    fireEvent.click(within(dialog).getByRole('button', { name: t.common.save }))
    expect(await within(dialog).findByText(te.categories.errLimit)).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText(te.categories.monthlyLimit), { target: { value: '5000000' } })
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.click(within(dialog).getByRole('button', { name: t.common.save }))
    await waitFor(() =>
      expect(expenseCategoriesRepo.createExpenseCategory).toHaveBeenCalledWith({
        companyId: COMPANY_ID,
        name: 'Ijara',
        monthlyLimit: '5000000',
        photoRequired: true,
        sortOrder: 3,
      }),
    )
  })

  it('tartib: "pastga" — ikki tur o‘rni almashadi', async () => {
    open('admin', '/settings?tab=expenses')
    fireEvent.click(await screen.findByRole('button', { name: te.categories.moveDown('Oziq-ovqat') }))
    await waitFor(() => expect(expenseCategoriesRepo.updateExpenseCategory).toHaveBeenCalledWith('k-food', { sortOrder: 2 }))
    expect(expenseCategoriesRepo.updateExpenseCategory).toHaveBeenCalledWith('k-fuel', { sortOrder: 1 })
  })

  it('tartib: takror sort_order — barcha turlar 1..n qilib qayta yoziladi; xato — ko‘rsatiladi', async () => {
    vi.mocked(expenseCategoriesRepo.listExpenseCategories).mockResolvedValue([
      category('k-a', 'A', { sort_order: 5 }),
      category('k-b', 'B', { sort_order: 5 }),
      category('k-c', 'C', { sort_order: 5 }),
    ])
    open('admin', '/settings?tab=expenses')
    fireEvent.click(await screen.findByRole('button', { name: te.categories.moveDown('B') }))
    await waitFor(() => expect(expenseCategoriesRepo.updateExpenseCategory).toHaveBeenCalledTimes(3))
    expect(vi.mocked(expenseCategoriesRepo.updateExpenseCategory).mock.calls).toEqual([
      ['k-a', { sortOrder: 1 }],
      ['k-c', { sortOrder: 2 }],
      ['k-b', { sortOrder: 3 }],
    ])

    vi.mocked(expenseCategoriesRepo.updateExpenseCategory).mockClear()
    vi.mocked(expenseCategoriesRepo.updateExpenseCategory).mockRejectedValueOnce(new Error('network'))
    fireEvent.click(await screen.findByRole('button', { name: te.categories.moveUp('C') }))
    await waitFor(() => expect(expenseCategoriesRepo.updateExpenseCategory).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(t.errors.unknown)).toBeInTheDocument()
  })
})
